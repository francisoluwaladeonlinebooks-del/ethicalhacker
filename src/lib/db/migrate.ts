import fs from 'node:fs';
import path from 'node:path';
import { withSystem, type Tx } from '@/lib/db/pool';
import { FRAMEWORK_SEEDS, FRAMEWORK_MAPPINGS } from '@/lib/frameworks/catalog';
import { PERMISSION_DESCRIPTIONS, ROLE_PERMISSIONS, ROLES } from '@/lib/rbac';

const SCHEMA_PATH = path.resolve(process.cwd(), 'src/lib/db/schema.sql');

/** Apply the schema. Idempotent: every statement uses IF NOT EXISTS / DROP ... IF EXISTS. */
export async function applySchema(tx: Tx): Promise<void> {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await tx.exec(sql);
}

export async function seedRolePermissions(tx: Tx): Promise<void> {
  for (const role of ROLES) {
    for (const permission of ROLE_PERMISSIONS[role.key]) {
      await tx.query(
        `INSERT INTO role_permissions (role, permission, description) VALUES ($1,$2,$3)
         ON CONFLICT (role, permission) DO UPDATE SET description = EXCLUDED.description`,
        [role.key, permission, PERMISSION_DESCRIPTIONS[permission] ?? ''],
      );
    }
  }
}

export async function seedSettings(tx: Tx): Promise<void> {
  const defaults: { key: string; value: unknown; description: string; isSecret?: boolean }[] = [
    { key: 'platform_mode', value: 'demo', description: 'demo = synthetic training range only; live = authorised production assessments' },
    { key: 'organisation_name', value: 'Central Bank of Nigeria', description: 'Shown in reports and navigation' },
    { key: 'platform_name', value: 'FICAP', description: 'Financial Institution Cybersecurity Assurance Platform' },
    { key: 'global_kill_switch', value: false, description: 'When true, no new assessment work may start and running jobs are cancelled' },
    { key: 'require_independent_verification', value: true, description: 'Findings must be verified by a second authorised user before closure' },
    { key: 'require_independent_report_approval', value: true, description: 'Reports must be approved by someone other than the generator' },
    { key: 'evidence_retention_days', value: 730, description: 'Default evidence retention period (supervisory preservation may extend this)' },
    { key: 'artifact_retention_days', value: 180, description: 'Default retention for uploaded APK/IPA/source artefacts' },
    { key: 'default_max_requests_per_second', value: 2, description: 'Default engagement request rate limit' },
    { key: 'default_max_concurrency', value: 2, description: 'Default engagement concurrency limit' },
    { key: 'default_max_requests_total', value: 2000, description: 'Default total request budget per engagement' },
    { key: 'default_max_duration_minutes', value: 120, description: 'Default maximum assessment duration' },
    { key: 'ai_enabled', value: false, description: 'Enable the optional AI security analyst' },
    { key: 'ai_provider_endpoint', value: '', description: 'OpenAI-compatible chat completion endpoint', isSecret: true },
    { key: 'ai_provider_model', value: '', description: 'Model identifier' },
    { key: 'ai_provider_key', value: '', description: 'Provider API key (encrypted at rest, never returned to the browser)', isSecret: true },
    { key: 'osv_endpoint', value: 'https://api.osv.dev/v1/querybatch', description: 'OSV vulnerability intelligence endpoint' },
    { key: 'session_idle_minutes', value: 30, description: 'Idle session timeout' },
    { key: 'login_max_attempts', value: 5, description: 'Failed sign-in attempts before lockout' },
  ];
  for (const setting of defaults) {
    await tx.query(
      `INSERT INTO settings (key, value, description, is_secret) VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, is_secret = EXCLUDED.is_secret`,
      [setting.key, JSON.stringify(setting.value), setting.description, Boolean(setting.isSecret)],
    );
  }
}

