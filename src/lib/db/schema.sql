-- ===========================================================================
-- FICAP — Financial Institution Cybersecurity Assurance Platform
-- PostgreSQL schema (embedded PostgreSQL 18 via PGlite)
--
-- Design notes
--  * Every tenant-owned table carries institution_id so that row level
--    security can enforce institution isolation independently of the
--    application layer (defence in depth).
--  * The application connects as "postgres" for migrations, but all
--    request-scoped queries run inside a transaction that executes
--    SET LOCAL ROLE ficap_app and sets app.* session variables. Policies
--    below are therefore genuinely enforced for application traffic.
--  * Audit records are append-only and hash chained (see src/lib/domain/audit.ts).
-- ===========================================================================

-- gen_random_uuid() and sha256() are core in PostgreSQL 13+/11+; no extension required.

-- ---------------------------------------------------------------------------
-- Application role used for scoped, RLS-bound queries
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ficap_app') THEN
    CREATE ROLE ficap_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ficap_app;

-- Helper: is the current institution id visible to the current session scope?
CREATE OR REPLACE FUNCTION ficap_scope_ok(p_institution uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_institution IS NULL
      OR coalesce(current_setting('app.cross_institution', true), '0') = '1'
      OR p_institution::text = ANY (
           string_to_array(coalesce(current_setting('app.institution_ids', true), ''), ',')
         );
$$;

-- ---------------------------------------------------------------------------
-- Users, roles, sessions, MFA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE,
  name               text NOT NULL,
  role               text NOT NULL CHECK (role IN ('platform_admin','cbn_assessor','supervisory_reviewer','institution_contact','report_approver')),
  institution_id     uuid,                                  -- set for institution_contact
  job_title          text,
  password_hash      text NOT NULL,
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  mfa_secret_enc     text,                                  -- AES-256-GCM ciphertext (base64)
  mfa_enrolled_at    timestamptz,
  mfa_last_step      bigint,                                -- replay protection
  mfa_required       boolean NOT NULL DEFAULT true,
  failed_attempts    integer NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','locked','invited')),
  is_demo            boolean NOT NULL DEFAULT false,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_institution_idx ON users(institution_id);

CREATE TABLE IF NOT EXISTS role_permissions (
  role        text NOT NULL,
  permission  text NOT NULL,
  description text,
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  csrf_token    text NOT NULL,
  mfa_verified  boolean NOT NULL DEFAULT false,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoked_reason text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS auth_throttle (
  key          text PRIMARY KEY,
  attempts     integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_grants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id uuid,
  permission     text NOT NULL,            -- e.g. evidence:read, supervisory_notes:read
  reason         text NOT NULL,
  approved_by    uuid REFERENCES users(id),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Human readable reference sequences
CREATE SEQUENCE IF NOT EXISTS finding_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS engagement_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS report_ref_seq START 1;

-- ---------------------------------------------------------------------------
-- Institution register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institutions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  category         text NOT NULL CHECK (category IN ('commercial_bank','microfinance_bank','payment_service_provider','other')),
  licence_number   text,
  regulator_ref    text,
  risk_tier        text NOT NULL DEFAULT 'unassessed' CHECK (risk_tier IN ('critical','high','medium','low','unassessed')),
  city             text,
  state            text,
  website          text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','assessment_pending','remediation','closed','suspended')),
  primary_contact_name  text,
  primary_contact_email text,
  description      text,
  data_mode        text NOT NULL DEFAULT 'demo' CHECK (data_mode IN ('demo','live')),
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS institutions_category_idx ON institutions(category, data_mode);

CREATE TABLE IF NOT EXISTS institution_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  name           text NOT NULL,
  email          text NOT NULL,
  phone          text,
  role_title     text,
  is_primary     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS institution_contacts_inst_idx ON institution_contacts(institution_id);

CREATE TABLE IF NOT EXISTS supervisory_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  engagement_id  uuid,
  author_id      uuid NOT NULL REFERENCES users(id),
  classification text NOT NULL DEFAULT 'confidential_supervisory',
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Application inventory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name             text NOT NULL,
  business_purpose text,
  channel          text NOT NULL CHECK (channel IN ('web','api','mobile_android','mobile_ios','mobile_both','admin','service')),
  web_url          text,
  api_base_url     text,
  mobile_platform  text CHECK (mobile_platform IN ('android','ios','both')),
  package_identifier text,
  version          text,
  build            text,
  environment      text NOT NULL DEFAULT 'staging' CHECK (environment IN ('test','staging','sandbox','production')),
  auth_methods     jsonb NOT NULL DEFAULT '[]'::jsonb,
  api_services     jsonb NOT NULL DEFAULT '[]'::jsonb,
  third_parties    jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_sensitivity text NOT NULL DEFAULT 'restricted' CHECK (data_sensitivity IN ('public','internal','confidential','restricted')),
  critical_processes jsonb NOT NULL DEFAULT '[]'::jsonb,
  test_accounts    jsonb NOT NULL DEFAULT '[]'::jsonb,
  boundaries       text,
  exclusions       text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','decommissioned','in_review')),
  data_mode        text NOT NULL DEFAULT 'demo' CHECK (data_mode IN ('demo','live')),
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS applications_inst_idx ON applications(institution_id, channel);

CREATE TABLE IF NOT EXISTS application_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  version        text NOT NULL,
  build          text,
  released_at    date,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Engagements, authorization, scope
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id      uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  description         text,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN
                        ('draft','pending_authorization','authorized','plan_review','approved','running','paused','stopped','completed','cancelled')),
  owner_id            uuid NOT NULL REFERENCES users(id),
  authorization_ref   text,
  scope_approved_at   timestamptz,
  scope_expires_at    timestamptz,
  testing_window_start timestamptz,
  testing_window_end  timestamptz,
  permitted_methods   jsonb NOT NULL DEFAULT '[]'::jsonb,
  prohibited_actions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  emergency_contact_name  text,
  emergency_contact_phone text,
  escalation_procedure    text,
  approved_by         uuid REFERENCES users(id),
  approved_at         timestamptz,
  kill_switch_engaged boolean NOT NULL DEFAULT false,
  kill_switch_reason  text,
  max_requests_per_second numeric(6,2) NOT NULL DEFAULT 2,
  max_concurrency     integer NOT NULL DEFAULT 2,
  max_requests_total  integer NOT NULL DEFAULT 2000,
  max_duration_minutes integer NOT NULL DEFAULT 120,
  data_mode           text NOT NULL DEFAULT 'demo' CHECK (data_mode IN ('demo','live')),
  notes               text,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS engagements_inst_idx ON engagements(institution_id, status);

CREATE TABLE IF NOT EXISTS authorization_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id      uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id     uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  reference          text NOT NULL,
  authorized_by_name text NOT NULL,
  authorized_by_role text NOT NULL,
  authorized_at      timestamptz NOT NULL,
  valid_from         timestamptz NOT NULL,
  valid_to           timestamptz NOT NULL,
  permitted_methods  jsonb NOT NULL DEFAULT '[]'::jsonb,
  prohibited_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  testing_window_start timestamptz,
  testing_window_end   timestamptz,
  document_evidence_id uuid,
  recorded_by        uuid NOT NULL REFERENCES users(id),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','superseded')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_engagement text NOT NULL DEFAULT 'assessor',
  added_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, user_id)
);

