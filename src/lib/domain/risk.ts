/**
 * Contextual banking risk.
 *
 * Technical severity (CVSS v4.0) is never altered to reflect business context.
 * This module produces a separate, documented contextual rating and a
 * remediation priority that combines both views, with a written rationale.
 */

export type RiskDimension =
  | 'exposure'
  | 'data_sensitivity'
  | 'customer_funds'
  | 'payment_integrity'
  | 'privileged_access'
  | 'reachability'
  | 'compensating_controls'
  | 'confidence'
  | 'exploitation_evidence';

export type RiskDimensions = Partial<Record<RiskDimension, number>>;

export const RISK_DIMENSIONS: {
  key: RiskDimension;
  label: string;
  weight: number;
  help: string;
  options: { value: number; label: string }[];
}[] = [
  {
    key: 'exposure',
    label: 'Exposure',
    weight: 15,
    help: 'Where the affected component is reachable from.',
    options: [
      { value: 3, label: 'Public internet' },
      { value: 2, label: 'Partner / third-party network' },
      { value: 1, label: 'Internal network only' },
      { value: 0, label: 'Isolated test environment' },
    ],
  },
  {
    key: 'data_sensitivity',
    label: 'Data sensitivity',
    weight: 15,
    help: 'Sensitivity of the data the weakness exposes.',
    options: [
      { value: 3, label: 'Customer identity, credentials or payment data' },
      { value: 2, label: 'Confidential business data' },
      { value: 1, label: 'Internal non-sensitive data' },
      { value: 0, label: 'Public data' },
    ],
  },
  {
    key: 'customer_funds',
    label: 'Customer funds impact',
    weight: 20,
    help: 'Whether successful exploitation can move or expose customer funds.',
    options: [
      { value: 3, label: 'Direct movement of customer funds possible' },
      { value: 2, label: 'Indirect or conditional funds impact' },
      { value: 1, label: 'No funds impact but fraud enabler' },
      { value: 0, label: 'No financial impact' },
    ],
  },
  {
    key: 'payment_integrity',
    label: 'Payment integrity',
    weight: 15,
    help: 'Effect on the integrity of payments, settlement or ledgers.',
    options: [
      { value: 3, label: 'Payment or ledger integrity can be altered' },
      { value: 2, label: 'Transaction state can be manipulated' },
      { value: 1, label: 'Limited transaction impact' },
      { value: 0, label: 'No payment impact' },
    ],
  },
  {
    key: 'privileged_access',
    label: 'Privileged access exposure',
    weight: 10,
    help: 'Whether privileged or maker/checker functionality is exposed.',
    options: [
      { value: 3, label: 'Administrative or maker-checker functions exposed' },
      { value: 2, label: 'Elevated staff functions exposed' },
      { value: 1, label: 'Customer-level functions only' },
      { value: 0, label: 'No access control implication' },
    ],
  },
  {
    key: 'reachability',
    label: 'Reachability / affected services',
    weight: 10,
    help: 'How many services or channels are affected.',
    options: [
      { value: 3, label: 'Multiple channels or shared platform services' },
      { value: 2, label: 'One production channel' },
      { value: 1, label: 'One non-production environment' },
      { value: 0, label: 'Unreachable in current configuration' },
    ],
  },
  {
    key: 'compensating_controls',
    label: 'Compensating controls',
    weight: 10,
    help: 'Strength of existing compensating controls observed during assessment.',
    options: [
      { value: 3, label: 'None identified' },
      { value: 2, label: 'Weak / partially effective' },
      { value: 1, label: 'Moderate, documented control' },
      { value: 0, label: 'Strong, independently verified control' },
    ],
  },
  {
    key: 'confidence',
    label: 'Confidence in the finding',
    weight: 5,
    help: 'Evidential confidence in the finding.',
    options: [
      { value: 3, label: 'High — reproduced with evidence' },
      { value: 2, label: 'Medium — observed behaviour, not fully reproduced' },
      { value: 1, label: 'Low — indicator only' },
    ],
  },
  {
    key: 'exploitation_evidence',
    label: 'Exploitation evidence',
    weight: 10,
    help: 'Whether exploitation has been observed or credible public techniques exist.',
    options: [
      { value: 3, label: 'Exploited in the wild (observed)' },
      { value: 2, label: 'Credible public exploitation technique' },
      { value: 1, label: 'Proof of concept only' },
      { value: 0, label: 'No exploitation evidence' },
    ],
  },
];

export type ContextualRiskResult = {
  score: number;
  rating: 'low' | 'medium' | 'high' | 'critical';
  rationale: string;
  contributions: { key: string; label: string; value: number; weighted: number }[];
};

