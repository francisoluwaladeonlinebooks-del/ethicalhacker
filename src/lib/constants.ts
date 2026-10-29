/** Shared enumerations used by forms, validation and reporting. */

export const TEST_METHODS: { key: string; label: string; description: string }[] = [
  {
    key: 'unauthenticated_http',
    label: 'Unauthenticated HTTP review',
    description: 'Read-only requests (GET/HEAD by default) against in-scope endpoints, inside the approved rate limit.',
  },
  {
    key: 'authenticated_testing',
    label: 'Authenticated testing with synthetic identities',
    description: 'Testing using institution-provisioned synthetic accounts only. Customer credentials are never requested or stored.',
  },
  {
    key: 'api_testing',
    label: 'API specification and endpoint testing',
    description: 'OpenAPI/Postman import, schema and authorisation checks against the approved API base path.',
  },
  {
    key: 'mobile_static_analysis',
    label: 'Mobile static analysis',
    description: 'Offline analysis of an uploaded APK/AAB/IPA. No device or account is required.',
  },
  {
    key: 'mobile_dynamic_analysis',
    label: 'Mobile dynamic analysis',
    description: 'Requires an approved device farm, instrumented build and test identities. Recorded as blocked when unavailable.',
  },
  {
    key: 'dependency_analysis',
    label: 'Dependency and supply-chain analysis',
    description: 'Manifest and lockfile analysis matched against a curated vulnerability intelligence snapshot.',
  },
  {
    key: 'configuration_review',
    label: 'Configuration review',
    description: 'Review of transport, headers, cookie and session configuration without modifying state.',
  },
  {
    key: 'source_code_review',
    label: 'Source code review (institution supplied)',
    description: 'Offline review of code supplied by the institution under an explicit handling agreement.',
  },
];

export const METHOD_LABELS: Record<string, string> = Object.fromEntries(TEST_METHODS.map((method) => [method.key, method.label]));

export const CHANNELS = [
  { key: 'web', label: 'Web application' },
  { key: 'api', label: 'API / service' },
  { key: 'mobile_android', label: 'Mobile — Android' },
  { key: 'mobile_ios', label: 'Mobile — iOS' },
  { key: 'mobile_both', label: 'Mobile — both platforms' },
  { key: 'admin', label: 'Administrative panel' },
  { key: 'service', label: 'Back-office service' },
];

export const INSTITUTION_CATEGORIES = [
  { key: 'commercial_bank', label: 'Commercial bank' },
  { key: 'microfinance_bank', label: 'Microfinance bank' },
  { key: 'payment_service_provider', label: 'Payment service provider' },
  { key: 'other', label: 'Other approved institution' },
];

export const RISK_TIERS = ['critical', 'high', 'medium', 'low', 'unassessed'];

export const ENVIRONMENTS = [
  { key: 'test', label: 'Test' },
  { key: 'staging', label: 'Staging' },
  { key: 'sandbox', label: 'Sandbox' },
  { key: 'production', label: 'Production' },
];

export const DATA_SENSITIVITY = [
  { key: 'public', label: 'Public' },
  { key: 'internal', label: 'Internal' },
  { key: 'confidential', label: 'Confidential' },
  { key: 'restricted', label: 'Restricted (customer or payment data)' },
];

export const SESSION_POLICY = {
  absoluteHours: 8,
  idleMinutes: 30,
  pendingMfaMinutes: 10,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unscored'] as const;
export const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical (9.0–10.0)',
  high: 'High (7.0–8.9)',
  medium: 'Medium (4.0–6.9)',
  low: 'Low (0.1–3.9)',
  none: 'None (0.0)',
  unscored: 'Not scored',
};
