import { MACROVECTOR_SCORES, MAX_COMPOSED, MAX_SEVERITY, METRIC_ORDER, CVSS4_SPEC_VERSION } from './tables';

/**
 * CVSS v4.0 scoring engine.
 *
 * Independent TypeScript implementation of the official FIRST specification.
 * The algorithm follows the published scoring procedure (equivalence sets →
 * macrovector lookup → severity distance interpolation) and is validated
 * against reference vectors in tests/cvss4.test.ts.
 *
 * Supplemental metrics (Safety, Automatable, Recovery, Value Density, Provider
 * Urgency) never change the score - they are recorded for context only.
 */

export type MetricGroup = 'base' | 'threat' | 'environmental' | 'supplemental';

export type MetricValueDef = { value: string; label: string; description: string };

export type MetricDef = {
  key: string;
  name: string;
  group: MetricGroup;
  required: boolean;
  values: MetricValueDef[];
  help: string;
};

const v = (value: string, label: string, description: string): MetricValueDef => ({ value, label, description });

const CORE_METRICS: MetricDef[] = [
  {
    key: 'AV',
    name: 'Attack Vector',
    group: 'base',
    required: true,
    help: 'How the vulnerable component is reached. For internet banking portals this is usually Network.',
    values: [
      v('N', 'Network', 'Remotely exploitable across the internet or an adjacent network.'),
      v('A', 'Adjacent', 'Requires a logically adjacent network position (same bank branch LAN, VPN segment).'),
      v('L', 'Local', 'Requires local access or a user-executed payload on the host.'),
      v('P', 'Physical', 'Requires physical interaction with the device (common for mobile banking).'),
    ],
  },
  {
    key: 'AC',
    name: 'Attack Complexity',
    group: 'base',
    required: true,
    help: 'Conditions beyond the attacker’s control that must exist to exploit the issue.',
    values: [
      v('L', 'Low', 'No specialised conditions; reproducible exploitation.'),
      v('H', 'High', 'Requires a race condition, specific configuration or significant reconnaissance.'),
    ],
  },
  {
    key: 'AT',
    name: 'Attack Requirements',
    group: 'base',
    required: true,
    help: 'Preexisting deployment or execution conditions required for the attack to succeed.',
    values: [
      v('N', 'None', 'The attack succeeds without special deployment or runtime conditions.'),
      v('P', 'Present', 'Depends on a specific deployment/runtime condition (e.g. a particular proxy or mobile OS build).'),
    ],
  },
  {
    key: 'PR',
    name: 'Privileges Required',
    group: 'base',
    required: true,
    help: 'Level of privileges the attacker must hold in the vulnerable system (e.g. a customer login).',
    values: [
      v('N', 'None', 'Unauthenticated, or no privileged access needed.'),
      v('L', 'Low', 'An ordinary authenticated user or customer account.'),
      v('H', 'High', 'Administrative or maker/checker level access.'),
    ],
  },
  {
    key: 'UI',
    name: 'User Interaction',
    group: 'base',
    required: true,
    help: 'Whether a user (customer or staff member) must take an action for the attack to succeed.',
    values: [
      v('N', 'None', 'No user interaction is required.'),
      v('P', 'Passive', 'Interaction limited to routine actions without awareness of the attack.'),
      v('A', 'Active', 'The user must actively perform a specific action (e.g. open a link, approve a prompt).'),
    ],
  },
  {
    key: 'VC',
    name: 'Confidentiality (Vulnerable System)',
    group: 'base',
    required: true,
    help: 'Confidentiality impact on the vulnerable application itself.',
    values: [
      v('H', 'High', 'Serious disclosure of customer or account data in the vulnerable system.'),
      v('L', 'Low', 'Limited disclosure of non-sensitive information.'),
      v('N', 'None', 'No confidentiality impact on the vulnerable system.'),
    ],
  },
  {
    key: 'VI',
    name: 'Integrity (Vulnerable System)',
    group: 'base',
    required: true,
    help: 'Integrity impact on the vulnerable application itself (e.g. ability to alter transactions).',
    values: [
      v('H', 'High', 'Serious modification of transactions, balances or configuration.'),
      v('L', 'Low', 'Limited modification with contained consequences.'),
      v('N', 'None', 'No integrity impact on the vulnerable system.'),
    ],
  },
  {
    key: 'VA',
    name: 'Availability (Vulnerable System)',
    group: 'base',
    required: true,
    help: 'Availability impact on the vulnerable application itself.',
    values: [
      v('H', 'High', 'Denial of service of the affected banking service.'),
      v('L', 'Low', 'Degraded performance or partial availability loss.'),
      v('N', 'None', 'No availability impact.'),
    ],
  },
  {
    key: 'SC',
    name: 'Confidentiality (Subsequent Systems)',
    group: 'base',
    required: true,
    help: 'Confidentiality impact on systems connected to, or trusting, the vulnerable component.',
    values: [
      v('H', 'High', 'Serious disclosure from downstream systems (e.g. core banking, card management).'),
      v('L', 'Low', 'Limited downstream disclosure.'),
      v('N', 'None', 'No downstream confidentiality impact.'),
    ],
  },
  {
    key: 'SI',
    name: 'Integrity (Subsequent Systems)',
    group: 'base',
    required: true,
    help: 'Integrity impact on downstream systems, including the safety of settlements and ledgers.',
    values: [
      v('H', 'High', 'Serious downstream modification.'),
      v('L', 'Low', 'Limited downstream modification.'),
      v('N', 'None', 'No downstream integrity impact.'),
    ],
  },
  {
    key: 'SA',
    name: 'Availability (Subsequent Systems)',
    group: 'base',
    required: true,
    help: 'Availability impact on downstream systems.',
    values: [
      v('H', 'High', 'Serious downstream availability impact.'),
      v('L', 'Low', 'Limited downstream availability impact.'),
      v('N', 'None', 'No downstream availability impact.'),
    ],
  },
  {
    key: 'E',
    name: 'Exploit Maturity',
    group: 'threat',
    required: false,
    help: 'Maturity of exploitation evidence. Report observed intelligence honestly; use X only when no information exists.',
    values: [
      v('X', 'Not Defined', 'No exploit intelligence is available.'),
      v('A', 'Attacked', 'Exploitation has been observed in the wild against real targets.'),
      v('P', 'Proof of Concept', 'A working proof of concept or reproducible technique exists.'),
      v('U', 'Unreported', 'No public exploitation evidence exists.'),
    ],
  },
  {
    key: 'CR',
    name: 'Confidentiality Requirement',
    group: 'environmental',
    required: false,
    help: 'Contextual weighting of confidentiality for the assessed institution.',
    values: [
      v('X', 'Not Defined', 'Use the default weighting.'),
      v('H', 'High', 'Confidentiality is critical for this system.'),
      v('M', 'Medium', 'Confidentiality is moderately important.'),
      v('L', 'Low', 'Confidentiality is of limited importance.'),
    ],
  },
  {
    key: 'IR',
    name: 'Integrity Requirement',
    group: 'environmental',
    required: false,
    help: 'Contextual weighting of integrity for the assessed institution.',
    values: [
      v('X', 'Not Defined', 'Use the default weighting.'),
      v('H', 'High', 'Integrity is critical for this system.'),
      v('M', 'Medium', 'Integrity is moderately important.'),
      v('L', 'Low', 'Integrity is of limited importance.'),
    ],
  },
  {
    key: 'AR',
    name: 'Availability Requirement',
    group: 'environmental',
    required: false,
    help: 'Contextual weighting of availability for the assessed institution.',
    values: [
      v('X', 'Not Defined', 'Use the default weighting.'),
      v('H', 'High', 'Availability is critical for this system.'),
      v('M', 'Medium', 'Availability is moderately important.'),
      v('L', 'Low', 'Availability is of limited importance.'),
    ],
  },
  {
    key: 'S',
    name: 'Safety',
    group: 'supplemental',
    required: false,
    help: 'Contextual only - does not affect the score. Indicates a safety impact.',
    values: [v('X', 'Not Defined', ''), v('N', 'Negligible', ''), v('P', 'Present', '')],
  },
  {
    key: 'AU',
    name: 'Automatable',
    group: 'supplemental',
    required: false,
    help: 'Contextual only - does not affect the score.',
    values: [v('X', 'Not Defined', ''), v('N', 'No', ''), v('Y', 'Yes', '')],
  },
  {
    key: 'R',
    name: 'Recovery',
    group: 'supplemental',
    required: false,
    help: 'Contextual only - does not affect the score.',
    values: [v('X', 'Not Defined', ''), v('A', 'Automatic', ''), v('U', 'User', ''), v('I', 'Irrecoverable', '')],
  },
  {
    key: 'V',
    name: 'Value Density',
    group: 'supplemental',
    required: false,
    help: 'Contextual only - does not affect the score.',
    values: [v('X', 'Not Defined', ''), v('D', 'Diffuse', ''), v('C', 'Concentrated', '')],
  },
  {
    key: 'RE',
    name: 'Vulnerability Response Effort',
    group: 'supplemental',
    required: false,
    help: 'Contextual only - does not affect the score.',
    values: [v('X', 'Not Defined', ''), v('L', 'Low', ''), v('M', 'Moderate', ''), v('H', 'High', '')],
  },
  {
    key: 'U',
    name: 'Provider Urgency',
    group: 'supplemental',
    required: false,
    help: 'Contextual only - does not affect the score.',
    values: [v('X', 'Not Defined', ''), v('Clear', 'Clear', ''), v('Green', 'Green', ''), v('Amber', 'Amber', ''), v('Red', 'Red', '')],
  },
];