export function computeContextualRisk(dimensions: RiskDimensions): ContextualRiskResult {
  let weightedSum = 0;
  let maxSum = 0;
  const contributions: ContextualRiskResult['contributions'] = [];
  for (const dimension of RISK_DIMENSIONS) {
    const value = dimensions[dimension.key] ?? 0;
    const bounded = Math.max(0, Math.min(3, value));
    const weighted = bounded * dimension.weight;
    weightedSum += weighted;
    maxSum += 3 * dimension.weight;
    contributions.push({ key: dimension.key, label: dimension.label, value: bounded, weighted });
  }
  const score = maxSum === 0 ? 0 : Math.round((weightedSum / maxSum) * 1000) / 10;
  const rating = score >= 75 ? 'critical' : score >= 55 ? 'high' : score >= 35 ? 'medium' : 'low';
  const top = [...contributions].sort((a, b) => b.weighted - a.weighted).slice(0, 3).filter((c) => c.value > 0);
  const rationale =
    `Contextual score ${score.toFixed(1)}/100 (${rating.toUpperCase()}) derived from weighted banking risk dimensions. ` +
    (top.length ? `Dominant factors: ${top.map((t) => `${t.label} (${t.value}/3)`).join(', ')}. ` : '') +
    'This rating is independent of the CVSS v4.0 technical score and never alters it.';
  return { score, rating, rationale, contributions };
}

export type TechnicalSeverity = 'unscored' | 'none' | 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_INDEX: Record<TechnicalSeverity, number> = { unscored: 0, none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export type PriorityResult = {
  band: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  label: 'Immediate' | 'High' | 'Medium' | 'Low' | 'Informational';
  index: number;
  reason: string;
};

/**
 * Remediation priority combines technical severity with contextual banking
 * risk. The underlying CVSS score is never modified; the reason is recorded so
 * the decision can be reviewed.
 */
export function computePriority(technicalSeverity: TechnicalSeverity, contextualRating?: string | null): PriorityResult {
  const tech = SEVERITY_INDEX[technicalSeverity] ?? 0;
  const ctxMap: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  const ctx = contextualRating ? (ctxMap[contextualRating] ?? 0) : 0;
  const index = technicalSeverity === 'unscored' && ctx === 0 ? 0 : Math.round((tech * 0.45 + ctx * 0.55) * 10) / 10;

  if (index >= 3.6) {
    return {
      band: 'P1',
      label: 'Immediate',
      index,
      reason: `Technical severity ${technicalSeverity} combined with contextual banking risk ${contextualRating ?? 'unrated'} places this finding in the immediate remediation band.`,
    };
  }
  if (index >= 2.6) {
    return {
      band: 'P2',
      label: 'High',
      index,
      reason: `Technical severity ${technicalSeverity} and contextual risk ${contextualRating ?? 'unrated'} require remediation within the current supervisory cycle.`,
    };
  }
  if (index >= 1.6) {
    return { band: 'P3', label: 'Medium', index, reason: `Moderate combined rating (technical ${technicalSeverity}, contextual ${contextualRating ?? 'unrated'}).` };
  }
  if (index >= 0.6) {
    return { band: 'P4', label: 'Low', index, reason: `Low combined rating (technical ${technicalSeverity}, contextual ${contextualRating ?? 'unrated'}).` };
  }
  return { band: 'P5', label: 'Informational', index, reason: 'No material technical or contextual risk recorded.' };
}

export function defaultDimensions(technicalSeverity: TechnicalSeverity): RiskDimensions {
  switch (technicalSeverity) {
    case 'critical':
      return { exposure: 3, data_sensitivity: 3, customer_funds: 3, payment_integrity: 3, privileged_access: 2, reachability: 2, compensating_controls: 3, confidence: 3, exploitation_evidence: 2 };
    case 'high':
      return { exposure: 3, data_sensitivity: 3, customer_funds: 2, payment_integrity: 2, privileged_access: 2, reachability: 2, compensating_controls: 2, confidence: 3, exploitation_evidence: 2 };
    case 'medium':
      return { exposure: 3, data_sensitivity: 2, customer_funds: 1, payment_integrity: 1, privileged_access: 1, reachability: 2, compensating_controls: 2, confidence: 2, exploitation_evidence: 1 };
    case 'low':
      return { exposure: 2, data_sensitivity: 1, customer_funds: 0, payment_integrity: 0, privileged_access: 0, reachability: 1, compensating_controls: 1, confidence: 2, exploitation_evidence: 0 };
    default:
      return {};
  }
}
