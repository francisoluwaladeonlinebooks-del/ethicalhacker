import type { AccessScope } from '@/lib/db/pool';

/**
 * Role based access control.
 *
 * Five roles are defined by the CBN supervisory model. Permissions are
 * deliberately fine grained so that separation of duties can be enforced
 * (plan approval, independent verification, report approval) and so that the
 * platform super administrator does not automatically receive access to
 * institution confidential assessment evidence.
 */

export type Role =
  | 'platform_admin'
  | 'cbn_assessor'
  | 'supervisory_reviewer'
  | 'institution_contact'
  | 'report_approver';

export const ROLES: { key: Role; name: string; description: string }[] = [
  {
    key: 'platform_admin',
    name: 'Platform Super Administrator',
    description:
      'Configures the platform, manages users, engines and framework catalogues, and monitors platform health. Access to institution findings and evidence requires a separately recorded access grant.',
  },
  {
    key: 'cbn_assessor',
    name: 'CBN Security Assessor',
    description:
      'Creates authorised engagements, defines scope, runs permitted assessments, validates findings, assigns severity and generates technical reports.',
  },
  {
    key: 'supervisory_reviewer',
    name: 'Supervisory Reviewer',
    description:
      'Reviews findings and evidence, compares risk profiles across the portfolio, approves reports, tracks remediation and monitors institution level trends.',
  },
  {
    key: 'institution_contact',
    name: 'Financial Institution Security Contact',
    description:
      'Sees only their own institution’s shared findings, remediation guidance and approved evidence. Cannot modify independently verified assessment evidence.',
  },
  {
    key: 'report_approver',
    name: 'Independent Report Approver',
    description:
      'Reviews methodology and evidence quality, challenges unsupported conclusions, and approves or returns reports. Cannot approve a report they authored.',
  },
];

export type Permission =
  | 'institution:read'
  | 'institution:write'
  | 'institution:portfolio'
  | 'application:read'
  | 'application:write'
  | 'supervisory_note:read'
  | 'supervisory_note:write'
  | 'engagement:read'
  | 'engagement:create'
  | 'engagement:update'
  | 'engagement:authorize'
  | 'engagement:plan:approve'
  | 'engagement:launch'
  | 'engagement:stop'
  | 'job:read'
  | 'job:cancel'
  | 'job:retry'
  | 'finding:read'
  | 'finding:create'
  | 'finding:update'
  | 'finding:verify'
  | 'finding:severity:override'
  | 'finding:close'
  | 'evidence:read'
  | 'evidence:create'
  | 'evidence:download'
  | 'evidence:share'
  | 'remediation:read'
  | 'remediation:submit'
  | 'remediation:review'
  | 'retest:request'
  | 'retest:perform'
  | 'retest:verify'
  | 'report:read'
  | 'report:generate'
  | 'report:approve'
  | 'report:publish'
  | 'framework:read'
  | 'framework:manage'
  | 'audit:read'
  | 'user:manage'
  | 'settings:manage'
  | 'engine:manage'
  | 'access_grant:manage'
  | 'ai:use';

/**
 * Permissions that can only be exercised after an explicit, time boxed and
 * audited access grant record exists (used for platform administrators).
 */
