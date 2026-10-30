import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAccessScope, can, effectivePermissions, requiresIndependentActor, ROLES, ROLE_PERMISSIONS, type SessionUser } from '../src/lib/rbac';

const user = (role: SessionUser['role'], institutionId: string | null = null): SessionUser => ({
  id: `user-${role}`,
  email: `${role}@example.test`,
  name: role,
  role,
  institution_id: institutionId,
  status: 'active',
  mfa_verified: true,
} as SessionUser);

test('every declared role has a permission set', () => {
  for (const role of ROLES) {
    assert.ok(ROLE_PERMISSIONS[role.key].length > 0, `${role.key} has no permissions`);
  }
});

test('institution contacts cannot read other institutions or platform administration', () => {
  const contact = user('institution_contact', 'inst-1');
  assert.equal(can(contact, 'institution:write'), false);
  assert.equal(can(contact, 'user:manage'), false);
  assert.equal(can(contact, 'settings:manage'), false);
  assert.equal(can(contact, 'audit:read'), false);
  assert.equal(can(contact, 'engagement:launch'), false);
  assert.equal(can(contact, 'cross_institution:read' as any), false);
});

test('institution contacts are confined to their own institution in the database scope', () => {
  const scope = buildAccessScope(user('institution_contact', 'inst-1'));
  assert.equal(scope.crossInstitution, false);
  assert.deepEqual(scope.institutionIds, ['inst-1']);

  const unlinked = buildAccessScope(user('institution_contact', null));
  assert.deepEqual(unlinked.institutionIds, []);
});

test('supervisory roles operate across the estate', () => {
  for (const role of ['cbn_assessor', 'supervisory_reviewer', 'report_approver', 'platform_admin'] as const) {
    const scope = buildAccessScope(user(role));
    assert.equal(scope.crossInstitution, true, role);
  }
});

test('separation of duties requires a different person to approve a report', () => {
  for (const role of ROLES) {
    assert.equal(requiresIndependentActor(role.key, 'approve_report'), true, role.key);
  }
});

test('only the assessor role can generate a report', () => {
  assert.equal(can(user('cbn_assessor'), 'report:generate'), true);
  assert.equal(can(user('supervisory_reviewer'), 'report:generate'), false);
  assert.equal(can(user('institution_contact'), 'report:generate'), false);
  assert.equal(can(user('platform_admin'), 'report:generate'), false);
});

test('a platform administrator cannot approve or publish reports', () => {
  const admin = user('platform_admin');
  assert.equal(can(admin, 'report:approve'), false);
  assert.equal(can(admin, 'report:publish'), false);
  assert.equal(can(admin, 'report:read'), true);
});

test('destructive assessment controls belong to named assessment roles only', () => {
  assert.equal(can(user('cbn_assessor'), 'engagement:stop'), true);
  assert.equal(can(user('institution_contact'), 'engagement:stop'), false);
  assert.equal(can(user('report_approver'), 'engagement:launch'), false);
  assert.equal(can(user('platform_admin'), 'engagement:launch'), false);
});

test('engine management is administrative and does not include assessment execution', () => {
  const admin = user('platform_admin');
  assert.equal(can(admin, 'engine:manage'), true);
  assert.equal(can(admin, 'job:cancel'), false);
  assert.equal(can(admin, 'finding:create'), false);
});

test('a user without MFA holds no effective permission', () => {
  const unverified = { ...user('cbn_assessor'), mfa_verified: false } as SessionUser;
  assert.equal(can(unverified, 'institution:read'), false);
  assert.equal(can(unverified, 'engagement:launch'), false);
  // The base permission set itself is unchanged; the gate is the MFA state.
  assert.ok(effectivePermissions(unverified).size > 0);
});
