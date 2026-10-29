import type { Tx } from '@/lib/db/pool';
import type { RequestContext } from '@/lib/db/context';
import { listApplications } from '@/lib/domain/applications';

/** Data needed by the assessment module pages. */
export async function loadModuleView(
  tx: Tx,
  ctx: RequestContext,
  options: { module: string; frameworkKeys: string[]; applicationId?: string },
) {
  const params: unknown[] = [options.frameworkKeys, ctx.mode];
  const clauses = ['tr.framework_key = ANY($1::text[])', 'i.data_mode = $2'];
  if (options.applicationId) {
    params.push(options.applicationId);
    clauses.push(`tr.application_id = $${params.length}`);
  }
  const results = await tx.query(
    `SELECT tr.*, a.name AS application_name, i.name AS institution_name
       FROM test_results tr
       JOIN institutions i ON i.id = tr.institution_id
       LEFT JOIN applications a ON a.id = tr.application_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY tr.executed_at DESC
      LIMIT 200`,
    params,
  );
  const lastJobParams: unknown[] = [options.module];
  if (options.applicationId) lastJobParams.push(options.applicationId);
  const lastJob = await tx.queryOne<any>(
    `SELECT j.* FROM assessment_jobs j
      WHERE j.module = $1 ${options.applicationId ? 'AND j.application_id = $2' : ''}
      ORDER BY j.created_at DESC LIMIT 1`,
    lastJobParams,
  );
  const applications = await listApplications(tx, ctx, {});
  return { results, lastJob, applications };
}

export const MODULE_FRAMEWORKS: Record<string, string[]> = {
  web: ['owasp-wstg', 'owasp-api-top10', 'nist-csf'],
  api: ['owasp-api-top10', 'owasp-wstg', 'nist-csf'],
  mobile: ['owasp-masvs', 'owasp-mastg', 'nist-csf'],
  dependencies: ['owasp-masvs', 'nist-csf'],
};