const MODIFIED_METRICS: MetricDef[] = (['MAV', 'MAC', 'MAT', 'MPR', 'MUI', 'MVC', 'MVI', 'MVA', 'MSC', 'MSI', 'MSA'] as const).map((key) => {
  const baseKey = key.slice(1);
  const base = CORE_METRICS.find((m) => m.key === baseKey)!;
  // Modified Subsequent System impact metrics additionally accept "Safety",
  // which is not available on the base metrics per the official schema.
  const safety: MetricValueDef[] =
    key === 'MSI' || key === 'MSA'
      ? [v('S', 'Safety', 'Compromise of downstream safety properties relevant to this institution.')]
      : [];
  return {
    key,
    name: `Modified ${base.name}`,
    group: 'environmental' as MetricGroup,
    required: false,
    help: `Environmental override for ${base.name}. Leave as Not Defined unless the institution-specific environment genuinely differs.`,
    values: [v('X', 'Not Defined', 'Use the base value.'), ...base.values, ...safety],
  };
});

/** All CVSS v4.0 metrics supported by the scoring workspace. */
export const CVSS4_METRICS: MetricDef[] = [...CORE_METRICS, ...MODIFIED_METRICS];

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(CVSS4_METRICS.map((m) => [m.key, m]));

export const BASE_METRIC_KEYS = CVSS4_METRICS.filter((m) => m.group === 'base').map((m) => m.key);

