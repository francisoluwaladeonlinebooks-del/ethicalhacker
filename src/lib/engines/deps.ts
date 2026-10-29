import type { CheckDefinition, EngineContext, FindingDraft } from '@/lib/engines/types';
import { openZip, extractStrings } from '@/lib/engines/artifacts/zip';
import {
  CURATED_CORPUS,
  CURATED_PROVENANCE,
  matchVulnerabilities,
  type DependencyInput,
  type IntelProvenance,
  type VulnerabilityRecord,
} from '@/lib/engines/vuln-intel';
import type { Tx } from '@/lib/db/pool';
import { redactText } from '@/lib/redact';

const NIST = { frameworkKey: 'nist-csf', frameworkVersion: '2.0' } as const;
const MASVS = { frameworkKey: 'owasp-masvs', frameworkVersion: '2.0' } as const;

export type ParsedManifests = {
  dependencies: DependencyInput[];
  sources: { name: string; ecosystem: string; count: number }[];
  secrets: { source: string; type: string }[];
  licenses: { name: string; license: string }[];
  notes: string[];
};

const MANIFEST_PATTERNS: { pattern: RegExp; ecosystem: string; parser: (content: string, path: string, out: ParsedManifests) => void }[] = [
  {
    pattern: /(^|\/)package-lock\.json$/,
    ecosystem: 'npm',
    parser: (content, path, out) => {
      const doc = JSON.parse(content);
      const packages = doc.packages ?? {};
      for (const [key, value] of Object.entries<any>(packages)) {
        if (!key || key === '' || !value?.version) continue;
        const name = key.replace(/^.*node_modules\//, '');
        if (!name) continue;
        out.dependencies.push({ name, version: String(value.version), ecosystem: 'npm', direct: !key.includes('node_modules/'), sourcePath: path, license: value.license });
      }
      const legacy = doc.dependencies ?? {};
      for (const [name, value] of Object.entries<any>(legacy)) {
        if (!value?.version) continue;
        out.dependencies.push({ name, version: String(value.version), ecosystem: 'npm', direct: true, sourcePath: path });
      }
    },
  },
  {
    pattern: /(^|\/)package\.json$/,
    ecosystem: 'npm',
    parser: (content, path, out) => {
      const doc = JSON.parse(content);
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const [name, range] of Object.entries<string>(doc[section] ?? {})) {
          const version = range.replace(/^[^0-9]*/, '').split(' ')[0];
          out.dependencies.push({ name, version: version || null, ecosystem: 'npm', direct: section === 'dependencies', sourcePath: path });
          if (/^[~^]/.test(range)) out.notes.push(`${name} uses a floating version range (${range}) without a lockfile pin in this manifest.`);
        }
      }
    },
  },
  {
    pattern: /(^|\/)requirements\.txt$/,
    ecosystem: 'PyPI',
    parser: (content, path, out) => {
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = /^([A-Za-z0-9_.-]+)\s*(==|>=|~=|<=)?\s*([^\s;#]+)?/.exec(trimmed);
        if (!match) continue;
        out.dependencies.push({ name: match[1], version: match[3] ?? null, ecosystem: 'PyPI', direct: true, sourcePath: path });
      }
    },
  },
  {
    pattern: /(^|\/)pom\.xml$/,
    ecosystem: 'Maven',
    parser: (content, path, out) => {
      for (const dep of content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
        const group = /<groupId>([^<]+)<\/groupId>/.exec(dep[1])?.[1];
        const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(dep[1])?.[1];
        const version = /<version>([^<]+)<\/version>/.exec(dep[1])?.[1];
        if (group && artifact) {
          out.dependencies.push({ name: `${group}:${artifact}`, version: version && !version.startsWith('$') ? version : null, ecosystem: 'Maven', direct: true, sourcePath: path });
        }
      }
    },
  },
  {
    pattern: /(^|\/)build\.gradle(\.kts)?$/,
    ecosystem: 'Maven',
    parser: (content, path, out) => {
      for (const match of content.matchAll(/(?:implementation|api|compile|runtimeOnly|kapt)\s*\(?\s*['"]([\w.\-]+):([\w.\-]+):([\w.\-]+)['"]/g)) {
        out.dependencies.push({ name: `${match[1]}:${match[2]}`, version: match[3], ecosystem: 'Maven', direct: true, sourcePath: path });
      }
    },
  },
  {
    pattern: /(^|\/)Podfile\.lock$/,
    ecosystem: 'CocoaPods',
    parser: (content, path, out) => {
      for (const match of content.matchAll(/^\s{2}- ([A-Za-z0-9_.\-+/]+) \(([^)]+)\)/gm)) {
        out.dependencies.push({ name: match[1], version: match[2], ecosystem: 'CocoaPods', direct: true, sourcePath: path });
      }
    },
  },
  {
    pattern: /(^|\/)go\.mod$/,
    ecosystem: 'Go',
    parser: (content, path, out) => {
      for (const match of content.matchAll(/^\s*([\w.\-/]+)\s+(v[\w.\-+]+)/gm)) {
        out.dependencies.push({ name: match[1], version: match[2], ecosystem: 'Go', direct: !content.includes('// indirect'), sourcePath: path });
      }
    },
  },
];

export async function collectDependencies(tx: Tx, artifactId: string | null): Promise<ParsedManifests> {
  const result: ParsedManifests = { dependencies: [], sources: [], secrets: [], licenses: [], notes: [] };
  if (!artifactId) {
    result.notes.push('No dependency manifest, lockfile or application artefact was supplied for this application.');
    return result;
  }
  const artifact = await tx.queryOne<{ filename: string; kind: string; body_enc: Uint8Array }>('SELECT filename, kind, body_enc FROM artifacts WHERE id = $1', [artifactId]);
  if (!artifact) {
    result.notes.push('The referenced artefact could not be found.');
    return result;
  }
  const { decrypt } = await import('@/lib/crypto');
  const buffer = decrypt(artifact.body_enc);

  const parseContent = (name: string, content: string) => {
    for (const manifest of MANIFEST_PATTERNS) {
      if (!manifest.pattern.test(name)) continue;
      try {
        manifest.parser(content, name, result);
        result.sources.push({ name, ecosystem: manifest.ecosystem, count: result.dependencies.length });
      } catch (error) {
        result.notes.push(`Could not parse ${name}: ${(error as Error).message}`);
      }
      return;
    }
  };

  const isZip = buffer.subarray(0, 2).toString('utf8') === 'PK';
  if (isZip) {
    try {
      const archive = openZip(buffer);
      const manifests = archive.entries.filter((entry) =>
        MANIFEST_PATTERNS.some((manifest) => manifest.pattern.test(entry.name)) && entry.size < 4 * 1024 * 1024,
      );
      for (const entry of manifests.slice(0, 20)) {
        parseContent(entry.name, archive.read(entry).toString('utf8'));
      }
      if (!manifests.length) result.notes.push('The uploaded archive did not contain a supported dependency manifest or lockfile.');
      // Secret scanning across text-like files in the archive.
      for (const entry of archive.entries.filter((e) => /\.(json|js|ts|env|properties|yml|yaml|xml|gradle|plist|txt)$/i.test(e.name) && e.size < 512 * 1024).slice(0, 60)) {
        const text = archive.read(entry).toString('utf8');
        const redacted = redactText(text);
        for (const redaction of redacted.redactions) {
          result.secrets.push({ source: entry.name, type: redaction.type });
        }
      }
    } catch (error) {
      result.notes.push(`Artefact could not be opened as an archive: ${(error as Error).message}`);
    }
  } else {
    parseContent(artifact.filename, buffer.toString('utf8'));
    if (!result.sources.length) result.notes.push('The supplied artefact is not a supported dependency manifest.');
    const redacted = redactText(buffer.toString('utf8'));
    for (const redaction of redacted.redactions) result.secrets.push({ source: artifact.filename, type: redaction.type });
  }

  // Record the inventory so it is auditable independently of findings.
  for (const source of result.sources) {
    await tx.query(
      `INSERT INTO dependency_scans (institution_id, application_id, engagement_id, artifact_id, source_type, source_name, intelligence_source, intelligence_updated_at, summary)
       SELECT a.institution_id, a.application_id, a.engagement_id, $1, 'manifest', $2, $3, $4, $5 FROM artifacts a WHERE a.id = $1`,
      [
        artifactId,
        source.name,
        CURATED_PROVENANCE.source,
        CURATED_PROVENANCE.updatedAt,
        JSON.stringify({ ecosystem: source.ecosystem, dependencies: result.dependencies.length }),
      ],
    );
  }
  return result;
}

export function dependencyChecks(
  load: () => Promise<ParsedManifests>,
  intel: { corpus: VulnerabilityRecord[]; provenance: IntelProvenance; notes: string[] },
): CheckDefinition[] {
  return [
    {
      key: 'deps.intel.provenance',
      title: 'Vulnerability intelligence provenance',
      module: 'dependencies',
      ...NIST,
      frameworkItemCode: 'ID.RA-02',
      automation: 'automated',
      run: async () => {
        const provenance = intel.provenance;
        return {
          status: provenance.reliable ? 'passed' : 'blocked',
          expected: 'A current, identified vulnerability intelligence source is used.',
          observed: `${provenance.source} · ${provenance.recordCount} record(s) · last updated ${provenance.updatedAt ?? 'unknown'}. ${provenance.note}${
            intel.notes.length ? ` ${intel.notes.join(' ')}` : ''
          }`,
        };
      },
    },
    {
      key: 'deps.inventory.manifests',
      title: 'Dependency inventory completeness',
      module: 'dependencies',
      ...NIST,
      frameworkItemCode: 'ID.AM-02',
      automation: 'automated',
      run: async () => {
        const parsed = await load();
        if (!parsed.sources.length) {
          return {
            status: 'blocked',
            expected: 'A software bill of materials or lockfile is available for the application.',
            observed: parsed.notes.join(' ') || 'No supported manifest was supplied.',
          };
        }
        return {
          status: 'passed',
          expected: 'A software bill of materials or lockfile is available.',
          observed: `${parsed.dependencies.length} component(s) inventoried from ${parsed.sources.map((s) => s.name).join(', ')}.`,
        };
      },
    },
    {
      key: 'deps.vulnerable.components',
      title: 'Known vulnerable components',
      module: 'dependencies',
      ...MASVS,
      frameworkItemCode: 'MASVS-CODE-3',
      automation: 'automated',
      run: async (ctx) => {
        const parsed = await load();
        if (!parsed.dependencies.length) {
          return { status: 'blocked', expected: 'No components with known vulnerabilities.', observed: 'No dependency inventory available, therefore no component could be verified as free of known vulnerabilities.' };
        }
        const matches = matchVulnerabilities(parsed.dependencies, intel.corpus);
        if (!matches.length) {
          return {
            status: 'passed',
            expected: 'No components with known vulnerabilities.',
            observed: `${parsed.dependencies.length} component(s) matched against ${intel.provenance.recordCount} advisory record(s) from ${intel.provenance.source}; no matches.`,
          };
        }
        const findings: FindingDraft[] = [];
        const evidenceIds: string[] = [];
        for (const match of matches.slice(0, 12)) {
          const severity = match.vulnerability.severityHint === 'critical' ? 'high' : match.vulnerability.severityHint === 'high' ? 'high' : 'medium';
          evidenceIds.push(
            await ctx.capture(
              `Vulnerable component ${match.dependency.name} ${match.dependency.version}`,
              `Component: ${match.dependency.name}@${match.dependency.version}\nEcosystem: ${match.dependency.ecosystem}\nSource: ${match.dependency.sourcePath ?? 'n/a'}\nAdvisory: ${match.vulnerability.id}\nSummary: ${match.vulnerability.summary}\nAffected range: introduced ${match.vulnerability.affected.map((a) => a.introduced).join(', ')}\nFixed in: ${match.fixedVersion ?? 'see advisory'}\nIntelligence: ${intel.provenance.source} (${intel.provenance.updatedAt})\nReference: ${match.vulnerability.reference ?? ''}`,
            ),
          );
          findings.push({
            title: `${match.vulnerability.id}: vulnerable component ${match.dependency.name} ${match.dependency.version ?? ''}`.trim(),
            category: 'Vulnerable component',
            asset: match.dependency.ecosystem,
            endpoint: match.dependency.sourcePath,
            description: `${match.dependency.name} ${match.dependency.version ?? ''} is affected by ${match.vulnerability.id}: ${match.vulnerability.summary} Affected versions: introduced ${match.vulnerability.affected.map((a) => a.introduced).join(', ')}; fixed in ${match.fixedVersion ?? 'a later release'}. This records a vulnerable component, not proof of exploitability in this deployment.`,
            businessImpact:
              'A vulnerable third-party component can provide an attacker with a known exploitation path into the banking application. Exploitability depends on reachability and configuration, which must be confirmed during verification.',
            detectionMethod: `Software composition analysis against ${intel.provenance.source} (${intel.provenance.recordCount} records, updated ${intel.provenance.updatedAt ?? 'unknown'}).`,
            confidence: match.fixedVersion ? 'high' : 'medium',
            cwes: ['CWE-1104'],
            cvss: {
              AV: 'N', AC: 'H', AT: 'P', PR: 'N', UI: 'N', VC: 'L', VI: 'L', VA: 'L', SC: 'N', SI: 'N', SA: 'N',
              ...(match.vulnerability.knownExploited ? { AC: 'L', AT: 'N' } : {}),
            },
            frameworkLinks: [
              { ...MASVS, itemCode: 'MASVS-CODE-3', rationale: 'Vulnerable third-party component embedded in or used by the application.' },
              { ...NIST, itemCode: 'PR.PS-02', rationale: 'Software maintenance outcome affected by the unpatched component.' },
            ],
            remediation: {
              rootCause: `The dependency ${match.dependency.name} is pinned to a version within the affected range.`,
              containment: 'Evaluate whether the vulnerable code path is reachable; apply vendor mitigations or compensating controls if immediate upgrade is not possible.',
              shortTerm: `Upgrade ${match.dependency.name} to ${match.fixedVersion ?? 'a version after the fixed release'} or later.`,
              permanentFix: 'Add automated dependency scanning and update policy to the CI pipeline, with an SBOM generated per release.',
              verificationCriteria: `The dependency inventory no longer contains ${match.dependency.name} within the affected range.`,
              retestProcedure: 'Regenerate the SBOM and re-run software composition analysis.',
              evidenceRequired: 'Updated lockfile or SBOM plus CI scan output.',
              ownerTeam: 'Application Development',
              priority: match.vulnerability.knownExploited || severity === 'high' ? 'high' : 'medium',
            },
            evidenceIds: [],
            contextHints: { exposure: 'internal', compensatingControls: 'partial' },
          });
        }
        return {
          status: 'failed',
          expected: 'No components with known vulnerabilities.',
          observed: `${matches.length} vulnerable component match(es) from ${intel.provenance.source}: ${matches.slice(0, 6).map((m) => `${m.vulnerability.id} (${m.dependency.name} ${m.dependency.version})`).join('; ')}${matches.length > 6 ? ' …' : ''}`,
          evidenceIds,
          findings,
        };
      },
    },
    {
      key: 'deps.secrets.source',
      title: 'Secrets in supplied source or configuration',
      module: 'dependencies',
      ...NIST,
      frameworkItemCode: 'PR.DS-01',
      automation: 'automated',
      run: async (ctx) => {
        const parsed = await load();
        if (!parsed.secrets.length) {
          return { status: parsed.sources.length ? 'passed' : 'blocked', expected: 'No credentials or secrets in source and configuration.', observed: parsed.sources.length ? 'No secret patterns detected in the supplied artefacts.' : 'No artefacts available to scan.' };
        }
        const kinds = [...new Set(parsed.secrets.map((s) => s.type))];
        const evidenceId = await ctx.capture('Secret scan summary', parsed.secrets.map((s) => `${s.source}: ${s.type}`).join('\n'));
        const finding: FindingDraft = {
          title: 'Potential secrets committed to source or configuration artefacts',
          category: 'Cryptography and secrets',
          asset: 'Source artefact',
          description: `Secret scanning of the supplied artefacts identified ${parsed.secrets.length} potential secret(s) of type(s): ${kinds.join(', ')}. Affected files: ${[...new Set(parsed.secrets.map((s) => s.source))].slice(0, 10).join(', ')}. Values are redacted in the stored evidence.`,
          businessImpact: 'Committed credentials can allow direct access to banking APIs, databases or third-party payment services.',
          detectionMethod: 'Pattern based secret detection across supplied artefacts (values redacted).',
          confidence: 'medium',
          cwes: ['CWE-798'],
          cvss: { AV: 'N', AC: 'H', AT: 'P', PR: 'N', UI: 'N', VC: 'H', VI: 'L', VA: 'N', SC: 'N', SI: 'N', SA: 'N' },
          frameworkLinks: [
            { ...NIST, itemCode: 'PR.DS-01', rationale: 'Data protection outcome affected by exposed credentials.' },
            { frameworkKey: 'owasp-wstg', frameworkVersion: '4.2', itemCode: 'WSTG-CRYP-04', rationale: 'Hardcoded keys and weak secret storage.' },
          ],
          remediation: {
            rootCause: 'Secrets are stored in source or configuration alongside application code.',
            containment: 'Rotate every identified credential immediately and review provider access logs.',
            shortTerm: 'Remove secrets from the repository and use a managed secret store with short-lived credentials.',
            permanentFix: 'Enable pre-commit secret scanning, secret rotation automation and least-privilege service credentials.',
            verificationCriteria: 'Repository history no longer contains live secrets and rotation is evidenced.',
            retestProcedure: 'Re-run secret scanning on the corrected artefacts and confirm rotation records.',
            evidenceRequired: 'Rotation confirmation and scan output from the corrected build.',
            ownerTeam: 'Application Development',
            priority: 'high',
          },
          evidenceIds: [evidenceId],
          contextHints: { exposure: 'internal', compensatingControls: 'partial' },
        };
        return { status: 'failed', expected: 'No secrets in source or configuration.', observed: `Potential secrets detected: ${kinds.join(', ')}`, evidenceIds: [evidenceId], findings: [finding] };
      },
    },
    {
      key: 'deps.licence.risk',
      title: 'Component licence obligations',
      module: 'dependencies',
      ...NIST,
      frameworkItemCode: 'GV.SC-01',
      automation: 'hybrid',
      run: async () => {
        const parsed = await load();
        const copyleft = parsed.dependencies.filter((dep) => dep.license && /(A?GPL|SSPL|CPAL|EUPL)/i.test(dep.license));
        if (!parsed.dependencies.length) return { status: 'blocked', expected: 'Licence obligations understood and accepted.', observed: 'No dependency inventory available.' };
        if (!copyleft.length) {
          return { status: 'needs_verification', expected: 'Licence obligations understood and accepted.', observed: 'Licence declarations were not present in the supplied manifests for most components; licence review requires a full SBOM.' };
        }
        return { status: 'needs_verification', expected: 'Licence obligations understood and accepted.', observed: `Copyleft-style licences detected on: ${copyleft.map((c) => `${c.name} (${c.license})`).join(', ')}. Confirm the distribution model with legal counsel.` };
      },
    },
    {
      key: 'deps.outdated.components',
      title: 'Component currency against vendor releases',
      module: 'dependencies',
      ...MASVS,
      frameworkItemCode: 'MASVS-CODE-1',
      automation: 'manual',
      run: async () => ({
        status: 'blocked',
        expected: 'Components are within supported vendor release lines.',
        observed:
          'Determining current versions requires registry or vendor advisory access, which is not configured for this assessment. Currency cannot be asserted and must not be recorded as passed. Configure registry access or supply the vendor advisories to complete this check.',
      }),
    },
  ];
}

/** Extract embedded SDK hints from mobile artefacts for dependency review. */
export function sdkInventoryFromStrings(strings: string[]): { name: string; evidence: string }[] {
  const sdkPatterns: [RegExp, string][] = [
    [/com\/google\/firebase|FirebaseAnalytics/i, 'Google Firebase'],
    [/com\/google\/android\/gms/i, 'Google Play Services'],
    [/com\/facebook\/(react|fresco)/i, 'Meta / React Native'],
    [/com\/braintree|braintreepayments/i, 'Braintree payments'],
    [/io\/cardinalcommerce|cardinalcommerce/i, 'CardinalCommerce 3-D Secure'],
    [/com\/stripe|stripe-android/i, 'Stripe payments'],
    [/com\/onesignal/i, 'OneSignal'],
    [/io\/sentry|sentry-cocoa|io\/sentry\.android/i, 'Sentry'],
    [/com\/newrelic/i, 'New Relic'],
    [/io\/fabric|com\/crashlytics/i, 'Crashlytics'],
    [/com\/appsflyer/i, 'AppsFlyer'],
    [/com\/adjust\/sdk/i, 'Adjust'],
    [/okhttp3|okhttp/i, 'OkHttp'],
    [/retrofit2/i, 'Retrofit'],
    [/com\/google\/gson|com\/google\/android\/gms.*gson/i, 'Gson'],
    [/org\/bouncycastle|bcprov/i, 'BouncyCastle'],
    [/com\/microsoft\/appcenter/i, 'App Center'],
    [/io\/repro|uxcam/i, 'Session replay SDK'],
  ];
  const found = new Map<string, string>();
  for (const value of strings) {
    for (const [pattern, name] of sdkPatterns) {
      if (pattern.test(value) && !found.has(name)) found.set(name, value.slice(0, 120));
    }
  }
  return [...found.entries()].map(([name, evidence]) => ({ name, evidence }));
}
