import { decrypt, sha256 } from '@/lib/crypto';
import type { Tx } from '@/lib/db/pool';
import type { CheckDefinition, EngineContext, FindingDraft } from '@/lib/engines/types';
import { extractStrings, openZip } from '@/lib/engines/artifacts/zip';
import { parseAndroidManifest, type AndroidManifest } from '@/lib/engines/artifacts/axml';
import { summariseInfoPlist, type IosPlistSummary } from '@/lib/engines/artifacts/plist';
import { sdkInventoryFromStrings } from '@/lib/engines/deps';
import { redactText } from '@/lib/redact';

const MASVS = { frameworkKey: 'owasp-masvs', frameworkVersion: '2.0' } as const;
const MASTG = { frameworkKey: 'owasp-mastg', frameworkVersion: '2.x' } as const;
const NIST = { frameworkKey: 'nist-csf', frameworkVersion: '2.0' } as const;

export type MobileAnalysis = {
  kind: 'apk' | 'aab' | 'ipa' | 'unknown';
  filename: string;
  sha256: string;
  sizeBytes: number;
  signed: boolean;
  android?: AndroidManifest;
  ios?: IosPlistSummary;
  strings: string[];
  sdkInventory: { name: string; evidence: string }[];
  networkSecurityConfig: { cleartextPermitted: boolean | null; pinSets: boolean; raw?: string } | null;
  fileCount: number;
  notes: string[];
};

async function loadMobileAnalysis(tx: Tx, artifactId: string | null): Promise<MobileAnalysis | null> {
  if (!artifactId) return null;
  const artifact = await tx.queryOne<{ filename: string; kind: string; body_enc: Uint8Array; sha256: string; size_bytes: number }>(
    'SELECT filename, kind, body_enc, sha256, size_bytes FROM artifacts WHERE id = $1',
    [artifactId],
  );
  if (!artifact) return null;
  const buffer = decrypt(artifact.body_enc);
  const notes: string[] = [];
  const analysis: MobileAnalysis = {
    kind: artifact.kind === 'apk' ? 'apk' : artifact.kind === 'aab' ? 'aab' : artifact.kind === 'ipa' ? 'ipa' : 'unknown',
    filename: artifact.filename,
    sha256: artifact.sha256,
    sizeBytes: artifact.size_bytes,
    signed: false,
    strings: [],
    sdkInventory: [],
    networkSecurityConfig: null,
    fileCount: 0,
    notes,
  };

  let archive;
  try {
    archive = openZip(buffer);
  } catch (error) {
    notes.push(`Artefact is not a readable ZIP container: ${(error as Error).message}`);
    return analysis;
  }
  analysis.fileCount = archive.entries.length;

  if (analysis.kind === 'apk' || analysis.kind === 'aab') {
    const manifestEntry = archive.find(/^(base\/)?AndroidManifest\.xml$/)[0];
    if (manifestEntry) {
      try {
        analysis.android = parseAndroidManifest(archive.read(manifestEntry));
      } catch (error) {
        notes.push(`Manifest parse failed: ${(error as Error).message}`);
      }
    } else {
      notes.push('AndroidManifest.xml not found in the artefact.');
    }
    analysis.signed = archive.entries.some((entry) => /^META-INF\/.*\.(RSA|DSA|EC|SF)$/i.test(entry.name));
    if (!analysis.signed) notes.push('No APK signature block (META-INF/*.RSA|DSA|EC) was found; the artefact may be unsigned or split.');

    const dexEntries = archive.find(/classes\d*\.dex$/).slice(0, 6);
    for (const entry of dexEntries) {
      try {
        analysis.strings.push(...extractStrings(archive.read(entry, 32 * 1024 * 1024)));
      } catch (error) {
        notes.push(`could not read ${entry.name}: ${(error as Error).message}`);
      }
    }
    if (!dexEntries.length) notes.push('No classes.dex found; library code may be supplied as split APKs.');

    const nscEntry = archive.find(/res\/xml\/.*network.*security.*\.xml$|res\/xml\/network_security_config\.xml$/)[0];
    if (nscEntry) {
      try {
        const raw = archive.read(nscEntry);
        const text = raw.toString('utf8');
        const readable = /cleartextTrafficPermitted/.test(text);
        analysis.networkSecurityConfig = {
          cleartextPermitted: /cleartextTrafficPermitted="true"/.test(text) ? true : /cleartextTrafficPermitted="false"/.test(text) ? false : readable ? null : null,
          pinSets: /<pin-set|digest="SHA-256"/.test(text),
          raw: readable ? text.slice(0, 4000) : undefined,
        };
        if (!readable) notes.push('The network security configuration is binary XML; cleartext policy was inferred from the manifest only.');
      } catch {
        notes.push('Network security configuration could not be read.');
      }
    }
  } else if (analysis.kind === 'ipa') {
    const plistEntry = archive.find(/^Payload\/[^/]+\.app\/Info\.plist$/)[0];
    if (plistEntry) {
      try {
        analysis.ios = summariseInfoPlist(archive.read(plistEntry));
      } catch (error) {
        notes.push(`Info.plist parse failed: ${(error as Error).message}`);
      }
    } else {
      notes.push('Payload/<app>/Info.plist not found in the IPA.');
    }
    const binaryEntry = archive.find(/^Payload\/[^/]+\.app\/[^/]+$/).sort((a, b) => b.size - a.size)[0];
    if (binaryEntry) {
      try {
        analysis.strings.push(...extractStrings(archive.read(binaryEntry, 40 * 1024 * 1024)));
      } catch (error) {
        notes.push(`could not read the main binary: ${(error as Error).message}`);
      }
    }
    for (const framework of archive.find(/^Payload\/.*\.framework\/[^/]+$/).slice(0, 20)) {
      try {
        analysis.strings.push(...extractStrings(archive.read(framework, 16 * 1024 * 1024), 5, 2000));
      } catch {
        /* ignore unreadable framework binaries */
      }
    }
    analysis.signed = archive.has('Payload') && archive.entries.some((e) => /embedded\.mobileprovision$/.test(e.name));
    if (!analysis.signed) notes.push('No embedded provisioning profile found; the IPA may be unsigned (development build).');
  }

  analysis.sdkInventory = sdkInventoryFromStrings(analysis.strings);
  return analysis;
}

