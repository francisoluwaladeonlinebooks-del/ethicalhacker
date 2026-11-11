import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directLoginAsPersona, demoMode, PERSONA_SHORTCUT_DENIAL_REASON } from '../src/lib/domain/auth';

/**
 * The persona shortcut mints a session with `mfa_verified = true`. These tests
 * pin the two gates that keep it from being an authentication bypass:
 *
 *   1. it does not exist outside demonstration mode;
 *   2. it only assumes an account flagged as a demonstration account, and a role
 *      switch additionally requires the acting session to be one.
 *
 * Every case below is refused *before* any database access, so the test needs no
 * PGlite instance. If a future refactor moves the guard after the query, these
 * tests will start needing a database and will fail loudly — which is the
 * intended signal.
 */

function withMode<T>(mode: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.FICAP_MODE;
  if (mode === undefined) delete process.env.FICAP_MODE;
  else process.env.FICAP_MODE = mode;
  return run().finally(() => {
    if (previous === undefined) delete process.env.FICAP_MODE;
    else process.env.FICAP_MODE = previous;
  });
}

test('demoMode defaults to demonstration and is false for an explicit live mode', () => {
  assert.equal(demoMode(), true, 'an unset FICAP_MODE must default to demo, as the rest of the app assumes');

  process.env.FICAP_MODE = 'production';
  assert.equal(demoMode(), false);
  process.env.FICAP_MODE = 'live';
  assert.equal(demoMode(), false);
  delete process.env.FICAP_MODE;
  assert.equal(demoMode(), true);
});

test('the shortcut is refused entirely outside demonstration mode', async () => {
  const outcome = await withMode('production', () => directLoginAsPersona('admin@cbn.gov.ng'));

  assert.equal(outcome.status, 'error');
  if (outcome.status !== 'error') return;
  assert.equal(outcome.denial, 'not_demo_mode');
  assert.equal(outcome.reason, PERSONA_SHORTCUT_DENIAL_REASON.not_demo_mode);
  // The refusal must tell a legitimate user what to do instead.
  assert.match(outcome.reason, /authenticator/i);
});

test('a live-mode deployment refuses even a request that names a demo account', async () => {
  // The gate is the deployment mode, not the target's flag.
  const outcome = await withMode('live', () => directLoginAsPersona('assessor@cbn.gov.ng'));
  assert.equal(outcome.status, 'error');
  if (outcome.status === 'error') assert.equal(outcome.denial, 'not_demo_mode');
});

test('a non-demonstration session may not switch into any role', async () => {
  const outcome = await withMode('demo', () =>
    directLoginAsPersona('admin@cbn.gov.ng', {}, { is_demo: false, role: 'institution_contact', email: 'contact@meridian.example' }),
  );

  assert.equal(outcome.status, 'error');
  if (outcome.status !== 'error') return;
  assert.equal(outcome.denial, 'not_demo_actor');
  assert.equal(outcome.reason, PERSONA_SHORTCUT_DENIAL_REASON.not_demo_actor);
});

test('an empty persona is refused without touching the database', async () => {
  const outcome = await withMode('demo', () => directLoginAsPersona('   '));
  assert.equal(outcome.status, 'error');
  if (outcome.status === 'error') assert.equal(outcome.denial, 'not_demo_target');
});

test('every refusal carries a distinct, human-readable reason', () => {
  const reasons = Object.values(PERSONA_SHORTCUT_DENIAL_REASON);
  assert.equal(new Set(reasons).size, reasons.length, 'denial reasons must not be duplicated');
  for (const reason of reasons) {
    assert.ok(reason.length > 40, 'each refusal must explain itself rather than return a code');
    assert.ok(/[.!]$/.test(reason), 'each refusal must be a complete sentence');
  }
});