CREATE TABLE IF NOT EXISTS engagement_applications (
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  PRIMARY KEY (engagement_id, application_id)
);

CREATE TABLE IF NOT EXISTS scope_assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  asset_type     text NOT NULL CHECK (asset_type IN ('domain','url','ip_address','cidr','api_endpoint','mobile_app','other')),
  value          text NOT NULL,                 -- normalised: host, URL, CIDR or package id
  path_prefix    text,                          -- optional path restriction for url/api assets
  scheme         text CHECK (scheme IN ('https','http')),
  port           integer,
  allowed_methods jsonb NOT NULL DEFAULT '["GET","HEAD"]'::jsonb,
  approved_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_subdomains boolean NOT NULL DEFAULT false,
  is_training_range boolean NOT NULL DEFAULT false,
  ownership_verified boolean NOT NULL DEFAULT false,
  notes          text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, asset_type, value, path_prefix)
);
CREATE INDEX IF NOT EXISTS scope_assets_eng_idx ON scope_assets(engagement_id);

CREATE TABLE IF NOT EXISTS scope_exclusions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  asset_type     text NOT NULL,
  value          text NOT NULL,
  reason         text NOT NULL,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Assessment plans, jobs, test results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  version        integer NOT NULL DEFAULT 1,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','rejected','superseded')),
  frameworks     jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{key, version}]
  modules        jsonb NOT NULL DEFAULT '[]'::jsonb,        -- web/api/mobile/dependencies
  planned_checks jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{check_key, framework_item_code, impact}]
  impact_summary text,
  limitations    text,
  created_by     uuid NOT NULL REFERENCES users(id),
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  approval_note  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessment_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  plan_id        uuid REFERENCES test_plans(id),
  module         text NOT NULL CHECK (module IN ('web','api','mobile','dependencies','correlation','retest')),
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','cancelling','cancelled','succeeded','failed','blocked')),
  progress       integer NOT NULL DEFAULT 0,
  attempts       integer NOT NULL DEFAULT 0,
  max_attempts   integer NOT NULL DEFAULT 1,
  cancel_requested_at timestamptz,
  started_at     timestamptz,
  finished_at    timestamptz,
  error          text,
  blocked_reason text,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits         jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_engagement_idx ON assessment_jobs(engagement_id, status);

