import crypto from 'node:crypto';
import { withSystem } from '@/lib/db/pool';
import {
  constantTimeEqual,
  decryptFromBase64,
  encryptToBase64,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hmac,
  randomToken,
  sha256,
  totpAt,
  totpStepAt,
  totpUri,
  verifyPassword,
  verifyTotp,
} from '@/lib/crypto';
import type { Permission, Role } from '@/lib/rbac';
import { recordAudit } from '@/lib/domain/audit';

const SESSION_ABSOLUTE_MINUTES = 8 * 60;
const SESSION_IDLE_MINUTES = 30;
const PENDING_MFA_MINUTES = 10;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const THROTTLE_WINDOW_MINUTES = 15;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  institution_id: string | null;
  job_title: string | null;
  mfa_enrolled_at: string | null;
  is_demo: boolean;
};

export type SessionRecord = {
  id: string;
  user_id: string;
  mfa_verified: boolean;
  csrf_token: string;
  created_at: string | Date;
  expires_at: string | Date;
  idle_expires_at: string | Date;
};

function pepper(): string {
  return process.env.FICAP_SESSION_PEPPER || 'ficap-demo-session-pepper-not-for-live-use';
}

export function sessionTokenHash(token: string): string {
  return sha256(`${token}.${pepper()}`);
}

export type LoginOutcome =
  | { status: 'mfa_required'; token: string; csrf: string; user: AuthUser; demoCode?: string }
  | { status: 'invalid'; reason: string; remainingAttempts?: number }
  | { status: 'locked'; reason: string; lockedUntil: string }
  | { status: 'suspended'; reason: string };

function nowIso(offsetMinutes = 0): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

async function bumpThrottle(key: string, success: boolean): Promise<{ locked: boolean; lockedUntil?: string; attempts: number }> {
  return withSystem(async (tx) => {
    const row = await tx.queryOne<{ attempts: number; window_start: string; locked_until: string | null }>(
      'SELECT attempts, window_start, locked_until FROM auth_throttle WHERE key = $1',
      [key],
    );
    if (success) {
      await tx.query('DELETE FROM auth_throttle WHERE key = $1', [key]);
      return { locked: false, attempts: 0 };
    }
    if (!row) {
      await tx.query('INSERT INTO auth_throttle (key, attempts, window_start) VALUES ($1, 1, now())', [key]);
      return { locked: false, attempts: 1 };
    }
    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      return { locked: true, lockedUntil: row.locked_until, attempts: row.attempts };
    }
    const windowStart = new Date(row.window_start).getTime();
    const expired = Date.now() - windowStart > THROTTLE_WINDOW_MINUTES * 60_000;
    const attempts = expired ? 1 : row.attempts + 1;
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? nowIso(LOCKOUT_MINUTES) : null;
    await tx.query(
      `UPDATE auth_throttle SET attempts = $2, window_start = $3, locked_until = $4 WHERE key = $1`,
      [key, attempts, expired ? nowIso() : row.window_start, lockedUntil],
    );
    return { locked: Boolean(lockedUntil), lockedUntil: lockedUntil ?? undefined, attempts };
  });
}

export function validatePasswordStrength(password: string, email?: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters long';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter';
  if (!/\d/.test(password)) return 'Password must include a number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a symbol';
  const common = ['password', 'letmein', 'welcome', 'qwerty', 'changeme', 'admin123', 'cbn12345'];
  if (common.some((word) => password.toLowerCase().includes(word))) return 'Password contains a commonly used weak phrase';
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Password must not contain the account name';
  return null;
}