function weakCryptoIndicators(strings: string[]): string[] {
  const indicators = new Set<string>();
  const checks: [RegExp, string][] = [
    [/\bAES\/ECB\b|\bDESede\/ECB\b|\bAES\/CBC\/NoPadding\b/, 'ECB mode or missing padding in a cipher specification'],
    [/\bMD5\b/, 'MD5 hashing reference'],
    [/\bSHA1\b|\bSHA-1\b/, 'SHA-1 hashing reference'],
    [/\bDES\b(?!cribe)/, 'DES cipher reference'],
    [/\bRC4\b/, 'RC4 cipher reference'],
    [/new Random\(\)|java\.util\.Random|arc4random\b/, 'non-cryptographic random number generator reference'],
    [/SecretKeySpec\([^)]*"[^"]{4,}"\.getBytes/, 'hardcoded symmetric key material'],
    [/IvParameterSpec\(new byte\[\]/, 'static initialisation vector'],
  ];
  for (const value of strings) {
    for (const [pattern, label] of checks) {
      if (pattern.test(value)) indicators.add(label);
    }
  }
  return [...indicators];
}

export function mobileChecks(load: () => Promise<MobileAnalysis | null>): CheckDefinition[] {
  return [
    {
      key: 'mobile.artefact.integrity',
      title: 'Artefact identity and signing',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-RESILIENCE-2',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) {
          return {
            status: 'blocked',
            expected: 'An authorised, signed application build is supplied for analysis.',
            observed: 'No APK/IPA artefact was supplied. Static analysis requires the institution to provide an authorised build.',
          };
        }
        const evidenceId = await ctx.capture(
          'Mobile artefact metadata',
          `File: ${analysis.filename}\nSHA-256: ${analysis.sha256}\nSize: ${analysis.sizeBytes} bytes\nEntries: ${analysis.fileCount}\nSignature artefacts present: ${analysis.signed}\nPlatform: ${analysis.kind}\nNotes: ${analysis.notes.join('; ')}`,
        );
        return {
          status: analysis.signed ? 'passed' : 'needs_verification',
          expected: 'Handling of a signed artefact with recorded integrity metadata.',
          observed: `SHA-256 ${analysis.sha256}. ${analysis.signed ? 'Signature artefacts present.' : 'No signature artefacts found - confirm whether this is a split/unsigned build.'}`,
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.android.manifest.permissions',
      title: 'Android permissions (excessive or dangerous)',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-PRIVACY-1',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis?.android) return { status: 'blocked', expected: 'Only permissions required by banking functionality are requested.', observed: 'No Android manifest available.' };
        const dangerous = analysis.android.permissions.filter((p) => /SMS|CALL_LOG|CONTACTS|RECORD_AUDIO|ACCESS_FINE_LOCATION|READ_EXTERNAL|WRITE_EXTERNAL|READ_PHONE_STATE|CAMERA|BODY_SENSORS|MANAGE_EXTERNAL_STORAGE/.test(p));
        const evidenceId = await ctx.capture('Android permissions', analysis.android.permissions.join('\n'));
        if (!dangerous.length) {
          return { status: 'passed', expected: 'No excessive dangerous permissions.', observed: `${analysis.android.permissions.length} permission(s) requested; none in the high-sensitivity set.`, evidenceIds: [evidenceId] };
        }
        return {
          status: 'needs_verification',
          expected: 'No excessive dangerous permissions.',
          observed: `${dangerous.length} high-sensitivity permission(s) requested: ${dangerous.join(', ')}. Confirm each is justified by an approved business function.`,
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.android.exported_components',
      title: 'Exported Android components',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-PLATFORM-1',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis?.android) return { status: 'blocked', expected: 'No unnecessary components are exported.', observed: 'No Android manifest available.' };
        const exported = analysis.android.components.filter((component) => component.exported === true);
        const exportedWithoutPermission = exported.filter((component) => !component.permission);
        const evidenceId = await ctx.capture(
          'Exported Android components',
          exported.map((c) => `${c.type} ${c.name} exported=${c.exported} permission=${c.permission ?? 'none'} intentFilters=${JSON.stringify(c.intentFilters)}`).join('\n') || 'none',
        );
        if (!exportedWithoutPermission.length) {
          return { status: 'passed', expected: 'Exported components are minimised and permission protected.', observed: `${exported.length} exported component(s); all protected by permissions or none present.`, evidenceIds: [evidenceId] };
        }
        const findings: FindingDraft[] = [];
        if (exportedWithoutPermission.length > 0) {
          findings.push({
            title: 'Exported Android components reachable by other applications',
            category: 'Mobile platform interaction',
            asset: analysis.android.packageName ?? analysis.filename,
            appVersion: analysis.android.versionName ?? undefined,
            description: `${exportedWithoutPermission.length} component(s) are exported without a permission guard: ${exportedWithoutPermission.map((c) => `${c.type} ${c.name}`).join(', ')}. Any co-installed application can invoke these components, which may expose account data or privileged actions.`,
            businessImpact: 'A malicious application on the customer device could invoke exported banking components, potentially triggering sensitive actions or reading data returned by them.',
            detectionMethod: 'Static analysis of AndroidManifest.xml exported components and component permissions.',
            confidence: 'medium',
            cwes: ['CWE-926'],
            cvss: { AV: 'L', AC: 'L', AT: 'N', PR: 'N', UI: 'P', VC: 'L', VI: 'L', VA: 'N', SC: 'N', SI: 'N', SA: 'N' },
            frameworkLinks: [
              { ...MASVS, itemCode: 'MASVS-PLATFORM-1', rationale: 'Exported component without permission protection.' },
              { ...MASTG, itemCode: 'MASTG-PLATFORM-01', rationale: 'Exported component review.' },
            ],
            remediation: {
              rootCause: 'Components declare android:exported="true" without a signature-level permission.',
              shortTerm: 'Set exported="false" or protect the component with a signature-level permission and validate caller identity.',
              permanentFix: 'Introduce manifest linting that fails builds exposing components without explicit approval.',
              verificationCriteria: 'No component is exported without a documented business need and permission guard.',
              retestProcedure: 'Re-analyse the rebuilt APK and confirm the exported surface.',
              evidenceRequired: 'Updated manifest excerpt and rebuilt artefact digest.',
              ownerTeam: 'Mobile Engineering',
              priority: 'medium',
            },
            evidenceIds: [evidenceId],
            contextHints: { exposure: 'internal', compensatingControls: 'partial' },
          });
        }
        return {
          status: 'failed',
          expected: 'Exported components are minimised and permission protected.',
          observed: `${exportedWithoutPermission.length} exported component(s) without a permission guard.`,
          evidenceIds: [evidenceId],
          findings,
        };
      },
    },
    {
      key: 'mobile.android.debuggable',
      title: 'Debuggable release build',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-RESILIENCE-4',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis?.android) return { status: 'blocked', expected: 'Release builds are not debuggable.', observed: 'No Android manifest available.' };
        if (!analysis.android.application.debuggable) {
          return { status: 'passed', expected: 'Release builds are not debuggable.', observed: 'android:debuggable is not enabled.' };
        }
        const evidenceId = await ctx.capture('Debuggable flag', 'AndroidManifest application android:debuggable="true"');
        const finding: FindingDraft = {
          title: 'Android build is debuggable',
          category: 'Mobile resilience',
          asset: analysis.android.packageName ?? analysis.filename,
          appVersion: analysis.android.versionName ?? undefined,
          description: 'The supplied build declares android:debuggable="true". A debuggable banking application allows attachment of a debugger, memory inspection, extraction of tokens and bypass of client-side controls.',
          businessImpact: 'An attacker with device access can extract credentials and session tokens or instrument authentication logic.',
          detectionMethod: 'Static analysis of AndroidManifest.xml.',
          confidence: 'high',
          cwes: ['CWE-489'],
          cvss: { AV: 'L', AC: 'L', AT: 'N', PR: 'L', UI: 'N', VC: 'H', VI: 'H', VA: 'N', SC: 'N', SI: 'N', SA: 'N' },
          frameworkLinks: [
            { ...MASVS, itemCode: 'MASVS-RESILIENCE-4', rationale: 'Debug configuration present in the assessed build.' },
            { ...MASTG, itemCode: 'MASTG-CODE-02', rationale: 'Debuggable release configuration.' },
          ],
          remediation: {
            rootCause: 'A debug variant was distributed or the manifest sets debuggable explicitly.',
            containment: 'Withdraw the affected build from distribution and force upgrade.',
            shortTerm: 'Build the release variant with debuggable=false and verify the pipeline output.',
            permanentFix: 'Add a release-hardening gate that fails builds with debuggable=true.',
            verificationCriteria: 'The distributed artefact has android:debuggable="false".',
            retestProcedure: 'Re-analyse the distributed build.',
            evidenceRequired: 'Manifest excerpt from the rebuilt release artefact.',
            ownerTeam: 'Mobile Engineering',
            priority: 'critical',
          },
          evidenceIds: [evidenceId],
          contextHints: { exposure: 'internet', affectsCustomerFunds: true, privilegedAccess: true },
        };
        return { status: 'failed', expected: 'Release builds are not debuggable.', observed: 'android:debuggable="true" is set.', evidenceIds: [evidenceId], findings: [finding] };
      },
    },
    {
      key: 'mobile.android.backup',
      title: 'Application backup exposure',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-STORAGE-2',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis?.android) return { status: 'blocked', expected: 'Backup excludes sensitive application data.', observed: 'No Android manifest available.' };
        if (analysis.android.application.allowBackup === false) {
          return { status: 'passed', expected: 'Backup excludes sensitive application data.', observed: 'android:allowBackup="false".' };
        }
        return {
          status: 'needs_verification',
          expected: 'Backup excludes sensitive application data.',
          observed: analysis.android.application.allowBackup === true
            ? 'android:allowBackup="true" - confirm that backup rules exclude tokens and customer data.'
            : 'android:allowBackup is not set (defaults to true for the platform). Confirm backup rules and data extraction rules.',
        };
      },
    },
    {
      key: 'mobile.network.cleartext',
      title: 'Cleartext network traffic',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-NETWORK-1',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'Cleartext traffic is disabled.', observed: 'No artefact available.' };
        const androidCleartext = analysis.android?.application.usesCleartextTraffic ?? null;
        const nsc = analysis.networkSecurityConfig;
        const iosArbitrary = analysis.ios?.atsAllowsArbitraryLoads ?? false;
        if (androidCleartext === true || nsc?.cleartextPermitted === true || iosArbitrary) {
          const evidenceId = await ctx.capture(
            'Cleartext traffic configuration',
            `Android usesCleartextTraffic=${androidCleartext}\nNetwork security config cleartext permitted=${nsc?.cleartextPermitted}\niOS NSAllowsArbitraryLoads=${iosArbitrary}`,
          );
          const finding: FindingDraft = {
            title: 'Mobile application permits cleartext network traffic',
            category: 'Mobile network security',
            asset: analysis.android?.packageName ?? analysis.ios?.bundleIdentifier ?? analysis.filename,
            description: 'The build permits cleartext (non-TLS) network traffic. Banking data or tokens sent over cleartext can be intercepted on hostile networks.',
            businessImpact: 'Customer session and transaction data can be intercepted, enabling account takeover and fraudulent payments.',
            detectionMethod: 'Static analysis of manifest cleartext flags and iOS App Transport Security configuration.',
            confidence: 'high',
            cwes: ['CWE-319'],
            cvss: { AV: 'A', AC: 'H', AT: 'N', PR: 'N', UI: 'P', VC: 'H', VI: 'L', VA: 'N', SC: 'N', SI: 'N', SA: 'N' },
            frameworkLinks: [
              { ...MASVS, itemCode: 'MASVS-NETWORK-1', rationale: 'Cleartext traffic permitted.' },
              { ...MASTG, itemCode: 'MASTG-NETWORK-01', rationale: 'Cleartext traffic configuration review.' },
              { ...NIST, itemCode: 'PR.DS-02' },
            ],
            remediation: {
              rootCause: 'Cleartext traffic is enabled globally or via a permissive network security configuration.',
              shortTerm: 'Set usesCleartextTraffic=false / NSAllowsArbitraryLoads=false and allow cleartext only for explicitly listed development hosts.',
              permanentFix: 'Enforce TLS-only network policy through a network security configuration and CI policy check.',
              verificationCriteria: 'No cleartext exceptions remain for production hosts.',
              retestProcedure: 'Re-analyse the rebuilt artefact and confirm the network policy.',
              evidenceRequired: 'Network security configuration and manifest excerpt from the rebuilt build.',
              ownerTeam: 'Mobile Engineering',
              priority: 'high',
            },
            evidenceIds: [evidenceId],
            contextHints: { exposure: 'internet', affectsCustomerFunds: true },
          };
          return { status: 'failed', expected: 'Cleartext traffic is disabled.', observed: 'Cleartext traffic permitted by application configuration.', evidenceIds: [evidenceId], findings: [finding] };
        }
        if (androidCleartext === null && !analysis.android && !analysis.ios) {
          return { status: 'needs_verification', expected: 'Cleartext traffic is disabled.', observed: 'Platform configuration could not be determined from the supplied artefact.' };
        }
        return { status: 'passed', expected: 'Cleartext traffic is disabled.', observed: 'No cleartext traffic permission observed in the application configuration.' };
      },
    },
    {
      key: 'mobile.network.certificate_validation',
      title: 'Certificate validation and pinning indicators',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-NETWORK-2',
      automation: 'hybrid',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'Server certificates are validated; pinning per threat model.', observed: 'No artefact available.' };
        const trustAll = analysis.strings.filter((s) => /checkServerTrusted[\s\S]*\{\s*\}|TrustAllCerts|ALLOW_ALL_HOSTNAME_VERIFIER|setHostnameVerifier\(.*ALLOW_ALL|trustAllCerts/i.test(s));
        const pinning = analysis.strings.some((s) => /CertificatePinner|TrustKit|ssl_pinning|pin-set|PublicKeyPinning|NSExceptionRequiresCertificateTransparency/i.test(s));
        const evidenceId = await ctx.capture(
          'Certificate validation indicators',
          `Pinning indicators: ${pinning}\nTrust-all indicators: ${trustAll.length}\nSamples: ${trustAll.slice(0, 5).join(' | ')}`,
        );
        if (trustAll.length > 0) {
          return { status: 'failed', expected: 'Strict certificate validation.', observed: `Indicators of disabled certificate validation were found (${trustAll.length}). Manual code review is required to confirm the trust manager implementation.`, evidenceIds: [evidenceId] };
        }
        return {
          status: pinning ? 'passed' : 'needs_verification',
          expected: 'Server certificates are validated; pinning applied per threat model.',
          observed: pinning
            ? 'Certificate pinning or trust-kit indicators were found in the artefact.'
            : 'No certificate pinning indicators were found. Pinning is not mandatory, but the threat model should document why it is not applied. Dynamic validation with an approved device is required to confirm correct certificate handling.',
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.secrets.hardcoded',
      title: 'Hardcoded secrets in the application binary',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-STORAGE-1',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'No embedded credentials or API secrets.', observed: 'No artefact available.' };
        const hits: string[] = [];
        const patterns: [RegExp, string][] = [
          [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
          [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'private key block'],
          [/sk_(live|test)_[A-Za-z0-9]{10,}/, 'payment provider secret key'],
          [/AIza[0-9A-Za-z\-_]{35}/, 'Google API key'],
          [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
          [/(?:api[_-]?key|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, 'API key or client secret assignment'],
          [/Basic\s+[A-Za-z0-9+/=]{20,}/, 'embedded basic auth credential'],
        ];
        for (const value of analysis.strings) {
          for (const [pattern, label] of patterns) {
            if (pattern.test(value)) hits.push(label);
          }
        }
        const unique = [...new Set(hits)];
        if (!unique.length) {
          return { status: 'passed', expected: 'No embedded credentials or API secrets.', observed: `${analysis.strings.length} embedded strings inspected; no credential patterns detected.` };
        }
        const redactedEvidence = await ctx.capture('Hardcoded secret indicators (values redacted)', redactText(unique.join('\n')).text);
        const finding: FindingDraft = {
          title: 'Hardcoded secrets embedded in the mobile application',
          category: 'Cryptography and secrets',
          asset: analysis.android?.packageName ?? analysis.ios?.bundleIdentifier ?? analysis.filename,
          appVersion: analysis.android?.versionName ?? analysis.ios?.shortVersion ?? undefined,
          description: `Credential-like material was identified in the application binary: ${unique.join(', ')}. Mobile binaries are trivially extractable, so embedded secrets must be treated as public. Values are redacted in stored evidence.`,
          businessImpact: 'Embedded third-party or backend credentials can allow an attacker to impersonate the application, access APIs at scale or incur charges against the institution.',
          detectionMethod: 'Static string extraction and credential pattern matching across the application artefact.',
          confidence: 'medium',
          cwes: ['CWE-798'],
          cvss: { AV: 'N', AC: 'L', AT: 'N', PR: 'N', UI: 'N', VC: 'H', VI: 'L', VA: 'N', SC: 'N', SI: 'N', SA: 'N' },
          frameworkLinks: [
            { ...MASVS, itemCode: 'MASVS-STORAGE-1', rationale: 'Sensitive data protection in the application package.' },
            { ...MASTG, itemCode: 'MASTG-CRYPTO-02', rationale: 'Hardcoded key and secret detection.' },
          ],
          remediation: {
            rootCause: 'Secrets are compiled into the application or its bundled SDK configuration.',
            containment: 'Rotate every identified credential and review provider usage logs for abuse.',
            shortTerm: 'Remove embedded secrets and move secret-dependent operations to backend services.',
            permanentFix: 'Use short-lived, attestation-bound tokens issued at runtime; add secret scanning to the mobile build pipeline.',
            verificationCriteria: 'No credential material is recoverable from the distributed binary.',
            retestProcedure: 'Re-extract strings from the rebuilt artefact and repeat the pattern scan.',
            evidenceRequired: 'Rebuilt artefact digest and scan output, plus rotation evidence.',
            ownerTeam: 'Mobile Engineering',
            priority: 'high',
          },
          evidenceIds: [redactedEvidence],
          contextHints: { exposure: 'internet', affectsCustomerFunds: true },
        };
        return { status: 'failed', expected: 'No embedded credentials or API secrets.', observed: `Credential patterns detected: ${unique.join(', ')}`, evidenceIds: [redactedEvidence], findings: [finding] };
      },
    },
    {
      key: 'mobile.crypto.weak_algorithms',
      title: 'Weak cryptographic API usage',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-CRYPTO-1',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'Current, strong cryptographic primitives.', observed: 'No artefact available.' };
        const indicators = weakCryptoIndicators(analysis.strings);
        if (!indicators.length) {
          return { status: 'passed', expected: 'Current, strong cryptographic primitives.', observed: 'No weak cryptographic API indicators found in the extracted strings.' };
        }
        const evidenceId = await ctx.capture('Weak cryptography indicators', indicators.join('\n'));
        return {
          status: 'needs_verification',
          expected: 'Current, strong cryptographic primitives.',
          observed: `Cryptographic indicators requiring review: ${indicators.join('; ')}. Static string indicators must be confirmed by code review before a vulnerability is recorded.`,
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.logging.sensitive',
      title: 'Sensitive data in application logs',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-STORAGE-2',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'Sensitive values are never written to logs.', observed: 'No artefact available.' };
        const logCalls = analysis.strings.filter((s) => /Log\.(d|v|i)\(|NSLog\(|print\(|console\.log/i.test(s));
        const sensitiveNearby = analysis.strings.filter((s) => /(Log\.|NSLog|print\()[\s\S]{0,80}(token|password|pin|otp|account|bvn|card)/i.test(s));
        const evidenceId = await ctx.capture('Logging indicators', `${logCalls.length} logging call(s)\nSensitive candidates: ${sensitiveNearby.slice(0, 10).join(' | ')}`);
        if (!sensitiveNearby.length) {
          return { status: 'needs_verification', expected: 'No sensitive values in logs.', observed: `${logCalls.length} logging call(s) observed. Static analysis cannot rule out sensitive logging; confirm on an approved device with a test account.`, evidenceIds: [evidenceId] };
        }
        return { status: 'needs_verification', expected: 'No sensitive values in logs.', observed: `Logging statements referencing sensitive fields were observed (${sensitiveNearby.length}). Confirm at runtime on an approved device.`, evidenceIds: [evidenceId] };
      },
    },
    {
      key: 'mobile.deeplinks.authorisation',
      title: 'Deep link and URL scheme handling',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-PLATFORM-1',
      automation: 'hybrid',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'Deep links validate parameters and require authentication.', observed: 'No artefact available.' };
        const androidLinks = (analysis.android?.components ?? []).flatMap((component) =>
          component.intentFilters.flatMap((filter) => filter.schemes.map((scheme) => ({ component: component.name, scheme, hosts: filter.hosts, autoVerify: filter.autoVerify }))),
        );
        const iosSchemes = analysis.ios?.urlSchemes ?? [];
        const evidenceId = await ctx.capture('Deep link inventory', JSON.stringify({ androidLinks, iosSchemes, associatedDomains: analysis.ios?.associatedDomains ?? [] }, null, 2));
        const webSchemes = [...androidLinks.filter((l) => l.scheme === 'http' || l.scheme === 'https'), ...iosSchemes.filter((s) => s.startsWith('http'))];
        return {
          status: androidLinks.length || iosSchemes.length ? 'needs_verification' : 'passed',
          expected: 'Deep links validate parameters and require authentication for sensitive actions.',
          observed: `${androidLinks.length} Android deep-link filter(s) and ${iosSchemes.length} iOS URL scheme(s) declared (${webSchemes.length} web-scheme). Parameter handling and authentication requirements must be verified at runtime with an approved device and test account.`,
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.webview.configuration',
      title: 'WebView security configuration',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-PLATFORM-2',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'WebViews restrict script bridges and file access.', observed: 'No artefact available.' };
        const indicators: string[] = [];
        if (analysis.strings.some((s) => /setJavaScriptEnabled\(true\)|javaScriptEnabled\s*=\s*true/i.test(s))) indicators.push('JavaScript enabled in WebView');
        if (analysis.strings.some((s) => /addJavascriptInterface|JavascriptInterface|WKScriptMessageHandler/i.test(s))) indicators.push('JavaScript bridge exposed to web content');
        if (analysis.strings.some((s) => /setAllowFileAccess\(true\)|allowFileAccess\s*=\s*true/i.test(s))) indicators.push('file access enabled in WebView');
        if (analysis.strings.some((s) => /setAllowUniversalAccessFromFileURLs\(true\)/i.test(s))) indicators.push('universal access from file URLs enabled');
        const evidenceId = await ctx.capture('WebView configuration indicators', indicators.join('\n') || 'no indicators');
        if (!indicators.length) return { status: 'needs_verification', expected: 'WebViews restrict content and bridges.', observed: 'No WebView configuration indicators were found in extracted strings; confirm by code review.', evidenceIds: [evidenceId] };
        return {
          status: 'needs_verification',
          expected: 'WebViews restrict content and bridges.',
          observed: `WebView indicators: ${indicators.join('; ')}. Confirm whether untrusted content can reach the JavaScript bridge.`,
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.ios.ats',
      title: 'iOS App Transport Security',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-NETWORK-1',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis?.ios) return { status: 'skipped', expected: 'ATS enforced without arbitrary load exceptions.', observed: 'No iOS build was supplied with this application.' };
        const summary = analysis.ios;
        const evidenceId = await ctx.capture(
          'iOS App Transport Security configuration',
          `NSAllowsArbitraryLoads=${summary.atsAllowsArbitraryLoads}\nException domains=${summary.atsExceptionDomains.join(', ') || 'none'}\nAssociated domains=${summary.associatedDomains.join(', ') || 'none'}\nPrivacy usage keys=${summary.privacyUsageKeys.join(', ') || 'none'}`,
        );
        if (summary.atsAllowsArbitraryLoads) {
          return { status: 'failed', expected: 'ATS enforced.', observed: 'NSAllowsArbitraryLoads is enabled, permitting cleartext connections.', evidenceIds: [evidenceId] };
        }
        return {
          status: summary.atsExceptionDomains.length ? 'needs_verification' : 'passed',
          expected: 'ATS enforced.',
          observed: summary.atsExceptionDomains.length ? `ATS exceptions declared for: ${summary.atsExceptionDomains.join(', ')}` : 'ATS enforced with no exception domains.',
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.ios.keychain',
      title: 'iOS secure storage configuration',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-STORAGE-1',
      automation: 'hybrid',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis?.ios) return { status: 'skipped', expected: 'Keychain items use appropriate accessibility classes.', observed: 'No iOS build supplied.' };
        const insecure = analysis.strings.filter((s) => /kSecAttrAccessibleAlways|kSecAttrAccessibleAlwaysThisDeviceOnly|NSUserDefaults.*token|NSFileProtectionNone/i.test(s));
        const evidenceId = await ctx.capture('iOS storage indicators', insecure.slice(0, 20).join('\n') || 'no insecure accessibility indicators');
        return {
          status: insecure.length ? 'needs_verification' : 'needs_verification',
          expected: 'Keychain items use after-first-unlock or when-unlocked accessibility; tokens are not in user defaults.',
          observed: insecure.length
            ? `Insecure storage indicators observed: ${insecure.length}. Confirm usage context by code review.`
            : 'No insecure keychain accessibility constants were found in extracted strings. Runtime confirmation on an authorised device is required before MASVS-STORAGE-1 can be considered verified.',
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.dependencies.sdk_inventory',
      title: 'Embedded third-party SDK inventory',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-CODE-3',
      automation: 'automated',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'Third-party SDKs are inventoried and current.', observed: 'No artefact available.' };
        const evidenceId = await ctx.capture('Embedded SDK inventory', analysis.sdkInventory.map((sdk) => `${sdk.name} — ${sdk.evidence}`).join('\n') || 'no SDK signatures detected');
        return {
          status: analysis.sdkInventory.length ? 'needs_verification' : 'passed',
          expected: 'Third-party SDKs are inventoried and current.',
          observed: analysis.sdkInventory.length
            ? `${analysis.sdkInventory.length} embedded SDK signature(s) detected: ${analysis.sdkInventory.map((s) => s.name).join(', ')}. Data collection and currency of each SDK must be confirmed with the institution inventory.`
            : 'No third-party SDK signatures detected in the extracted strings.',
          evidenceIds: [evidenceId],
        };
      },
    },
    {
      key: 'mobile.privacy.permissions',
      title: 'Privacy sensitive permissions and identifiers',
      module: 'mobile',
      ...MASVS,
      frameworkItemCode: 'MASVS-PRIVACY-1',
      automation: 'hybrid',
      run: async (ctx) => {
        const analysis = await load();
        if (!analysis) return { status: 'blocked', expected: 'Only necessary privacy-sensitive access is requested.', observed: 'No artefact available.' };
        const identifiers = analysis.strings.filter((s) => /getDeviceId|AdvertisingIdClient|IDFA|identifierForVendor|getImei|TelephonyManager/i.test(s));
        const evidenceId = await ctx.capture('Privacy indicators', identifiers.slice(0, 20).join('\n') || 'no persistent identifier APIs observed');
        return {
          status: identifiers.length ? 'needs_verification' : 'passed',
          expected: 'Only necessary privacy-sensitive access is requested.',
          observed: identifiers.length
            ? `Persistent identifier APIs referenced (${identifiers.length}): confirm necessity and disclosure.`
            : 'No persistent device identifier APIs were found in extracted strings.',
          evidenceIds: [evidenceId],
        };
      },
    },
  ];
}

/** Dynamic mobile test prerequisites recorded when no device is available. */
export const MOBILE_DYNAMIC_TESTS: { code: string; prerequisite: string }[] = [
  { code: 'MASTG-STORAGE-01', prerequisite: 'Requires an authorised test device with the release build installed and a test account.' },
  { code: 'MASTG-STORAGE-02', prerequisite: 'Requires device log capture on a rooted/jailbroken test device or debuggable build.' },
  { code: 'MASTG-AUTH-01', prerequisite: 'Requires an approved test account to observe token issuance and refresh.' },
  { code: 'MASTG-AUTH-02', prerequisite: 'Requires a test device with biometric enrolment to validate fallback behaviour.' },
  { code: 'MASTG-AUTH-03', prerequisite: 'Requires an approved test account to verify server-side token invalidation.' },
  { code: 'MASTG-NETWORK-03', prerequisite: 'Requires an interception proxy and an institution-approved test device with trust configuration.' },
  { code: 'MASTG-RESILIENCE-01', prerequisite: 'Requires a rooted/jailbroken test device to assess compromised-device detection.' },
  { code: 'MASTG-RESILIENCE-03', prerequisite: 'Requires instrumentation tooling (e.g. Frida) on an approved device and explicit authorisation.' },
];

export async function analyseArtifactDigest(tx: Tx, artifactId: string): Promise<{ sha256: string; sizeBytes: number } | null> {
  const artifact = await tx.queryOne<{ body_enc: Uint8Array; size_bytes: number }>('SELECT body_enc, size_bytes FROM artifacts WHERE id = $1', [artifactId]);
  if (!artifact) return null;
  return { sha256: sha256(decrypt(artifact.body_enc)), sizeBytes: artifact.size_bytes };
}

export const loadMobileAnalysisFor = loadMobileAnalysis;