CREATE TABLE IF NOT EXISTS job_events (
  id             bigserial PRIMARY KEY,
  job_id         uuid NOT NULL REFERENCES assessment_jobs(id) ON DELETE CASCADE,
  engagement_id  uuid NOT NULL,
  institution_id uuid NOT NULL,
  seq            integer NOT NULL,
  level          text NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error')),
  message        text NOT NULL,
  data           jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events(job_id, seq);

CREATE TABLE IF NOT EXISTS job_checks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES assessment_jobs(id) ON DELETE CASCADE,
  engagement_id  uuid NOT NULL,
  institution_id uuid NOT NULL,
  check_key      text NOT NULL,
  framework_item_code text,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','passed','failed','skipped','blocked','error','needs_verification')),
  detail         text,
  requests_made  integer NOT NULL DEFAULT 0,
  started_at     timestamptz,
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS job_checks_job_idx ON job_checks(job_id);

CREATE TABLE IF NOT EXISTS test_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid REFERENCES assessment_jobs(id) ON DELETE CASCADE,
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  endpoint_id    uuid,
  framework_key  text NOT NULL,
  framework_version text NOT NULL,
  framework_item_code text NOT NULL,
  check_key      text NOT NULL,
  status         text NOT NULL CHECK (status IN ('not_assessed','not_applicable','passed','failed','needs_verification','blocked','error')),
  expected       text,
  observed       text,
  evidence_id    uuid,
  is_manual      boolean NOT NULL DEFAULT false,
  performed_by   uuid REFERENCES users(id),
  notes          text,
  executed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_results_eng_idx ON test_results(engagement_id, framework_key, status);

-- ---------------------------------------------------------------------------
-- Findings, evidence, scoring
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS findings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      text NOT NULL UNIQUE,                 -- FND-2026-0001
  engagement_id  uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  title          text NOT NULL,
  category       text NOT NULL,
  subcategory    text,
  asset          text,
  endpoint       text,
  app_version    text,
  description    text NOT NULL,
  business_impact text,
  cia_impact     jsonb NOT NULL DEFAULT '{}'::jsonb,
  detection_method text NOT NULL,
  confidence     text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low','medium','high')),
  status         text NOT NULL DEFAULT 'new' CHECK (status IN
                   ('new','needs_verification','confirmed','false_positive','accepted_risk','remediation_in_progress','ready_for_retest','resolved','reopened','closed')),
  technical_severity text NOT NULL DEFAULT 'unscored' CHECK (technical_severity IN ('unscored','none','low','medium','high','critical')),
  cvss_vector    text,
  cvss_score     numeric(3,1),
  cvss_version   text DEFAULT '4.0',
  contextual_rating text CHECK (contextual_rating IN ('low','medium','high','critical')),
  contextual_score numeric(4,1),
  priority_rank  integer,
  priority_reason text,
  root_cause     text,
  remediation_summary text,
  compensating_controls text,
  owner_team    text,
  due_date       date,
  fingerprint    text NOT NULL,
  is_systemic    boolean NOT NULL DEFAULT false,
  is_ai_suggested boolean NOT NULL DEFAULT false,
  data_mode      text NOT NULL DEFAULT 'demo' CHECK (data_mode IN ('demo','live')),
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  verified_by    uuid REFERENCES users(id),
  verified_at    timestamptz,
  resolved_at    timestamptz,
  reopened_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS findings_inst_idx ON findings(institution_id, status, technical_severity);
CREATE INDEX IF NOT EXISTS findings_eng_idx ON findings(engagement_id);
CREATE INDEX IF NOT EXISTS findings_fp_idx ON findings(fingerprint);

CREATE TABLE IF NOT EXISTS evidence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  uuid REFERENCES engagements(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  kind           text NOT NULL CHECK (kind IN ('http_exchange','http_response','screenshot','log','artifact','document','manifest','api_spec','other')),
  title          text NOT NULL,
  media_type     text NOT NULL DEFAULT 'text/plain',
  body_enc       bytea NOT NULL,                      -- AES-256-GCM envelope
  body_sha256    text NOT NULL,
  size_bytes     integer NOT NULL,
  redacted       boolean NOT NULL DEFAULT true,
  redactions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  classification text NOT NULL DEFAULT 'confidential' CHECK (classification IN ('internal','confidential','restricted')),
  share_with_institution boolean NOT NULL DEFAULT false,
  retention_until date,
  legal_hold     boolean NOT NULL DEFAULT false,
  data_mode      text NOT NULL DEFAULT 'demo',
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  accessed_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS evidence_inst_idx ON evidence(institution_id, engagement_id);

CREATE TABLE IF NOT EXISTS evidence_access_log (
  id          bigserial PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL CHECK (action IN ('view','download','verify','redact','share','delete')),
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finding_evidence (
  finding_id  uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  caption     text,
  PRIMARY KEY (finding_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS finding_history (
  id          bigserial PRIMARY KEY,
  finding_id  uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  from_status text,
  to_status   text,
  changes     jsonb,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finding_history_idx ON finding_history(finding_id, created_at);

CREATE TABLE IF NOT EXISTS cvss_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id  uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  vector      text NOT NULL,
  score       numeric(3,1) NOT NULL,
  severity    text NOT NULL,
  spec_version text NOT NULL DEFAULT '4.0',
  metrics     jsonb NOT NULL,
  rationale   text,
  is_current  boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id  uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  dimensions  jsonb NOT NULL,
  score       numeric(4,1) NOT NULL,
  rating      text NOT NULL CHECK (rating IN ('low','medium','high','critical')),
  rationale   text,
  assessor_id uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finding_framework_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id     uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  framework_key  text NOT NULL,
  framework_version text NOT NULL,
  item_code      text NOT NULL,
  relationship   text NOT NULL DEFAULT 'supports' CHECK (relationship IN ('supports','root_cause','affected_control','related')),
  rationale      text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, framework_key, item_code)
);

-- ---------------------------------------------------------------------------
-- Remediation and retest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remediation_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id     uuid NOT NULL UNIQUE REFERENCES findings(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  root_cause     text,
  containment    text,
  short_term     text,
  permanent_fix  text,
  owner_team     text,
  verification_criteria text,
  retest_procedure text,
  evidence_required text,
  priority       text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  target_date    date,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','submitted','verified','overdue','closed')),
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS remediation_submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid NOT NULL REFERENCES remediation_plans(id) ON DELETE CASCADE,
  finding_id     uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  submitted_by   uuid NOT NULL REFERENCES users(id),
  notes          text NOT NULL,
  evidence_id    uuid REFERENCES evidence(id),
  status         text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','accepted','rejected','needs_info')),
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id     uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  engagement_id  uuid REFERENCES engagements(id),
  job_id         uuid REFERENCES assessment_jobs(id),
  requested_by   uuid REFERENCES users(id),
  performed_by   uuid REFERENCES users(id),
  status         text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_progress','completed','inconclusive')),
  result         text CHECK (result IN ('resolved','not_resolved','partial','inconclusive')),
  notes          text,
  evidence_id    uuid REFERENCES evidence(id),
  performed_at   timestamptz,
  verified_by    uuid REFERENCES users(id),
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Frameworks and catalogues
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frameworks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL,
  name           text NOT NULL,
  version        text NOT NULL,
  publisher      text NOT NULL,
  source_url     text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','deprecated','superseded')),
  verification_status text NOT NULL DEFAULT 'seeded' CHECK (verification_status IN ('seeded','pending_official_import','imported','verified')),
  is_primary     boolean NOT NULL DEFAULT false,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);

CREATE TABLE IF NOT EXISTS framework_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id   uuid NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  parent_code    text,
  item_type      text NOT NULL CHECK (item_type IN ('function','category','subcategory','requirement','test','risk','metric')),
  code           text NOT NULL,
  title          text NOT NULL,
  description    text,
  objective      text,
  platform       text,
  test_method    text,
  preconditions  text,
  expected       text,
  automation     text CHECK (automation IN ('automated','manual','hybrid')),
  severity_guidance text,
  external_refs  jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order     integer NOT NULL DEFAULT 0,
  verification_status text NOT NULL DEFAULT 'seeded' CHECK (verification_status IN ('seeded','pending_official_import','imported','verified')),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (framework_id, code)
);
CREATE INDEX IF NOT EXISTS framework_items_fw_idx ON framework_items(framework_id, item_type);

CREATE TABLE IF NOT EXISTS framework_mappings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_framework text NOT NULL,
  source_code    text NOT NULL,
  target_framework text NOT NULL,
  target_code    text NOT NULL,
  mapping_type   text NOT NULL DEFAULT 'related',
  confidence     text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low','medium','high')),
  rationale      text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_framework, source_code, target_framework, target_code)
);

-- ---------------------------------------------------------------------------
-- NIST CSF profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nist_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name           text NOT NULL,
  profile_type   text NOT NULL CHECK (profile_type IN ('current','target')),
  notes          text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nist_profile_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid NOT NULL REFERENCES nist_profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  item_code      text NOT NULL,
  status         text NOT NULL DEFAULT 'not_assessed' CHECK (status IN
                   ('not_assessed','evidence_required','partially_supported','supported','improvement_required','not_applicable')),
  evidence_summary text,
  gap_description text,
  priority       text DEFAULT 'medium',
  updated_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, item_code)
);