export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  institutionId?: string | null;
  jobTitle?: string | null;
  password: string;
  isDemo?: boolean;
  mfaRequired?: boolean;
  actor?: { id: string | null; email?: string; role?: Role };
  ip?: string;
}): Promise<{ id: string; mfaSecret?: string; recoveryCodes?: string[] }> {
  const passwordProblem = validatePasswordStrength(input.password, input.email);
  if (passwordProblem) throw new Error(passwordProblem);
  const secret = generateTotpSecret();
  const recovery = generateRecoveryCodes(8);
  const result = await withSystem(async (tx) => {
    const existing = await tx.queryOne('SELECT id FROM users WHERE lower(email) = lower($1)', [input.email]);
    if (existing) throw new Error('An account with this email already exists');
    const user = await tx.queryOne<{ id: string }>(
      `INSERT INTO users (email, name, role, institution_id, job_title, password_hash, mfa_secret_enc, mfa_enrolled_at, mfa_required, is_demo)
       VALUES (lower($1), $2, $3, $4, $5, $6, $7, now(), $8, $9) RETURNING id`,
      [
        input.email.trim(),
        input.name.trim(),
        input.role,
        input.institutionId ?? null,
        input.jobTitle ?? null,
        hashPassword(input.password),
        encryptToBase64(secret),
        input.mfaRequired !== false,
        Boolean(input.isDemo),
      ],
    );
    for (const code of recovery) {
      await tx.query('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [user!.id, sha256(code)]);
    }
    return user!.id;
  });
  await recordAudit({
    action: 'user.created',
    entityType: 'user',
    entityId: result,
    actor: input.actor ?? null,
    institutionId: input.institutionId ?? null,
    metadata: { email: input.email, role: input.role },
    ip: input.ip,
  });
  return { id: result, mfaSecret: secret, recoveryCodes: recovery };
}

export async function login(
  email: string,
  password: string,
  context: { ip?: string; userAgent?: string } = {},
): Promise<LoginOutcome> {
  const normalizedEmail = email.trim().toLowerCase();
  const accountKey = `acct:${normalizedEmail}`;
  const ipKey = `ip:${context.ip ?? 'unknown'}`;

  const accountThrottle = await withSystem((tx) =>
    tx.queryOne<{ locked_until: string | null }>('SELECT locked_until FROM auth_throttle WHERE key = $1', [accountKey]),
  );
  if (accountThrottle?.locked_until && new Date(accountThrottle.locked_until) > new Date()) {
    await recordAudit({
      action: 'auth.login',
      entityType: 'user',
      outcome: 'denied',
      actor: { id: null, email: normalizedEmail, role: null },
      metadata: { reason: 'account_throttled' },
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return { status: 'locked', reason: 'Too many failed attempts. Try again later.', lockedUntil: accountThrottle.locked_until };
  }

  const user = await withSystem((tx) =>
    tx.queryOne<{
      id: string;
      email: string;
      name: string;
      role: Role;
      institution_id: string | null;
      job_title: string | null;
      password_hash: string;
      mfa_secret_enc: string | null;
      mfa_enrolled_at: string | null;
      mfa_required: boolean;
      status: string;
      is_demo: boolean;
      failed_attempts: number;
      locked_until: string | null;
    }>('SELECT * FROM users WHERE lower(email) = lower($1)', [normalizedEmail]),
  );

  const validPassword = user ? verifyPassword(password, user.password_hash) : false;

  if (!user || !validPassword) {
    const throttle = await bumpThrottle(accountKey, false);
    await bumpThrottle(ipKey, false);
    await recordAudit({
      action: 'auth.login',
      entityType: 'user',
      entityId: user?.id ?? null,
      outcome: 'denied',
      actor: { id: user?.id ?? null, email: normalizedEmail, role: user?.role ?? null },
      metadata: { reason: 'invalid_credentials', attempts: throttle.attempts },
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return {
      status: throttle.locked ? 'locked' : 'invalid',
      reason: throttle.locked ? 'Too many failed attempts. The account is temporarily locked.' : 'Invalid email address or password',
      lockedUntil: throttle.lockedUntil,
      remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - throttle.attempts),
    } as LoginOutcome;
  }

  if (user.status !== 'active') {
    await recordAudit({
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      outcome: 'denied',
      actor: { id: user.id, email: user.email, role: user.role },
      metadata: { reason: `account_${user.status}` },
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return { status: 'suspended', reason: 'This account is not active. Contact the platform administrator.' };
  }

  await bumpThrottle(accountKey, true);
  await bumpThrottle(ipKey, true);

  const token = randomToken(32);
  const csrf = randomToken(24);
  const mfaVerified = !user.mfa_required;
  await withSystem(async (tx) => {
    await tx.query(
      `INSERT INTO sessions (user_id, token_hash, csrf_token, mfa_verified, ip, user_agent, expires_at, idle_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        user.id,
        sessionTokenHash(token),
        csrf,
        mfaVerified,
        context.ip ?? null,
        context.userAgent ?? null,
        nowIso(mfaVerified ? SESSION_ABSOLUTE_MINUTES : PENDING_MFA_MINUTES),
        nowIso(mfaVerified ? SESSION_IDLE_MINUTES : PENDING_MFA_MINUTES),
      ],
    );
    await tx.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
  });

  await recordAudit({
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    outcome: 'success',
    institutionId: user.institution_id,
    actor: { id: user.id, email: user.email, role: user.role },
    metadata: { mfa_required: user.mfa_required, stage: 'password' },
    ip: context.ip,
    userAgent: context.userAgent,
  });

  const publicUser: AuthUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    institution_id: user.institution_id,
    job_title: user.job_title,
    mfa_enrolled_at: user.mfa_enrolled_at,
    is_demo: user.is_demo,
  };

  if (user.mfa_required) {
    return {
      status: 'mfa_required',
      token,
      csrf,
      user: publicUser,
      demoCode: demoMode() && user.is_demo && user.mfa_secret_enc ? totpAt(decryptFromBase64(user.mfa_secret_enc), totpStepAt()) : undefined,
    };
  }
  return { status: 'mfa_required', token, csrf, user: publicUser };
}

export function demoMode(): boolean {
  return (process.env.FICAP_MODE ?? 'demo') === 'demo';
}

export type MfaOutcome =
  | { status: 'ok'; token: string; csrf: string }
  | { status: 'invalid'; reason: string; remainingAttempts?: number }
  | { status: 'locked'; reason: string };

export async function verifyMfa(
  token: string,
  code: string,
  context: { ip?: string; userAgent?: string } = {},
): Promise<MfaOutcome> {
  const session = await withSystem((tx) =>
    tx.queryOne<{
      id: string;
      user_id: string;
      mfa_verified: boolean;
      expires_at: string;
      revoked_at: string | null;
      email: string;
      role: Role;
      institution_id: string | null;
      mfa_secret_enc: string | null;
      mfa_last_step: string | null;
      status: string;
    }>(
      `SELECT s.id, s.user_id, s.mfa_verified, s.expires_at, s.revoked_at, u.email, u.role, u.institution_id,
              u.mfa_secret_enc, u.mfa_last_step, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
      [sessionTokenHash(token)],
    ),
  );
  if (!session || session.revoked_at) return { status: 'invalid', reason: 'Session expired. Sign in again.' };
  if (new Date(session.expires_at) < new Date()) return { status: 'invalid', reason: 'Session expired. Sign in again.' };
  if (session.status !== 'active') return { status: 'invalid', reason: 'Account is not active' };

  const throttleKey = `mfa:${session.user_id}`;
  const throttle = await withSystem((tx) =>
    tx.queryOne<{ locked_until: string | null; attempts: number }>('SELECT locked_until, attempts FROM auth_throttle WHERE key = $1', [throttleKey]),
  );
  if (throttle?.locked_until && new Date(throttle.locked_until) > new Date()) {
    return { status: 'locked', reason: 'Too many incorrect verification codes. Try again later.' };
  }

  const secret = session.mfa_secret_enc ? decryptFromBase64(session.mfa_secret_enc) : null;
  const lastStep = session.mfa_last_step ? Number(session.mfa_last_step) : null;

  let verified = false;
  let acceptedStep: number | null = null;
  if (secret) {
    const totp = verifyTotp(secret, code, { lastAcceptedStep: lastStep });
    if (totp.ok) {
      verified = true;
      acceptedStep = totp.step ?? null;
    }
  }
  if (!verified) {
    // Recovery code fallback (single use, hashed at rest).
    const recovery = await withSystem((tx) =>
      tx.queryOne<{ id: string }>(
        'SELECT id FROM mfa_recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL',
        [session.user_id, sha256(code.trim().toUpperCase())],
      ),
    );
    if (recovery) {
      await withSystem((tx) => tx.query('UPDATE mfa_recovery_codes SET used_at = now() WHERE id = $1', [recovery.id]));
      verified = true;
    }
  }

  if (!verified) {
    const result = await bumpThrottle(throttleKey, false);
    await recordAudit({
      action: 'auth.mfa',
      entityType: 'user',
      entityId: session.user_id,
      outcome: 'denied',
      actor: { id: session.user_id, email: session.email, role: session.role },
      metadata: { reason: 'invalid_code' },
      ip: context.ip,
      userAgent: context.userAgent,
    });
    if (result.locked) return { status: 'locked', reason: 'Too many incorrect verification codes. Try again later.' };
    return { status: 'invalid', reason: 'The verification code is not valid', remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - result.attempts) };
  }

  // Rotate the session token on privilege elevation (prevents fixation).
  const newToken = randomToken(32);
  const newCsrf = randomToken(24);
  await withSystem(async (tx) => {
    await tx.query(
      `UPDATE sessions SET token_hash = $2, csrf_token = $3, mfa_verified = true,
              expires_at = $4, idle_expires_at = $5, last_seen_at = now() WHERE id = $1`,
      [session.id, sessionTokenHash(newToken), newCsrf, nowIso(SESSION_ABSOLUTE_MINUTES), nowIso(SESSION_IDLE_MINUTES)],
    );
    if (acceptedStep !== null) {
      await tx.query('UPDATE users SET mfa_last_step = $2, last_login_at = now() WHERE id = $1', [session.user_id, acceptedStep]);
    } else {
      await tx.query('UPDATE users SET last_login_at = now() WHERE id = $1', [session.user_id]);
    }
  });
  await bumpThrottle(throttleKey, true);

  await recordAudit({
    action: 'auth.mfa',
    entityType: 'user',
    entityId: session.user_id,
    outcome: 'success',
    institutionId: session.institution_id,
    actor: { id: session.user_id, email: session.email, role: session.role },
    metadata: { method: acceptedStep !== null ? 'totp' : 'recovery_code' },
    ip: context.ip,
    userAgent: context.userAgent,
  });

  return { status: 'ok', token: newToken, csrf: newCsrf };
}

export type ActiveSession = { session: SessionRecord; user: AuthUser & { permissions: Permission[] } };

export async function loadSession(token: string): Promise<ActiveSession | null> {
  if (!token) return null;
  const row = await withSystem((tx) =>
    tx.queryOne<{
      session_id: string;
      user_id: string;
      mfa_verified: boolean;
      csrf_token: string;
      created_at: string;
      expires_at: string;
      idle_expires_at: string;
      revoked_at: string | null;
      email: string;
      name: string;
      role: Role;
      institution_id: string | null;
      job_title: string | null;
      mfa_enrolled_at: string | null;
      is_demo: boolean;
      status: string;
    }>(
      `SELECT s.id AS session_id, s.user_id, s.mfa_verified, s.csrf_token, s.created_at, s.expires_at, s.idle_expires_at,
              s.revoked_at, u.email, u.name, u.role, u.institution_id, u.job_title, u.mfa_enrolled_at, u.is_demo, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
      [sessionTokenHash(token)],
    ),
  );
  if (!row || row.revoked_at || row.status !== 'active') return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now || new Date(row.idle_expires_at).getTime() < now) return null;
  if (!row.mfa_verified) return null;

  const grants = await withSystem((tx) =>
    tx.query<{ permission: string }>(
      `SELECT permission FROM access_grants
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [row.user_id],
    ),
  );

  // Slide the idle window, but never past the absolute expiry.
  await withSystem((tx) =>
    tx.query('UPDATE sessions SET last_seen_at = now(), idle_expires_at = LEAST($2::timestamptz, expires_at) WHERE id = $1', [
      row.session_id,
      nowIso(SESSION_IDLE_MINUTES),
    ]),
  );

  return {
    session: {
      id: row.session_id,
      user_id: row.user_id,
      mfa_verified: row.mfa_verified,
      csrf_token: row.csrf_token,
      created_at: row.created_at,
      expires_at: row.expires_at,
      idle_expires_at: row.idle_expires_at,
    },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      institution_id: row.institution_id,
      job_title: row.job_title,
      mfa_enrolled_at: row.mfa_enrolled_at,
      is_demo: row.is_demo,
      permissions: grants.map((g) => g.permission as Permission),
    },
  };
}

export async function revokeSession(token: string, reason = 'logout'): Promise<void> {
  await withSystem((tx) =>
    tx.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE token_hash = $1`, [sessionTokenHash(token), reason]),
  );
}

export async function revokeAllSessionsForUser(userId: string, reason = 'admin_revoke'): Promise<void> {
  await withSystem((tx) => tx.query('UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, reason]));
}

export async function rotatePassword(userId: string, newPassword: string, actor?: { id: string; email: string; role: Role }): Promise<void> {
  const user = await withSystem((tx) => tx.queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]));
  if (!user) throw new Error('User not found');
  const problem = validatePasswordStrength(newPassword, user.email);
  if (problem) throw new Error(problem);
  await withSystem((tx) =>
    tx.query('UPDATE users SET password_hash = $2, password_updated_at = now(), updated_at = now() WHERE id = $1', [userId, hashPassword(newPassword)]),
  );
  await revokeAllSessionsForUser(userId, 'password_changed');
  await recordAudit({ action: 'auth.password_changed', entityType: 'user', entityId: userId, actor: actor ?? null });
}

/** Enrol (or re-enrol) MFA; returns the provisioning URI and recovery codes. */
export async function enrolMfa(userId: string): Promise<{ secret: string; uri: string; recoveryCodes: string[] }> {
  const secret = generateTotpSecret();
  const recovery = generateRecoveryCodes(8);
  const user = await withSystem(async (tx) => {
    const row = await tx.queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    if (!row) throw new Error('User not found');
    await tx.query('UPDATE users SET mfa_secret_enc = $2, mfa_enrolled_at = now(), mfa_last_step = NULL WHERE id = $1', [userId, encryptToBase64(secret)]);
    await tx.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
    for (const code of recovery) {
      await tx.query('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, sha256(code)]);
    }
    return row;
  });
  await recordAudit({ action: 'auth.mfa_enrolled', entityType: 'user', entityId: userId, actor: { id: userId, email: user.email } });
  return { secret, uri: totpUri({ secret, accountName: user.email }), recoveryCodes: recovery };
}

/** Demo-only helper so reviewers can complete the real MFA flow. */
export async function demoMfaCodeForEmail(email: string): Promise<string | null> {
  if (!demoMode()) return null;
  const row = await withSystem((tx) =>
    tx.queryOne<{ mfa_secret_enc: string | null; is_demo: boolean }>('SELECT mfa_secret_enc, is_demo FROM users WHERE lower(email) = lower($1)', [email]),
  );
  if (!row?.mfa_secret_enc || !row.is_demo) return null;
  return totpAt(decryptFromBase64(row.mfa_secret_enc), totpStepAt());
}

export function safeCompare(a: string, b: string): boolean {
  return constantTimeEqual(a, b);
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
