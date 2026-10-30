import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { buildAccessScope, type Role, type SessionUser } from '../src/lib/rbac';

/**
 * Persona dashboard regression tests.
 *
 * These are deliberately executed against a real (empty) PostgreSQL database
 * rather than a mock. The defect that motivated them — a reviewer dashboard
 * querying `remediation_plans.due_date` when the column is `target_date` — was
 * invisible to type checking and only surfaced as a query error at request
 * time, where it was swallowed and the panel silently disappeared. Running the
 * SQL is the only way to catch that class of mistake.
 */

const DATA_DIR = path.join(os.tmpdir(), `ficap-dashboard-test-${process.pid}`);
process.env.FICAP_DATA_DIR = DATA_DIR;
process.env.FICAP_MODE = 'demo';

type Loaders = typeof import('../src/lib/domain/dashboard');
type Pool = typeof import('../src/lib/db/pool');

let loaders: Loaders;
let pool: Pool;

function contextFor(role: Role): import('../src/lib/db/context').RequestContext {
  const user: SessionUser = {
    id: `00000000-0000-4000-8000-${role === 'institution_contact' ? '000000000001' : '000000000002'}`,
    email: `${role}@example.test`,
    name: 'Test User',
    role,
    institution_id: role === 'institution_contact' ? '00000000-0000-4000-8000-0000000000aa' : null,
    mfa_verified: true,
  };
  const scope = buildAccessScope(user, { requestId: 'test', ip: '127.0.0.1', mode: 'demo' });
  return {
    session: { id: 'test-session', mfa_verified: true } as any,
    user,
    scope,
    ip: '127.0.0.1',
    userAgent: 'test',
    requestId: 'test',
    token: 'test',
    mode: 'demo',
  };
}

before(async () => {
  loaders = await import('../src/lib/domain/dashboard');
  pool = await import('../src/lib/db/pool');
  const { migrate } = await import('../src/lib/db/migrate');
  await migrate();
});

after(async () => {
  await pool?.closeDb().catch(() => undefined);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const cases: { role: Role; run: (tx: any, ctx: any) => Promise<unknown>; name: string }[] = [
  { role: 'cbn_assessor', run: (tx, ctx) => loaders.assessorDashboard(tx, ctx), name: 'assessor' },
  { role: 'supervisory_reviewer', run: (tx, ctx) => loaders.reviewerDashboard(tx, ctx), name: 'supervisory reviewer' },
  { role: 'report_approver', run: (tx, ctx) => loaders.approverDashboard(tx, ctx), name: 'report approver' },
  { role: 'institution_contact', run: (tx, ctx) => loaders.contactDashboard(tx, ctx), name: 'institution contact' },
  { role: 'platform_admin', run: (tx, ctx) => loaders.adminDashboard(tx, ctx), name: 'platform administrator' },
];

for (const item of cases) {
  test(`${item.name} dashboard runs against the real schema`, async () => {
    const ctx = contextFor(item.role);
    const data: any = await pool.withScope(ctx.scope, (tx) => item.run(tx, ctx));
    assert.ok(data && typeof data === 'object', 'the dashboard returns a payload');
    assert.equal(typeof data.counts, 'object', 'counts are always present');
  });
}

test('a role cannot load another role’s dashboard', async () => {
  const ctx = contextFor('report_approver');
  await assert.rejects(
    () => pool.withScope(ctx.scope, (tx) => loaders.reviewerDashboard(tx, ctx)),
    /not available for your role/,
  );
});

test('the administrative dashboard carries no finding or evidence figures', async () => {
  const ctx = contextFor('platform_admin');
  const data: any = await pool.withScope(ctx.scope, (tx) => loaders.adminDashboard(tx, ctx));
  const keys = Object.keys(data.counts);
  assert.ok(!keys.some((key) => /finding|evidence|risk|severity/i.test(key)), `no assessment-result keys: ${keys.join(', ')}`);
  assert.ok(!('findings' in data) && !('evidence' in data), 'no finding or evidence collection is returned');
});

test('the reviewer dashboard counts remediation with target_date, not due_date', async () => {
  // The column on remediation_plans is target_date; findings use due_date. This
  // test exists because a reviewer panel once queried the wrong one and simply
  // vanished.
  const ctx = contextFor('supervisory_reviewer');
  const data: any = await pool.withScope(ctx.scope, (tx) => loaders.reviewerDashboard(tx, ctx));
  assert.equal(typeof data.counts.plans_overdue, 'number');
  assert.equal(typeof data.counts.findings_overdue, 'number');
});