CREATE TABLE IF NOT EXISTS nist_improvement_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  profile_id     uuid REFERENCES nist_profiles(id) ON DELETE SET NULL,
  item_code      text,
  title          text NOT NULL,
  description    text,
  owner          text,
  priority       text NOT NULL DEFAULT 'medium',
  due_date       date,
  status         text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','deferred')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- API inventory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_endpoints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  engagement_id  uuid REFERENCES engagements(id) ON DELETE SET NULL,
  spec_source    text NOT NULL DEFAULT 'manual' CHECK (spec_source IN ('openapi','postman','manual')),
  spec_version   text,
  base_url       text,
  method         text NOT NULL,
  path           text NOT NULL,
  summary        text,
  auth_required  boolean,
  roles          jsonb NOT NULL DEFAULT '[]'::jsonb,
  params         jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage_status text NOT NULL DEFAULT 'untested' CHECK (coverage_status IN ('untested','tested','blocked','not_applicable')),
  last_tested_at timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, method, path)
);

-- ---------------------------------------------------------------------------
-- Artifacts and dependency intelligence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  engagement_id  uuid REFERENCES engagements(id) ON DELETE SET NULL,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  kind           text NOT NULL CHECK (kind IN ('apk','aab','ipa','zip','source','openapi','postman','osv_db','other')),
  filename       text NOT NULL,
  media_type     text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes     integer NOT NULL,
  sha256         text NOT NULL,
  body_enc       bytea NOT NULL,
  status         text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored','analyzed','failed','quarantined')),
  analysis       jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by    uuid REFERENCES users(id),
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  retention_until date
);