export const GRANT_REQUIRED: Permission[] = ['finding:read', 'evidence:read', 'evidence:download', 'supervisory_note:read'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  platform_admin: [
    'institution:read',
    'application:read',
    'engagement:read',
    'job:read',
    'framework:read',
    'framework:manage',
    'audit:read',
    'user:manage',
    'settings:manage',
    'engine:manage',
    'access_grant:manage',
    'report:read',
  ],
  cbn_assessor: [
    'institution:read',
    'institution:write',
    'institution:portfolio',
    'application:read',
    'application:write',
    'supervisory_note:read',
    'supervisory_note:write',
    'engagement:read',
    'engagement:create',
    'engagement:update',
    'engagement:authorize',
    'engagement:plan:approve',
    'engagement:launch',
    'engagement:stop',
    'job:read',
    'job:cancel',
    'job:retry',
    'finding:read',
    'finding:create',
    'finding:update',
    'finding:verify',
    'finding:severity:override',
    'evidence:read',
    'evidence:create',
    'evidence:download',
    'evidence:share',
    'remediation:read',
    'remediation:review',
    'retest:request',
    'retest:perform',
    'retest:verify',
    'report:read',
    'report:generate',
    'framework:read',
    'ai:use',
  ],
  supervisory_reviewer: [
    'institution:read',
    'institution:portfolio',
    'application:read',
    'supervisory_note:read',
    'supervisory_note:write',
    'engagement:read',
    'job:read',
    'finding:read',
    'evidence:read',
    'evidence:download',
    'remediation:read',
    'remediation:review',
    'retest:verify',
    'report:read',
    'report:approve',
    'report:publish',
    'framework:read',
    'audit:read',
    'ai:use',
  ],
  institution_contact: [
    'institution:read',
    'application:read',
    'engagement:read',
    'finding:read',
    'evidence:read',
    'evidence:download',
    'remediation:read',
    'remediation:submit',
    'retest:request',
    'report:read',
    'framework:read',
  ],
  report_approver: [
    'institution:read',
    'application:read',
    'engagement:read',
    'finding:read',
    'evidence:read',
    'evidence:download',
    'report:read',
    'report:approve',
    'framework:read',
  ],
};

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'institution:read': 'View institution registry records within scope',
  'institution:write': 'Create and update institution records',
  'institution:portfolio': 'View aggregate cross-institution supervisory analytics',
  'application:read': 'View application inventory records',
  'application:write': 'Add and update applications under assessment',
  'supervisory_note:read': 'Read confidential supervisory notes',
  'supervisory_note:write': 'Author confidential supervisory notes',
  'engagement:read': 'View engagements and their authorisation records',
  'engagement:create': 'Create engagements',
  'engagement:update': 'Modify engagement scope and authorisation details',
  'engagement:authorize': 'Record and approve engagement authorisation',
  'engagement:plan:approve': 'Approve assessment test plans before execution',
  'engagement:launch': 'Launch approved assessments',
  'engagement:stop': 'Stop an engagement or engage the global kill switch',
  'job:read': 'View assessment job status and logs',
  'job:cancel': 'Cancel queued or running assessment jobs',
  'job:retry': 'Retry failed assessment jobs',
  'finding:read': 'View findings',
  'finding:create': 'Create and edit draft findings',
  'finding:update': 'Update finding content, remediation and framework mappings',
  'finding:verify': 'Independently verify a finding',
  'finding:severity:override': 'Override the computed technical severity with documented rationale',
  'finding:close': 'Close, accept risk or mark a finding as a false positive',
  'evidence:read': 'Read evidence artefacts',
  'evidence:create': 'Upload and attach evidence',
  'evidence:download': 'Download evidence artefacts',
  'evidence:share': 'Approve evidence for sharing with the institution',
  'remediation:read': 'View remediation plans and submissions',
  'remediation:submit': 'Submit remediation notes and evidence',
  'remediation:review': 'Review and accept remediation submissions',
  'retest:request': 'Request a retest',
  'retest:perform': 'Perform a retest',
  'retest:verify': 'Independently verify a retest result',
  'report:read': 'View generated reports',
  'report:generate': 'Generate draft reports',
  'report:approve': 'Approve or return reports for revision',
  'report:publish': 'Publish an approved report',
  'framework:read': 'View framework catalogues and coverage',
  'framework:manage': 'Import, version and manage framework catalogues',
  'audit:read': 'Read the audit trail',
  'user:manage': 'Create users and assign roles',
  'settings:manage': 'Change platform configuration',
  'engine:manage': 'Enable, disable and configure assessment engines',
  'access_grant:manage': 'Grant and revoke time boxed access grants',
  'ai:use': 'Use the optional AI security analyst',
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  institution_id: string | null;
  job_title?: string | null;
  mfa_verified: boolean;
  grantedPermissions?: Permission[];
};

export function basePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function effectivePermissions(user: SessionUser): Set<Permission> {
  const set = new Set<Permission>(basePermissions(user.role));
  // Grant-required permissions are NOT part of the base set for platform admins.
  for (const extra of user.grantedPermissions ?? []) {
    if (GRANT_REQUIRED.includes(extra)) set.add(extra);
  }
  return set;
}

export function can(user: SessionUser, permission: Permission): boolean {
  if (!user.mfa_verified) return false;
  const perms = effectivePermissions(user);
  return perms.has(permission);
}

export function canAny(user: SessionUser, permissions: Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}

export function assertPermission(user: SessionUser, permission: Permission): void {
  if (!can(user, permission)) {
    const error = new Error(`Missing permission: ${permission}`) as Error & { status?: number; code?: string };
    error.status = 403;
    error.code = 'forbidden';
    throw error;
  }
}

/**
 * Build the database access scope for a session. Institution contacts are
 * confined to their own institution (also enforced by row level security).
 */
export function buildAccessScope(user: SessionUser, options: { requestId?: string; ip?: string; mode?: 'demo' | 'live' } = {}): AccessScope {
  const permissions = effectivePermissions(user);
  if (user.role === 'institution_contact') {
    return {
      userId: user.id,
      role: user.role,
      institutionIds: user.institution_id ? [user.institution_id] : [],
      crossInstitution: false,
      ...options,
    };
  }
  // Every non-institution role operates across the supervisory estate. Confidential evidence
  // is additionally gated by permission and by an explicit, time boxed access grant in the
  // service layer (see assertAccessGrant), never by the row level scope alone.
  return { userId: user.id, role: user.role, institutionIds: [], crossInstitution: true, ...options };
}

/** True when two distinct people are required (separation of duties). */
export function requiresIndependentActor(role: Role, action: 'verify_finding' | 'approve_report' | 'approve_plan'): boolean {
  if (action === 'approve_report') return true;
  if (action === 'approve_plan') return role !== 'platform_admin';
  return role !== 'institution_contact';
}