export type CvssMetrics = Record<string, string>;

export class Cvss4Error extends Error {}

const VALID_VALUES: Record<string, string[]> = Object.fromEntries(
  CVSS4_METRICS.map((m) => [m.key, m.values.map((x) => x.value)]),
);

/** Parse "CVSS:4.0/AV:N/..." into a metric map. Order independent; duplicates rejected. */
export function parseVector(vector: string): CvssMetrics {
  const trimmed = vector.trim();
  if (!trimmed.startsWith('CVSS:4.0/')) {
    throw new Cvss4Error('CVSS v4.0 vectors must begin with "CVSS:4.0/"');
  }
  const parts = trimmed.slice('CVSS:4.0/'.length).split('/');
  const metrics: CvssMetrics = {};
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf(':');
    if (idx === -1) throw new Cvss4Error(`malformed metric segment "${part}"`);
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (!VALID_VALUES[key]) throw new Cvss4Error(`unknown CVSS v4.0 metric "${key}"`);
    if (metrics[key] !== undefined) throw new Cvss4Error(`metric "${key}" defined more than once`);
    if (!VALID_VALUES[key].includes(value)) throw new Cvss4Error(`invalid value "${value}" for metric "${key}"`);
    metrics[key] = value;
  }
  const missing = BASE_METRIC_KEYS.filter((k) => metrics[k] === undefined);
  if (missing.length) throw new Cvss4Error(`missing required base metrics: ${missing.join(', ')}`);
  return metrics;
}

