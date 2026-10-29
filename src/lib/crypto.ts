import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cryptographic primitives used across FICAP.
 *
 * - Passwords: scrypt with per-user random salt and tuned parameters.
 * - Evidence / artifacts / TOTP secrets: AES-256-GCM envelope encryption at rest.
 * - Session tokens and CSRF tokens: 256-bit random values, only hashes stored.
 * - MFA: RFC 6238 TOTP (SHA-1, 6 digits, 30s step) with replay protection.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Envelope encryption
// ---------------------------------------------------------------------------

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const configured = process.env.FICAP_ENCRYPTION_KEY;
  if (configured && configured.length >= 16) {
    cachedKey = crypto.scryptSync(configured, 'ficap-evidence-kdf-v1', 32);
    return cachedKey;
  }
  // Demo fallback: a locally generated key file with 0600 permissions. This is
  // never acceptable for live deployments (documented in README).
  const keyPath = path.resolve('.data/keys/encryption.key');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  const material = fs.readFileSync(keyPath, 'utf8').trim();
  cachedKey = crypto.scryptSync(material, 'ficap-evidence-kdf-v1', 32);
  return cachedKey;
}

export function encrypt(plaintext: string | Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('FICAPv1'), iv, tag, ciphertext]);
}

export function decrypt(envelope: Buffer | Uint8Array): Buffer {
  const buf = Buffer.isBuffer(envelope) ? envelope : Buffer.from(envelope);
  const prefix = buf.subarray(0, 7).toString('utf8');
  if (prefix !== 'FICAPv1') throw new Error('unrecognised ciphertext envelope');
  const iv = buf.subarray(7, 19);
  const tag = buf.subarray(19, 35);
  const ciphertext = buf.subarray(35);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function decryptToString(envelope: Buffer | Uint8Array): string {
  return decrypt(envelope).toString('utf8');
}

export function encryptToBase64(plaintext: string): string {
  return encrypt(plaintext).toString('base64');
}

export function decryptFromBase64(value: string): string {
  return decrypt(Buffer.from(value, 'base64')).toString('utf8');
}

export function hmac(secret: string, value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) for multi-factor authentication
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpStepAt(epochMs = Date.now()): number {
  return Math.floor(epochMs / 1000 / TOTP_STEP_SECONDS);
}

export function totpAt(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export type TotpVerification = { ok: boolean; step?: number; reason?: string };

/**
 * Verify a TOTP code allowing ±1 step of clock drift. Callers must persist the
 * accepted step and refuse any step <= the stored one (replay protection).
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { now?: number; window?: number; lastAcceptedStep?: number | null } = {},
): TotpVerification {
  const normalized = (code || '').replace(/\D/g, '');
  if (normalized.length !== TOTP_DIGITS) return { ok: false, reason: 'malformed' };
  const current = totpStepAt(options.now ?? Date.now());
  const window = options.window ?? 1;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (constantTimeEqual(totpAt(secret, step), normalized)) {
      if (options.lastAcceptedStep != null && step <= options.lastAcceptedStep) {
        return { ok: false, reason: 'replayed' };
      }
      return { ok: true, step };
    }
  }
  return { ok: false, reason: 'mismatch' };
}

export function totpUri(params: { secret: string; accountName: string; issuer?: string }): string {
  const issuer = params.issuer ?? 'FICAP';
  const label = encodeURIComponent(`${issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}
