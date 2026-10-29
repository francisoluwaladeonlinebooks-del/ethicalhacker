import type { Tx } from '@/lib/db/pool';
import type { CvssMetrics } from '@/lib/cvss/engine';

/** Finding produced by an automated check, before persistence and scoring. */
export type FindingDraft = {
  title: string;
  category: string;
  subcategory?: string;
  asset: string;
  endpoint?: string;
  appVersion?: string;
  description: string;
  businessImpact: string;
  detectionMethod: string;
  confidence: 'low' | 'medium' | 'high';
  cwes?: string[];
  cvss?: CvssMetrics;
  frameworkLinks: { frameworkKey: string; frameworkVersion: string; itemCode: string; relationship?: 'supports' | 'root_cause' | 'affected_control' | 'related'; rationale?: string }[];
  remediation: {
    rootCause: string;
    containment?: string;
    shortTerm: string;
    permanentFix: string;
    verificationCriteria: string;
    retestProcedure: string;
    evidenceRequired: string;
    ownerTeam: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
  };
  evidenceIds?: string[];
  contextHints?: {
    exposure?: 'internet' | 'partner' | 'internal';
    affectsCustomerFunds?: boolean;
    affectsPaymentIntegrity?: boolean;
    privilegedAccess?: boolean;
    compensatingControls?: 'strong' | 'partial' | 'none';
  };
};

export type CheckStatus = 'passed' | 'failed' | 'needs_verification' | 'blocked' | 'skipped' | 'error';

export type CheckOutcome = {
  status: CheckStatus;
  expected: string;
  observed: string;
  detail?: string;
  evidenceIds?: string[];
  findings?: FindingDraft[];
  requestsMade?: number;
};

export type FetchedResponse = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyBytes: number;
  truncated: boolean;
  durationMs: number;
  redirectChain: { url: string; status: number; location: string | null }[];
};

export type EngineContext = {
  tx: Tx;
  jobId: string;
  institutionId: string;
  engagementId: string;
  applicationId: string;
  mode: 'demo' | 'live';
  client: AssessmentTargetClientLike;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => Promise<void>;
  capture: (title: string, content: string | FetchedResponse, mediaType?: string, share?: boolean) => Promise<string>;
  recordResult: (input: {
    checkKey: string;
    frameworkKey: string;
    frameworkVersion: string;
    frameworkItemCode: string;
    status: CheckStatus;
    expected?: string;
    observed?: string;
    evidenceId?: string | null;
    isManual?: boolean;
  }) => Promise<void>;
  allowed: {
    inputProbes: boolean;
    authenticatedTests: boolean;
    objectAuthorization: boolean;
    dynamicMobile: boolean;
    boundedRateLimit: boolean;
  };
  approvedPaths: string[];
  appVersion: string | null;
};

export interface AssessmentTargetClientLike {
  request(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number }): Promise<FetchedResponse>;
  requestsMade: number;
  remainingBudget: number;
  baseUrl: string;
  origin: string;
  allowLoopbackTrainingRange: boolean;
}

export type CheckDefinition = {
  key: string;
  title: string;
  module: 'web' | 'api' | 'mobile' | 'dependencies';
  frameworkKey: string;
  frameworkVersion: string;
  frameworkItemCode: string;
  automation: 'automated' | 'hybrid' | 'manual';
  /** A check that needs a capability the engagement has not authorised is recorded as skipped/blocked, never "passed". */
  requires?: ('input_validation' | 'authenticated_testing' | 'object_authorization' | 'dynamic_mobile' | 'bounded_rate_limit')[];
  run: (ctx: EngineContext) => Promise<CheckOutcome>;
};
