import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRequestContext, type RequestContext } from '@/lib/db/context';
import { toPublicError } from '@/lib/errors';

export type ActionOutcome = { ok: true } | { ok: false; error: string };

/** Resolve the request context for a server action and validate the CSRF token. */
export async function actionContext(formData: FormData): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (!ctx) throw Object.assign(new Error('Your session has expired. Sign in again.'), { status: 401, code: 'unauthenticated' });
  const token = String(formData.get('_csrf') ?? '');
  if (!token || token !== ctx.session.csrf_token) {
    throw Object.assign(new Error('Your form session has expired. Reload the page and try again.'), { status: 403, code: 'csrf' });
  }
  return ctx;
}

export function clientMeta(ctx: RequestContext) {
  return { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
}

export function text(formData: FormData, name: string, fallback = ''): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : fallback;
}

export function optionalText(formData: FormData, name: string): string | undefined {
  const value = text(formData, name).trim();
  return value.length ? value : undefined;
}

export function list(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function numbers(formData: FormData, name: string): number[] {
  return list(formData, name).map(Number).filter((value) => Number.isFinite(value));
}

export function bool(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === 'on' || value === 'true' || value === '1';
}

export function withMessage(path: string, params: { notice?: string; error?: string; [key: string]: string | undefined }): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `${path}${path.includes('?') ? '&' : '?'}${suffix}` : path;
}

/**
 * Run a mutation, converting known errors into a redirect with a safe message.
 * Redirects thrown by the mutation itself (success paths) are re-thrown.
 */
export async function runAction(options: {
  formData: FormData;
  failurePath: string;
  successNotice?: string;
  successPath?: (result: any, ctx: RequestContext) => string;
  mutate: (ctx: RequestContext) => Promise<any>;
}): Promise<never> {
  let redirectTo: string | null = null;
  let notice: string | undefined;
  try {
    const ctx = await actionContext(options.formData);
    const result = await options.mutate(ctx);
    redirectTo = options.successPath ? options.successPath(result, ctx) : options.failurePath;
    notice = options.successNotice;
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const { body } = toPublicError(error);
    redirectTo = withMessage(options.failurePath, { error: body.error });
  }
  redirect(withMessage(redirectTo!, { notice }));
}

export function isRedirectError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'digest' in error && String((error as any).digest).startsWith('NEXT_REDIRECT'));
}

export async function requestMeta(): Promise<{ ip: string; userAgent: string }> {
  const store = await headers();
  const ip = store.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  return { ip, userAgent: store.get('user-agent') ?? 'unknown' };
}

export function searchParamsOf(searchParams: Record<string, string | string[] | undefined>) {
  const one = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    page: Math.max(1, Number(one('page') ?? 1) || 1),
    notice: one('notice'),
    error: one('error'),
    value: one,
  };
}
