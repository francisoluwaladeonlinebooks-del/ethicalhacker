import { NextRequest, NextResponse } from 'next/server';
import { directLoginAsPersona } from '@/lib/domain/auth';
import { SESSION_COOKIE, CSRF_COOKIE } from '@/lib/db/context';
import { cookiePolicy } from '@/lib/auth/session-cookies';

export const dynamic = 'force-dynamic';

async function handlePersonaLogin(request: NextRequest, persona: string) {
  if (!persona) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || '127.0.0.1';
  const userAgent = request.headers.get('user-agent') ?? 'browser';

  const outcome = await directLoginAsPersona(persona, { ip, userAgent });
  if (outcome.status !== 'ok') {
    const errorUrl = new URL('/login', request.url);
    errorUrl.searchParams.set('error', outcome.reason);
    return NextResponse.redirect(errorUrl);
  }

  const policy = await cookiePolicy();
  const targetUrl = new URL('/', request.url);
  const response = NextResponse.redirect(targetUrl, 303);

  // Set session cookie
  response.cookies.set(SESSION_COOKIE, outcome.token, {
    httpOnly: true,
    sameSite: policy.sameSite,
    secure: policy.secure,
    path: '/',
    maxAge: 8 * 60 * 60,
  });

  // Set CSRF cookie
  response.cookies.set(CSRF_COOKIE, outcome.csrf, {
    httpOnly: false,
    sameSite: policy.sameSite,
    secure: policy.secure,
    path: '/',
    maxAge: 8 * 60 * 60,
  });

  return response;
}

export async function GET(request: NextRequest) {
  const persona =
    request.nextUrl.searchParams.get('persona') ||
    request.nextUrl.searchParams.get('email') ||
    request.nextUrl.searchParams.get('role') ||
    '';
  return handlePersonaLogin(request, persona);
}

export async function POST(request: NextRequest) {
  let persona = '';
  try {
    const formData = await request.formData();
    persona = String(formData.get('persona') ?? formData.get('email') ?? formData.get('role') ?? '');
  } catch {
    persona = request.nextUrl.searchParams.get('persona') || '';
  }
  return handlePersonaLogin(request, persona);
}
