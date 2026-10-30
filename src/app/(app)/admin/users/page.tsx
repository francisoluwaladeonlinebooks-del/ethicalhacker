import { pageContext, query, flashFrom } from '@/lib/page-context';
import { ROLES, PERMISSION_DESCRIPTIONS, basePermissions } from '@/lib/rbac';
import {
  Card, CardHeader, CardBody, PageHeader, Badge, TableWrap, Field, Flash, DataQualityNote, formatDate, relativeDays,
} from '@/components/ui';
import { createUserAction, setUserStatusAction } from '@/app/actions/admin';
import { Csrf } from '@/components/csrf';

export const dynamic = 'force-dynamic';

export default async function UsersAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await pageContext('user:manage');
  const flash = flashFrom(params);

  const data = await query(ctx, async (tx) => {
    const users = await tx.query<any>(
      `SELECT u.id, u.email, u.name, u.role, u.job_title, u.status, u.mfa_enrolled_at, u.last_login_at, u.created_at,
              i.name AS institution_name,
              (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id) AS active_sessions
         FROM users u LEFT JOIN institutions i ON i.id = u.institution_id
        ORDER BY u.role, u.name`,
    );
    const institutions = await tx.query<any>('SELECT id, name FROM institutions ORDER BY name');
    return { users, institutions };
  });

  const byRole = data.users.reduce((acc: Record<string, number>, user: any) => {
    acc[user.role] = (acc[user.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Users and roles"
        description="Least privilege by role, plus institution- and engagement-level scope enforced on the server. Hiding a menu item is never used as the only control."
        meta={
          <>
            <Badge tone="slate">{data.users.length} accounts</Badge>
            <Badge tone="green">{data.users.filter((user: any) => user.mfa_enrolled_at).length} with MFA enrolled</Badge>
            {data.users.filter((user: any) => user.status !== 'active').length ? <Badge tone="red">{data.users.filter((user: any) => user.status !== 'active').length} inactive</Badge> : null}
          </>
        }
      />

      <Flash notice={flash.notice} error={flash.error} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Accounts" subtitle="Suspending an account revokes its sessions immediately. MFA is mandatory and cannot be disabled per user." />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Name</th><th>Role</th><th>Scope</th><th>MFA</th><th>Status</th><th>Last sign-in</th><th>Sessions</th><th /></tr></thead>
                <tbody>
                  {data.users.map((user: any) => (
                    <tr key={user.id}>
                      <td className="text-2xs">
                        <div className="font-medium">{user.name}</div>
                        <div className="text-[var(--ficap-muted)]">{user.email}</div>
                        {user.job_title ? <div className="text-[var(--ficap-muted)]">{user.job_title}</div> : null}
                      </td>
                      <td className="text-2xs capitalize">{String(user.role).replace(/_/g, ' ')}</td>
                      <td className="text-2xs">{user.institution_name ?? <span className="text-[var(--ficap-muted)]">cross-institution (permission checked)</span>}</td>
                      <td className="text-2xs">{user.mfa_enrolled_at ? <Badge tone="green">enrolled</Badge> : <Badge tone="amber">pending</Badge>}</td>
                      <td className="text-2xs"><Badge tone={user.status === 'active' ? 'green' : 'red'}>{user.status}</Badge></td>
                      <td className="whitespace-nowrap text-2xs">{user.last_login_at ? relativeDays(user.last_login_at) : 'never'}</td>
                      <td className="font-mono text-2xs">{user.active_sessions}</td>
                      <td className="text-right">
                        {user.id === ctx.user.id ? (
                          <span className="text-2xs text-[var(--ficap-muted)]">current user</span>
                        ) : (
                          <form action={setUserStatusAction}>
                            <Csrf />
                            <input type="hidden" name="userId" value={user.id} />
                            <input type="hidden" name="status" value={user.status === 'active' ? 'suspended' : 'active'} />
                            <button className="btn btn-ghost btn-xs" type="submit">{user.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <Card>
            <CardHeader title="Role matrix" subtitle="Permissions are additive per role; no role inherits another. Platform administration does not by itself grant access to institution evidence." />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Role</th><th>Purpose</th><th>Permissions</th></tr></thead>
                <tbody>
                  {ROLES.map((role) => (
                    <tr key={role.key}>
                      <td className="whitespace-nowrap text-2xs font-medium capitalize">{role.name}</td>
                      <td className="max-w-[24rem] text-2xs">{role.description}</td>
                      <td className="text-2xs">
                        <details>
                          <summary className="cursor-pointer text-[var(--ficap-muted)]">{basePermissions(role.key).length} permissions</summary>
                          <ul className="mt-1 space-y-0.5">
                            {basePermissions(role.key).map((permission) => (
                              <li key={permission} className="font-mono text-[10px]">{permission} <span className="font-sans text-[var(--ficap-muted)]">— {PERMISSION_DESCRIPTIONS[permission]}</span></li>
                            ))}
                          </ul>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Create an account" subtitle="The initial password is set by the administrator and must be changed by policy. MFA enrolment is mandatory." />
            <CardBody>
              <form action={createUserAction} className="space-y-2">
                <Csrf />
                <Field label="Full name" name="name" required><input name="name" className="input" required /></Field>
                <Field label="Email" name="email" required><input name="email" type="email" className="input" required /></Field>
                <Field label="Job title" name="jobTitle"><input name="jobTitle" className="input" /></Field>
                <Field label="Role" name="role" required>
                  <select name="role" className="input" required defaultValue="cbn_assessor">
                    {ROLES.map((role) => <option key={role.key} value={role.key}>{String(role.key).replace(/_/g, ' ')}</option>)}
                  </select>
                </Field>
                <Field label="Institution (required for institution contacts)" name="institutionId">
                  <select name="institutionId" className="input">
                    <option value="">—</option>
                    {data.institutions.map((institution: any) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
                  </select>
                </Field>
                <Field label="Initial password" name="password" required hint="At least 12 characters with upper and lower case, a digit and a symbol. Never reused from another service.">
                  <input name="password" type="password" className="input" required autoComplete="new-password" />
                </Field>
                <button className="btn btn-primary btn-sm" type="submit">Create account</button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Accounts by role" />
            <CardBody>
              <dl className="kv">
                {ROLES.map((role) => (
                  <div key={role.key} className="contents">
                    <dt className="capitalize">{String(role.key).replace(/_/g, ' ')}</dt>
                    <dd className="font-mono">{byRole[role.key] ?? 0}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-2xs text-[var(--ficap-muted)]">
                Six-eyes principle: report approval, plan approval and finding verification each require an actor other than the author.
              </p>
            </CardBody>
          </Card>

          <DataQualityNote>
            Every account change is written to the audit trail with the acting administrator, the target account and the reason. Access grants beyond a role's
            base permission set are recorded separately and reviewed.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