export function buildVector(metrics: CvssMetrics): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const key of METRIC_ORDER) {
    const value = metrics[key];
    if (value && value !== 'X') {
      ordered.push(`${key}:${value}`);
      seen.add(key);
    }
  }
  for (const key of Object.keys(metrics)) {
    if (!seen.has(key) && metrics[key] && metrics[key] !== 'X') ordered.push(`${key}:${metrics[key]}`);
  }
  return `CVSS:4.0/${ordered.join('/')}`;
}

type Levels = Record<string, Record<string, number>>;

const LEVELS: Levels = {
  AV: { N: 0.0, A: 0.1, L: 0.2, P: 0.3 },
  PR: { N: 0.0, L: 0.1, H: 0.2 },
  UI: { N: 0.0, P: 0.1, A: 0.2 },
  AC: { L: 0.0, H: 0.1 },
  AT: { N: 0.0, P: 0.1 },
  VC: { H: 0.0, L: 0.1, N: 0.2 },
  VI: { H: 0.0, L: 0.1, N: 0.2 },
  VA: { H: 0.0, L: 0.1, N: 0.2 },
  SC: { H: 0.1, L: 0.2, N: 0.3 },
  SI: { S: 0.0, H: 0.1, L: 0.2, N: 0.3 },
  SA: { S: 0.0, H: 0.1, L: 0.2, N: 0.3 },
  CR: { H: 0.0, M: 0.1, L: 0.2 },
  IR: { H: 0.0, M: 0.1, L: 0.2 },
  AR: { H: 0.0, M: 0.1, L: 0.2 },
};

const DEFAULT_ENVIRONMENTAL: Record<string, string> = {
  E: 'A',
  CR: 'H',
  IR: 'H',
  AR: 'H',
  MAV: 'X', MAC: 'X', MAT: 'X', MPR: 'X', MUI: 'X',
  MVC: 'X', MVI: 'X', MVA: 'X', MSC: 'X', MSI: 'X', MSA: 'X',
};

function effective(metrics: CvssMetrics, key: string): string {
  if (key === 'E' && (metrics.E ?? 'X') === 'X') return 'A';
  if ((key === 'CR' || key === 'IR' || key === 'AR') && (metrics[key] ?? 'X') === 'X') return 'H';
  if (`M${key}` in metrics && metrics[`M${key}`] && metrics[`M${key}`] !== 'X') return metrics[`M${key}`];
  return metrics[key] ?? DEFAULT_ENVIRONMENTAL[key] ?? 'X';
}

function eqValues(metrics: CvssMetrics) {
  const AV = effective(metrics, 'AV');
  const PR = effective(metrics, 'PR');
  const UI = effective(metrics, 'UI');
  const AC = effective(metrics, 'AC');
  const AT = effective(metrics, 'AT');
  const VC = effective(metrics, 'VC');
  const VI = effective(metrics, 'VI');
  const VA = effective(metrics, 'VA');
  const SC = effective(metrics, 'SC');
  const SI = effective(metrics, 'SI');
  const SA = effective(metrics, 'SA');
  const E = effective(metrics, 'E');
  const CR = effective(metrics, 'CR');
  const IR = effective(metrics, 'IR');
  const AR = effective(metrics, 'AR');
  const MSI = metrics.MSI && metrics.MSI !== 'X' ? metrics.MSI : 'X';
  const MSA = metrics.MSA && metrics.MSA !== 'X' ? metrics.MSA : 'X';

  let eq1 = 2;
  if (AV === 'N' && PR === 'N' && UI === 'N') eq1 = 0;
  else if ((AV === 'N' || PR === 'N' || UI === 'N') && !(AV === 'N' && PR === 'N' && UI === 'N') && AV !== 'P') eq1 = 1;

  const eq2 = AC === 'L' && AT === 'N' ? 0 : 1;

  let eq3 = 2;
  if (VC === 'H' && VI === 'H') eq3 = 0;
  else if (VC === 'H' || VI === 'H' || VA === 'H') eq3 = 1;

  let eq4 = 2;
  if (MSI === 'S' || MSA === 'S') eq4 = 0;
  else if (SC === 'H' || SI === 'H' || SA === 'H') eq4 = 1;

  const eq5 = E === 'A' ? 0 : E === 'P' ? 1 : 2;

  let eq6 = 1;
  if ((CR === 'H' && VC === 'H') || (IR === 'H' && VI === 'H') || (AR === 'H' && VA === 'H')) eq6 = 0;

  return { eq: [eq1, eq2, eq3, eq4, eq5, eq6] as number[], eff: { AV, PR, UI, AC, AT, VC, VI, VA, SC, SI, SA, E, CR, IR, AR } };
}

