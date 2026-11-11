import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autoEntryUrl,
  DEFAULT_DEMO_PERSONA,
  demoAutoEntryEnabled,
  demoModeFromEnv,
  personaForAlias,
  requestOrigin,
  safeNextPath,
  shouldAutoEnter,
} from '../src/lib/demo/auto-entry';

/**
 * Auto-entry replaces the sign-in screen in demonstration builds, so the gate
 * that decides when it runs is a security boundary, not a convenience flag.
 * These tests pin it.
 */

test('auto-entry is off in live mode whatever the override says', () => {
  assert.equal(demoAutoEntryEnabled('live', '1'), false);
  assert.equal(demoAutoEntryEnabled('LIVE', 'true'), false);
  assert.equal(demoAutoEntryEnabled('production', '1'), false);
  assert.equal(demoAutoEntryEnabled('staging', 'true'), false);
});

test('auto-entry defaults on in demonstration mode and can be switched off', () => {
  assert.equal(demoAutoEntryEnabled('demo'), true);
  assert.equal(demoAutoEntryEnabled(undefined), true, 'an unset FICAP_MODE is demonstration mode');
  for (const flag of ['0', 'false', 'no', 'off', 'OFF']) {
    assert.equal(demoAutoEntryEnabled('demo', flag), false, `flag ${flag} must disable auto-entry`);
  }
  for (const flag of ['1', 'true', 'yes', 'on']) {
    assert.equal(demoAutoEntryEnabled('demo', flag), true);
  }
});

test('demonstration mode requires exactly "demo", matching the domain predicate', () => {
  assert.equal(demoModeFromEnv('demo'), true);
  assert.equal(demoModeFromEnv('DEMO'), true);
  assert.equal(demoModeFromEnv(undefined), true, 'unset defaults to demonstration');
  assert.equal(demoModeFromEnv('live'), false);
  assert.equal(demoModeFromEnv('production'), false);
  assert.equal(demoModeFromEnv('staging'), false);
});

test('a request with a session is never redirected', () => {
  assert.equal(
    shouldAutoEnter({ pathname: '/', search: '', hasSessionCookie: true, enabled: true }),
    false,
  );
});

test('sign-in and API paths are excluded', () => {
  for (const pathname of ['/login', '/login/mfa', '/api/evidence/1', '/demo/enter', '/_next/x']) {
    assert.equal(
      shouldAutoEnter({ pathname, search: '', hasSessionCookie: false, enabled: true }),
      false,
      `${pathname} must not be auto-entered`,
    );
  }
});

test('a bare visit to an application route is auto-entered', () => {
  for (const pathname of ['/', '/findings', '/institutions/abc', '/registry/assets']) {
    assert.equal(
      shouldAutoEnter({ pathname, search: '', hasSessionCookie: false, enabled: true }),
      true,
      `${pathname} should be reachable without a sign-in in demonstration mode`,
    );
  }
});

test('the loop guard stops a second redirect when the cookie did not arrive', () => {
  assert.equal(
    shouldAutoEnter({ pathname: '/', search: '?demo_enter=1', hasSessionCookie: false, enabled: true }),
    false,
    'a browser that refuses cookies must fall back to the sign-in screen, not redirect forever',
  );
});

test('open redirects are refused', () => {
  const attempts = [
    'https://evil.example/login',
    '//evil.example',
    '/\\evil.example',
    '/\tx',
    'javascript:alert(1)',
    'demo/path',
    '',
  ];
  for (const attempt of attempts) {
    assert.equal(safeNextPath(attempt), '/', `${JSON.stringify(attempt)} must not become a redirect target`);
  }
});

test('excluded destinations fall back to the dashboard', () => {
  assert.equal(safeNextPath('/login'), '/');
  assert.equal(safeNextPath('/demo/enter?next=/'), '/');
});

test('a legitimate deep link survives validation', () => {
  assert.equal(safeNextPath('/findings'), '/findings');
  assert.equal(safeNextPath('/findings?status=confirmed'), '/findings?status=confirmed');
  assert.equal(safeNextPath('/institutions/abc-123'), '/institutions/abc-123');
});

test('persona aliases map to seeded roles and unknown input is ignored', () => {
  assert.equal(personaForAlias('reviewer'), 'supervisory_reviewer');
  assert.equal(personaForAlias('APPROVER'), 'report_approver');
  assert.equal(personaForAlias('admin'), 'platform_admin');
  assert.equal(personaForAlias(null), DEFAULT_DEMO_PERSONA);
  assert.equal(personaForAlias('../../etc/passwd'), DEFAULT_DEMO_PERSONA);
  assert.equal(personaForAlias('someone@real-bank.example'), DEFAULT_DEMO_PERSONA);
});

test('the deep link is carried into the entry URL encoded', () => {
  assert.equal(autoEntryUrl('/', ''), '/demo/enter?next=%2F');
  assert.equal(
    autoEntryUrl('/findings', '?status=confirmed'),
    '/demo/enter?next=%2Ffindings%3Fstatus%3Dconfirmed',
  );
});

test('the redirect origin comes from the browser-facing headers, never the bind address', () => {
  const h = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

  // The case that broke auto-entry: the server is bound to 0.0.0.0 but the
  // browser used 127.0.0.1. Redirecting to the bind address changes host, and
  // the cookie set on the way is not sent on the next request.
  assert.equal(requestOrigin(h({ host: '127.0.0.1:3000' })), 'http://127.0.0.1:3000');

  // Behind the preview proxy.
  assert.equal(
    requestOrigin(h({ 'x-forwarded-host': '3000-abc.e2b.app', 'x-forwarded-proto': 'https', host: 'internal:3000' })),
    'https://3000-abc.e2b.app',
  );

  // A proxy that sets only the host header still gets https, because a non-local
  // hostname reached over plain http is far less likely than a TLS-terminating proxy.
  assert.equal(requestOrigin(h({ host: 'ficap.cbn.gov.ng' })), 'https://ficap.cbn.gov.ng');

  // Comma-separated forwarding chains use the first entry.
  assert.equal(
    requestOrigin(h({ 'x-forwarded-host': 'a.example, b.internal', 'x-forwarded-proto': 'https, http' })),
    'https://a.example',
  );

  // No headers at all must not throw.
  assert.equal(requestOrigin(h({})), 'http://localhost:3000');
});