CREATE TABLE IF NOT EXISTS dependency_scans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  engagement_id  uuid REFERENCES engagements(id) ON DELETE SET NULL,
  job_id         uuid REFERENCES assessment_jobs(id) ON DELETE SET NULL,
  artifact_id    uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  source_type    text NOT NULL,          -- lockfile/manifest/artifact
  source_name    text NOT NULL,
  intelligence_source text NOT NULL,     -- e.g. OSV batch API, curated offline corpus
  intelligence_updated_at timestamptz,
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dependencies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id        uuid NOT NULL REFERENCES dependency_scans(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  name           text NOT NULL,
  version        text,
  ecosystem      text NOT NULL,
  is_direct      boolean NOT NULL DEFAULT true,
  license        text,
  source_path    text,
  status         text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','vulnerable','outdated','unsupported','license_risk','unknown'))
);
CREATE INDEX IF NOT EXISTS dependencies_scan_idx ON dependencies(scan_id);

CREATE TABLE IF NOT EXISTS dependency_vulns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dependency_id  uuid NOT NULL REFERENCES dependencies(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL,
  vuln_id        text NOT NULL,          -- CVE-xxxx / GHSA-xxxx
  source         text NOT NULL,
  summary        text,
  details        text,
  affected_range text,
  fixed_version  text,
  severity_hint  text,
  confidence     text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low','medium','high')),
  known_exploited boolean NOT NULL DEFAULT false,
  reference_url  text,
  intelligence_updated_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Reports, approvals, AI suggestions, settings, engines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid,
  engagement_id  uuid REFERENCES engagements(id) ON DELETE SET NULL,
  report_type    text NOT NULL CHECK (report_type IN ('executive','technical','supervisory_portfolio','remediation_status','coverage')),
  title          text NOT NULL,
  period_start   date,
  period_end     date,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','changes_requested','approved','published','superseded')),
  version        integer NOT NULL DEFAULT 1,
  generated_by   uuid REFERENCES users(id),
  generated_at   timestamptz NOT NULL DEFAULT now(),
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  published_at   timestamptz,
  framework_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_sha256 text,
  data_mode      text NOT NULL DEFAULT 'demo',
  confidentiality text NOT NULL DEFAULT 'confidential_supervisory',
  notes          text
);

