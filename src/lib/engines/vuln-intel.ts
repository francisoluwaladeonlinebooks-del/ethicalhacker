/**
 * Vulnerability intelligence for software composition analysis.
 *
 * The platform can use:
 *   1. an imported OSV database artefact (JSON) supplied by an administrator, or
 *   2. the configured OSV endpoint (if the deployment allows outbound access), or
 *   3. the curated offline reference corpus shipped with the demonstration.
 *
 * Provenance is always reported with the results. If no intelligence source is
 * available the engine reports the gap - it never reports "clean".
 */

export type VulnerabilityRecord = {
  id: string;
  ecosystem: string;
  package: string;
  summary: string;
  details?: string;
  affected: { introduced: string; fixed?: string }[];
  severityHint?: 'critical' | 'high' | 'medium' | 'low';
  knownExploited?: boolean;
  reference?: string;
};

export type IntelProvenance = {
  source: string;
  updatedAt: string | null;
  recordCount: number;
  reliable: boolean;
  note: string;
};

/** Curated demonstration corpus. Real identifiers with documented fixed versions. */
export const CURATED_CORPUS: VulnerabilityRecord[] = [
  { id: 'CVE-2021-44228', ecosystem: 'Maven', package: 'org.apache.logging.log4j:log4j-core', summary: 'Log4Shell: JNDI features in log messages allow remote code execution.', affected: [{ introduced: '2.0.0', fixed: '2.15.0' }], severityHint: 'critical', knownExploited: true, reference: 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228' },
  { id: 'CVE-2021-45046', ecosystem: 'Maven', package: 'org.apache.logging.log4j:log4j-core', summary: 'Incomplete fix for Log4Shell allows denial of service and remote code execution in some configurations.', affected: [{ introduced: '2.15.0', fixed: '2.16.0' }], severityHint: 'critical', knownExploited: true, reference: 'https://nvd.nist.gov/vuln/detail/CVE-2021-45046' },
  { id: 'CVE-2021-23337', ecosystem: 'npm', package: 'lodash', summary: 'Command injection via template function.', affected: [{ introduced: '0.0.0', fixed: '4.17.21' }], severityHint: 'high', reference: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm' },
  { id: 'CVE-2020-8203', ecosystem: 'npm', package: 'lodash', summary: 'Prototype pollution in zipObjectDeep.', affected: [{ introduced: '0.0.0', fixed: '4.17.19' }], severityHint: 'high', reference: 'https://github.com/advisories/GHSA-p6mc-m468-83gw' },
  { id: 'CVE-2021-44906', ecosystem: 'npm', package: 'minimist', summary: 'Prototype pollution in minimist.', affected: [{ introduced: '0.0.0', fixed: '1.2.6' }], severityHint: 'critical', reference: 'https://github.com/advisories/GHSA-xvch-5gv4-984h' },
  { id: 'CVE-2023-45857', ecosystem: 'npm', package: 'axios', summary: 'XSRF token leakage to third-party hosts via absolute URLs.', affected: [{ introduced: '0.8.1', fixed: '1.6.0' }], severityHint: 'medium', reference: 'https://github.com/advisories/GHSA-wf5p-g6vw-rhxx' },
  { id: 'CVE-2022-0235', ecosystem: 'npm', package: 'node-fetch', summary: 'Exposure of sensitive headers on redirect to untrusted hosts.', affected: [{ introduced: '0.0.0', fixed: '2.6.7' }], severityHint: 'high', reference: 'https://github.com/advisories/GHSA-r683-j2x4-v87g' },
  { id: 'CVE-2022-24999', ecosystem: 'npm', package: 'qs', summary: 'Prototype pollution in qs parsing.', affected: [{ introduced: '0.0.0', fixed: '6.10.3' }], severityHint: 'high', reference: 'https://github.com/advisories/GHSA-hrpp-h998-j3pp' },
  { id: 'CVE-2022-23529', ecosystem: 'npm', package: 'jsonwebtoken', summary: 'Insecure key retrieval can allow token verification bypass in specific implementations.', affected: [{ introduced: '0.0.0', fixed: '9.0.0' }], severityHint: 'high', reference: 'https://github.com/advisories/GHSA-27h2-hvpr-p6h2' },
  { id: 'CVE-2022-29078', ecosystem: 'npm', package: 'ejs', summary: 'Server-side template injection via settings[view options][outputFunctionName].', affected: [{ introduced: '0.0.0', fixed: '3.1.7' }], severityHint: 'critical', reference: 'https://github.com/advisories/GHSA-phwq-j96m-2c2q' },
  { id: 'CVE-2022-31129', ecosystem: 'npm', package: 'moment', summary: 'Inefficient parsing of long strings allows denial of service.', affected: [{ introduced: '0.0.0', fixed: '2.29.4' }], severityHint: 'high', reference: 'https://github.com/advisories/GHSA-wc69-rhjr-hc9g' },
  { id: 'CVE-2022-22965', ecosystem: 'Maven', package: 'org.springframework:spring-core', summary: 'Spring4Shell: data binding allows remote code execution on JDK 9+ deployments.', affected: [{ introduced: '0.0.0', fixed: '5.3.18' }], severityHint: 'critical', knownExploited: true, reference: 'https://nvd.nist.gov/vuln/detail/CVE-2022-22965' },
  { id: 'CVE-2022-42889', ecosystem: 'Maven', package: 'org.apache.commons:commons-text', summary: 'Text4Shell: script evaluation in StringSubstitutor.', affected: [{ introduced: '1.5', fixed: '1.10.0' }], severityHint: 'critical', reference: 'https://nvd.nist.gov/vuln/detail/CVE-2022-42889' },
  { id: 'CVE-2022-42003', ecosystem: 'Maven', package: 'com.fasterxml.jackson.core:jackson-databind', summary: 'Deep wrapper array nesting causes stack exhaustion.', affected: [{ introduced: '0.0.0', fixed: '2.13.4.2' }], severityHint: 'high', reference: 'https://nvd.nist.gov/vuln/detail/CVE-2022-42003' },
  { id: 'CVE-2023-32681', ecosystem: 'PyPI', package: 'requests', summary: 'Proxy-Authorization header leaked on redirect to a third-party host.', affected: [{ introduced: '0.0.0', fixed: '2.31.0' }], severityHint: 'medium', reference: 'https://github.com/advisories/GHSA-j8r2-6x86-q33q' },
  { id: 'CVE-2023-45803', ecosystem: 'PyPI', package: 'urllib3', summary: 'Request body not stripped on cross-origin redirect for non-POST methods.', affected: [{ introduced: '0.0.0', fixed: '2.0.7' }], severityHint: 'medium', reference: 'https://github.com/advisories/GHSA-g4mx-q9vg-27p4' },
  { id: 'CVE-2021-0341', ecosystem: 'Maven', package: 'com.squareup.okhttp3:okhttp', summary: 'Improper certificate hostname verification in older OkHttp versions.', affected: [{ introduced: '0.0.0', fixed: '4.9.2' }], severityHint: 'high', reference: 'https://nvd.nist.gov/vuln/detail/CVE-2021-0341' },
  { id: 'CVE-2022-25647', ecosystem: 'Maven', package: 'com.google.code.gson:gson', summary: 'Deserialization of untrusted data can cause denial of service.', affected: [{ introduced: '0.0.0', fixed: '2.8.9' }], severityHint: 'medium', reference: 'https://nvd.nist.gov/vuln/detail/CVE-2022-25647' },
];

export const CURATED_PROVENANCE: IntelProvenance = {
  source: 'FICAP curated reference corpus (demonstration dataset)',
  updatedAt: '2026-10-01T00:00:00.000Z',
  recordCount: CURATED_CORPUS.length,
  reliable: true,
  note: 'Small curated corpus of real advisories used for the isolated demonstration. Import an OSV database or configure the OSV endpoint for complete coverage.',
};

function parseVersion(version: string): number[] {
  return version
    .replace(/^[^0-9]*/, '')
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

export function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const length = Math.max(av.length, bv.length);
  for (let i = 0; i < length; i += 1) {
    const left = av[i] ?? 0;
    const right = bv[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

export function isAffected(version: string | null, record: VulnerabilityRecord): boolean {
  if (!version) return false;
  for (const range of record.affected) {
    if (compareVersions(version, range.introduced) < 0) continue;
    if (range.fixed && compareVersions(version, range.fixed) >= 0) continue;
    return true;
  }
  return false;
}

export type DependencyInput = { name: string; version: string | null; ecosystem: string; direct: boolean; sourcePath?: string; license?: string };

export type MatchedVulnerability = { dependency: DependencyInput; vulnerability: VulnerabilityRecord; fixedVersion: string | null };

export function matchVulnerabilities(dependencies: DependencyInput[], corpus: VulnerabilityRecord[]): MatchedVulnerability[] {
  const matches: MatchedVulnerability[] = [];
  for (const dependency of dependencies) {
    const records = corpus.filter((record) => record.package.toLowerCase() === dependency.name.toLowerCase() && record.ecosystem === dependency.ecosystem);
    for (const record of records) {
      if (isAffected(dependency.version, record)) {
        const fixed = record.affected
          .map((r) => r.fixed)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .sort(compareVersions)
          .pop() ?? null;
        matches.push({ dependency, vulnerability: record, fixedVersion: fixed });
      }
    }
  }
  // Highest severity first, then known exploited.
  const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return matches.sort((a, b) => (rank[b.vulnerability.severityHint ?? 'low'] - rank[a.vulnerability.severityHint ?? 'low']) || Number(b.vulnerability.knownExploited) - Number(a.vulnerability.knownExploited));
}

export type OsvImport = { records: VulnerabilityRecord[]; provenance: IntelProvenance };

/** Parse an imported OSV dataset artefact into the internal record shape. */
export function parseOsvDataset(raw: string): OsvImport {
  const doc = JSON.parse(raw);
  const entries: any[] = Array.isArray(doc) ? doc : Array.isArray(doc.vulns) ? doc.vulns : [];
  const records: VulnerabilityRecord[] = [];
  for (const entry of entries) {
    for (const affected of entry.affected ?? []) {
      const packageName = affected.package?.name;
      const ecosystem = affected.package?.ecosystem;
      if (!packageName || !ecosystem) continue;
      const ranges = (affected.ranges ?? []).flatMap((range: any) =>
        (range.events ?? []).reduce((acc: any[], event: any) => {
          if (event.introduced !== undefined) acc.push({ introduced: event.introduced });
          else if (event.fixed !== undefined && acc.length) acc[acc.length - 1].fixed = event.fixed;
          return acc;
        }, []),
      );
      if (!ranges.length) continue;
      records.push({
        id: entry.id,
        ecosystem,
        package: packageName,
        summary: entry.summary ?? entry.details?.slice(0, 200) ?? entry.id,
        details: entry.details,
        affected: ranges,
        severityHint: undefined,
        reference: `https://osv.dev/vulnerability/${entry.id}`,
      });
    }
  }
  return {
    records,
    provenance: {
      source: 'Imported OSV dataset',
      updatedAt: new Date().toISOString(),
      recordCount: records.length,
      reliable: records.length > 0,
      note: records.length ? 'OSV dataset imported by a platform administrator.' : 'Imported dataset contained no usable OSV records.',
    },
  };
}