export async function seedEngines(tx: Tx): Promise<void> {
  const engines = [
    {
      key: 'web',
      name: 'Web Application Assessment Engine',
      version: '1.0.0',
      requires: ['Approved in-scope URL assets', 'Engagement approved test plan'],
      notes: 'Passive, single-request checks aligned to OWASP WSTG. No destructive or high-volume testing.',
    },
    {
      key: 'api',
      name: 'API Security Assessment Engine',
      version: '1.0.0',
      requires: ['OpenAPI or Postman specification, or manual endpoint inventory', 'Approved API base URL'],
      notes: 'OWASP API Security Top 10 aligned checks. Object/function level tests require approved test identities.',
    },
    {
      key: 'mobile',
      name: 'Mobile Application Assessment Engine',
      version: '1.0.0',
      requires: ['Authorised APK/AAB/IPA artefact', 'Optional test device or emulator for dynamic checks'],
      notes: 'Static artefact analysis (manifest, plist, strings, dependencies). Dynamic testing requires instrumentation.',
    },
    {
      key: 'dependencies',
      name: 'Software Supply Chain Engine',
      version: '1.0.0',
      requires: ['Lockfile, manifest or mobile artefact'],
      notes: 'Matches components against configured OSV intelligence. Without intelligence it reports the gap rather than "clean".',
    },
    {
      key: 'correlation',
      name: 'Findings Correlation Engine',
      version: '1.0.0',
      requires: ['At least one completed assessment job'],
      notes: 'Groups duplicate findings, detects recurring weaknesses and links framework references.',
    },
  ];
  for (const engine of engines) {
    await tx.query(
      `INSERT INTO engines (key, name, version, status, requires, notes) VALUES ($1,$2,$3,'enabled',$4,$5)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, requires = EXCLUDED.requires, notes = EXCLUDED.notes, updated_at = now()`,
      [engine.key, engine.name, engine.version, JSON.stringify(engine.requires), engine.notes],
    );
  }
}

/**
 * Seed framework catalogues without ever overwriting imported official text.
 * Existing rows are preserved so historical assessments keep the wording
 * (and version) that was in force when they were performed.
 */
export async function seedFrameworks(tx: Tx): Promise<void> {
  for (const seed of FRAMEWORK_SEEDS) {
    const existing = await tx.queryOne<{ id: string }>('SELECT id FROM frameworks WHERE key = $1 AND version = $2', [seed.key, seed.version]);
    let frameworkId = existing?.id;
    if (!frameworkId) {
      const inserted = await tx.queryOne<{ id: string }>(
        `INSERT INTO frameworks (key, name, version, publisher, source_url, status, verification_status, is_primary, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [seed.key, seed.name, seed.version, seed.publisher, seed.sourceUrl, seed.status, seed.verificationStatus, seed.isPrimary, seed.notes],
      );
      frameworkId = inserted!.id;
    }
    let order = 0;
    for (const item of seed.items) {
      order += 1;
      await tx.query(
        `INSERT INTO framework_items
          (framework_id, parent_code, item_type, code, title, description, objective, platform, test_method,
           preconditions, expected, automation, severity_guidance, external_refs, sort_order, verification_status, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (framework_id, code) DO NOTHING`,
        [
          frameworkId,
          item.parentCode ?? null,
          item.itemType,
          item.code,
          item.title,
          item.description ?? null,
          item.objective ?? null,
          item.platform ?? null,
          item.testMethod ?? null,
          item.preconditions ?? null,
          item.expected ?? null,
          item.automation ?? null,
          item.severityGuidance ?? null,
          JSON.stringify(item.externalRefs ?? []),
          item.sortOrder ?? order,
          item.verificationStatus ?? 'seeded',
          JSON.stringify(item.metadata ?? {}),
        ],
      );
    }
  }

  for (const mapping of FRAMEWORK_MAPPINGS) {
    await tx.query(
      `INSERT INTO framework_mappings (source_framework, source_code, target_framework, target_code, mapping_type, confidence, rationale)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (source_framework, source_code, target_framework, target_code) DO NOTHING`,
      [
        mapping.source_framework,
        mapping.source_code,
        mapping.target_framework,
        mapping.target_code,
        mapping.mapping_type,
        mapping.confidence,
        mapping.rationale,
      ],
    );
  }
}

export async function migrate(): Promise<void> {
  await withSystem(async (tx) => {
    await applySchema(tx);
    await seedRolePermissions(tx);
    await seedSettings(tx);
    await seedEngines(tx);
    await seedFrameworks(tx);
  });
}

let readyPromise: Promise<void> | null = null;

/** Lazily migrate and seed baseline configuration once per process. */
export function ensureDatabaseReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = migrate().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export async function databaseSummary() {
  return withSystem(async (tx) => {
    const version = await tx.queryOne<{ version: string }>('SELECT version() AS version');
    const counts = await tx.query<{ table_name: string; rows: string }>(`
      SELECT 'institutions' AS table_name, count(*)::text AS rows FROM institutions
      UNION ALL SELECT 'applications', count(*)::text FROM applications
      UNION ALL SELECT 'engagements', count(*)::text FROM engagements
      UNION ALL SELECT 'findings', count(*)::text FROM findings
      UNION ALL SELECT 'evidence', count(*)::text FROM evidence
      UNION ALL SELECT 'audit_events', count(*)::text FROM audit_events
      UNION ALL SELECT 'framework_items', count(*)::text FROM framework_items
    `);
    return { version: version?.version ?? 'unknown', counts };
  });
}