CREATE TABLE IF NOT EXISTS report_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  decision    text NOT NULL CHECK (decision IN ('approve','return','comment')),
  comments    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid,
  engagement_id  uuid REFERENCES engagements(id) ON DELETE CASCADE,
  finding_id     uuid REFERENCES findings(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  provider       text NOT NULL,
  input_summary  text,
  output         jsonb NOT NULL,
  safety_flags   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','accepted','rejected')),
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  description text,
  is_secret  boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL UNIQUE,
  name           text NOT NULL,
  version        text NOT NULL,
  status         text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled','error','degraded')),
  requires       jsonb NOT NULL DEFAULT '[]'::jsonb,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_health_check timestamptz,
  health         jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes          text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit trail (append-only, hash chained)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id             bigserial PRIMARY KEY,
  seq            bigint NOT NULL UNIQUE,
  at             timestamptz NOT NULL DEFAULT now(),
  at_iso         text NOT NULL,
  actor_id       uuid,
  actor_email    text,
  actor_role     text,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text,
  institution_id uuid,
  engagement_id  uuid,
  ip             text,
  user_agent     text,
  request_id     text,
  data_mode      text,
  outcome        text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','denied','failure')),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash      text,
  hash           text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_inst_idx ON audit_events(institution_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events(action, at DESC);

CREATE OR REPLACE FUNCTION audit_events_no_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP;
END $$;

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_no_update();

-- ---------------------------------------------------------------------------
-- Row level security: institution isolation for institution-facing roles
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'institutions','institution_contacts','supervisory_notes','applications','application_versions',
    'engagements','authorization_records','engagement_members','engagement_applications','scope_assets',
    'scope_exclusions','test_plans','assessment_jobs','job_events','job_checks','test_results','findings',
    'evidence','evidence_access_log','finding_evidence','finding_history','cvss_scores','risk_assessments',
    'finding_framework_links','remediation_plans','remediation_submissions','retests','reports',
    'api_endpoints','artifacts','dependency_scans','dependencies','dependency_vulns','nist_profiles',
    'nist_profile_entries','nist_improvement_actions','ai_suggestions','audit_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    IF t = 'institutions' THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ficap_app
        USING (ficap_scope_ok(id)) WITH CHECK (ficap_scope_ok(id))', t);
    ELSIF t = 'audit_events' THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ficap_app
        USING (institution_id IS NULL AND coalesce(current_setting(''app.cross_institution'', true), ''0'') = ''1''
               OR ficap_scope_ok(institution_id))
        WITH CHECK (ficap_scope_ok(institution_id))', t);
    ELSIF t = 'reports' THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ficap_app
        USING (ficap_scope_ok(institution_id)) WITH CHECK (ficap_scope_ok(institution_id))', t);
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ficap_app
        USING (ficap_scope_ok(institution_id)) WITH CHECK (ficap_scope_ok(institution_id))', t);
    END IF;
  END LOOP;
END $$;

-- The application role needs DML rights (policies still restrict rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ficap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ficap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ficap_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ficap_app;

-- Audit events are insert-only for the application role.
REVOKE UPDATE, DELETE ON audit_events FROM ficap_app;