function finalRounding(x: number): number {
  return Math.round((x + 1e-6) * 10) / 10;
}

export type Cvss4Result = {
  vector: string;
  score: number;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  macroVector: string;
  specVersion: string;
  unscored: boolean;
};

export function severityFromScore(score: number): Cvss4Result['severity'] {
  if (score === 0) return 'none';
  if (score <= 3.9) return 'low';
  if (score <= 6.9) return 'medium';
  if (score <= 8.9) return 'high';
  return 'critical';
}

/**
 * Compute the CVSS v4.0 score for a vector string.
 * Throws Cvss4Error for malformed vectors so that callers can surface an
 * "unscored" state instead of fabricating a rating.
 */
export function scoreVector(vector: string): Cvss4Result {
  const metrics = parseVector(vector);
  return scoreMetrics(metrics);
}

export function scoreMetrics(metrics: CvssMetrics): Cvss4Result {
  const cleaned = buildVector(metrics);
  const { eq, eff } = eqValues(metrics);
  const macroVector = eq.join('');

  const allNone = ['VC', 'VI', 'VA', 'SC', 'SI', 'SA'].every((m) => eff[m as keyof typeof eff] === 'N');
  if (allNone) {
    return { vector: cleaned, score: 0, severity: 'none', macroVector, specVersion: CVSS4_SPEC_VERSION, unscored: false };
  }

  const baseValue = MACROVECTOR_SCORES[macroVector];
  if (baseValue === undefined) throw new Cvss4Error(`no lookup score for macrovector ${macroVector}`);

  const [eq1, eq2, eq3, eq4, eq5, eq6] = eq;
  const nextLower = (index: number, delta: number) => {
    const copy = [...eq];
    copy[index] += delta;
    return copy.join('');
  };
  const lookupOrNaN = (key: string) => (MACROVECTOR_SCORES[key] !== undefined ? MACROVECTOR_SCORES[key] : Number.NaN);

  const scoreEq1 = lookupOrNaN(nextLower(0, 1));
  const scoreEq2 = lookupOrNaN(nextLower(1, 1));

  let scoreEq3Eq6: number;
  if (eq3 === 0 && eq6 === 0) {
    const left = lookupOrNaN(nextLower(5, 1));
    const right = lookupOrNaN(nextLower(2, 1));
    scoreEq3Eq6 = Math.max(left, right);
  } else if (eq3 === 1 && eq6 === 0) {
    scoreEq3Eq6 = lookupOrNaN(nextLower(5, 1));
  } else {
    scoreEq3Eq6 = lookupOrNaN(nextLower(2, 1));
  }

  const scoreEq4 = lookupOrNaN(nextLower(3, 1));
  const scoreEq5 = lookupOrNaN(nextLower(4, 1));

  const eq1Maxes: string[] = MAX_COMPOSED.eq1[String(eq1)];
  const eq2Maxes: string[] = MAX_COMPOSED.eq2[String(eq2)];
  const eq3Eq6Maxes: string[] = MAX_COMPOSED.eq3[String(eq3)][String(eq6)];
  const eq4Maxes: string[] = MAX_COMPOSED.eq4[String(eq4)];
  const eq5Maxes: string[] = MAX_COMPOSED.eq5[String(eq5)];

  const maxVectors: string[] = [];
  for (const a of eq1Maxes) for (const b of eq2Maxes) for (const c of eq3Eq6Maxes) for (const d of eq4Maxes) for (const e of eq5Maxes) {
    maxVectors.push(a + b + c + d + e);
  }

  const extract = (metric: string, source: string): string => {
    const idx = source.indexOf(`${metric}:`);
    if (idx === -1) return 'X';
    const rest = source.slice(idx + metric.length + 1);
    const end = rest.indexOf('/');
    return end === -1 ? rest : rest.slice(0, end);
  };

  let distances: Record<string, number> = {};
  let found = false;
  for (const maxVector of maxVectors) {
    const candidate: Record<string, number> = {};
    let negative = false;
    for (const metric of Object.keys(LEVELS)) {
      const d = LEVELS[metric][eff[metric as keyof typeof eff]] - LEVELS[metric][extract(metric, maxVector)];
      if (Number.isNaN(d) || d === undefined) { negative = true; break; }
      if (d < 0) { negative = true; break; }
      candidate[metric] = d;
    }
    if (!negative) {
      distances = candidate;
      found = true;
      break;
    }
  }
  if (!found) throw new Cvss4Error('could not locate a valid highest-severity vector for the macrovector');

  const distEq1 = distances.AV + distances.PR + distances.UI;
  const distEq2 = distances.AC + distances.AT;
  const distEq3Eq6 = distances.VC + distances.VI + distances.VA + distances.CR + distances.IR + distances.AR;
  const distEq4 = distances.SC + distances.SI + distances.SA;

  const step = 0.1;
  const availableEq1 = baseValue - scoreEq1;
  const availableEq2 = baseValue - scoreEq2;
  const availableEq3Eq6 = baseValue - scoreEq3Eq6;
  const availableEq4 = baseValue - scoreEq4;
  const availableEq5 = baseValue - scoreEq5;

  const maxSeverityEq1 = MAX_SEVERITY.eq1[String(eq1)] * step;
  const maxSeverityEq2 = MAX_SEVERITY.eq2[String(eq2)] * step;
  const maxSeverityEq3Eq6 = MAX_SEVERITY.eq3eq6[String(eq3)][String(eq6)] * step;
  const maxSeverityEq4 = MAX_SEVERITY.eq4[String(eq4)] * step;

  let existingLower = 0;
  let normalizedSum = 0;
  const consider = (available: number, distance: number, maxSeverity: number) => {
    if (Number.isFinite(available) && available >= 0) {
      existingLower += 1;
      normalizedSum += available * (maxSeverity > 0 ? distance / maxSeverity : 0);
    }
  };
  consider(availableEq1, distEq1, maxSeverityEq1);
  consider(availableEq2, distEq2, maxSeverityEq2);
  consider(availableEq3Eq6, distEq3Eq6, maxSeverityEq3Eq6);
  consider(availableEq4, distEq4, maxSeverityEq4);
  if (Number.isFinite(availableEq5) && availableEq5 >= 0) existingLower += 1; // eq5 contributes zero distance

  const meanDistance = existingLower === 0 ? 0 : normalizedSum / existingLower;
  let value = baseValue - meanDistance;
  value = Math.max(0, Math.min(10, value));
  const score = finalRounding(value);

  return {
    vector: cleaned,
    score,
    severity: severityFromScore(score),
    macroVector,
    specVersion: CVSS4_SPEC_VERSION,
    unscored: false,
  };
}

