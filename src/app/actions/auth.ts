'use server';

import { redirect } from 'next/navigation';
import { getRequestContext } from '@/lib/db/context';
import { demoMode, login, revokeSession, verifyMfa } from '@/lib/domain/auth';
import {
  clearAuthCookies,
  clearPendingCookie,
  readPendingCookie,
  setPendingCookie,
  setSessionCookies,
} from '@/lib/auth/session-cookies';
import { requestMeta, withMessage } from '@/app/actions/helpers';

export type LoginState = { error?: string; info?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Addresses are matched case-insensitively; a stray capital or trailing space
  // must not look like a different account.
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email address and password.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };

  const meta = await requestMeta();
  const outcome = await login(email, password, meta);

  if (outcome.status === 'mfa_required') {
    await setPendingCookie(outcome.token);
    redirect('/login/mfa');
  }
  if (outcome.status === 'locked') {
    return { error: `Too many failed attempts. This account is locked until ${new Date(outcome.lockedUntil).toISOString().slice(11, 16)} UTC.` };
  }
  if (outcome.status === 'suspended') {
    return { error: outcome.reason };
  }
  const remaining = outcome.status === 'invalid' ? outcome.remainingAttempts : undefined;
  return {
    error:
      remaining != null && remaining <= 3
        ? `Invalid email address or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before the account is temporarily locked.`
        : 'Invalid email address or password.',
  };
}

export type MfaState = { error?: string; info?: string };

export async function verifyMfaAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  // The pending token is taken from the submitted form first and from the
  // cookie second. A browser that withholds third-party cookies in an embedded
  // view would otherwise lose the pending state between rendering the code page
  // and submitting the code, and report a misleading "session expired".
  const submitted = String(formData.get('challenge') ?? '').trim();
  const cookieToken = await readPendingCookie();
  const token = submitted || cookieToken;
  if (!token) redirect(withMessage('/login', { error: 'Your sign-in session expired. Enter your credentials again.' }));
  const code = String(formData.get('code') ?? '').trim();
  if (!/^\d{6}$/.test(code)) return { error: 'Enter the 6-digit code from your authenticator application.' };

  const meta = await requestMeta();
  const outcome = await verifyMfa(token!, code, meta);

  if (outcome.status === 'ok') {
    await setSessionCookies(outcome.token, outcome.csrf);
    await clearPendingCookie();
    // Confirm the session cookie actually survives the round trip. If the
    // browser drops it (third-party cookie blocking in an embedded view), the
    // user is told exactly that instead of being sent back to the sign-in page
    // with no explanation.
    redirect('/login/complete');
  }
  if (outcome.status === 'locked') return { error: outcome.reason };

  // A wrong code must not throw the pending sign-in away. The pending session is
  // still valid, so the user corrects the code instead of restarting the flow
  // (previously this branch cleared the cookie, which produced a misleading
  // "session expired" message on the next attempt).
  if (outcome.remainingAttempts !== undefined) {
    const remaining = outcome.remainingAttempts;
    const hint = demoMode()
      ? ' In demonstration mode, use the code shown on this page — no authenticator device is enrolled for the synthetic accounts.'
      : '';
    return {
      error: `${outcome.reason}. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before the account is temporarily locked.${hint}`,
    };
  }

  // The session itself is gone (expired or revoked): a fresh sign-in is required.
  await clearPendingCookie();
  redirect(withMessage('/login', { error: outcome.reason }));
}

export async function cancelMfaAction(): Promise<void> {
  await clearPendingCookie();
  redirect('/login');
}

export async function logoutAction(): Promise<void> {
  try {
    const ctx = await getRequestContext({ required: false });
    if (ctx) await revokeSession(ctx.token, 'logout');
  } finally {
    await clearAuthCookies();
  }
  redirect(withMessage('/login', { notice: 'You have been signed out.' }));
}

export async function demoModeFlag(): Promise<boolean> {
  return demoMode();
}