/** Human-readable explanation of a score, used in the risk workspace. */
export function explainScore(result: Cvss4Result, metrics: CvssMetrics): string[] {
  const lines: string[] = [];
  const sev = result.severity.toUpperCase();
  lines.push(`CVSS v4.0 base score ${result.score.toFixed(1)} (${sev}) using equivalence set ${result.macroVector}.`);
  const base = BASE_METRIC_KEYS.filter((k) => metrics[k]).map((k) => `${METRIC_BY_KEY[k].name}: ${metrics[k]}`);
  if (base.length) lines.push(`Base metrics supplied: ${base.join('; ')}.`);
  const threat = ['E'].filter((k) => metrics[k] && metrics[k] !== 'X').map((k) => `${METRIC_BY_KEY[k].name}: ${metrics[k]}`);
  if (threat.length) lines.push(`Threat metrics supplied: ${threat.join('; ')}.`);
  const env = ['CR', 'IR', 'AR'].filter((k) => metrics[k] && metrics[k] !== 'X');
  if (env.length) lines.push(`Environmental requirements supplied: ${env.join(', ')}.`);
  if (!['E'].some((k) => metrics[k] && metrics[k] !== 'X')) {
    lines.push('Exploit Maturity was not supplied, so the specification default (Attacked) applies to the score. Adjust it only with evidence.');
  }
  lines.push('Supplemental metrics are recorded for context and never change the score.');
  return lines;
}

export function isValidVector(vector: string): boolean {
  try {
    scoreVector(vector);
    return true;
  } catch {
    return false;
  }
}
