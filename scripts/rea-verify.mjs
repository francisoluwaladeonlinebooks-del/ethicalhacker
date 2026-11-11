#!/usr/bin/env node
/**
 * Seal and inspect the shipped browser bundle.
 *
 *   npm run rea:verify            check the client bundle, write a report
 *   npm run rea:verify -- --json  machine-readable report on stdout
 *
 * Why this exists
 * ---------------
 * A supervisory platform makes claims about its own interface: that no secret
 * reaches the browser, that the client never calls loopback, that no dynamic
 * code would force `unsafe-eval` into the content security policy. Those claims
 * are easy to state in a README and impossible to keep by hand, because the
 * browser bundle is generated — it is not the source anyone reviews.
 *
 * REA supplies the part this script cannot: a content digest and a sealed
 * Evidence identifier for each artifact that actually shipped, so a report can
 * be tied to exact bytes rather than to a timestamp. The policy rules below are
 * FICAP's own and are labelled as such — REA observed the artifacts, it did not
 * decide what is acceptable for this product. Nothing here is presented as a
 * REA vulnerability finding.
 *
 * Scope and honesty
 * -----------------
 * - Rules run over every JavaScript file under `.next/static`.
 * - REA `inspect-artifact` is run over the shared chunk graph only, because
 *   sealing is a process launch per file; the report states exactly how many
 *   files were sealed out of how many were scanned. The bound is disclosed, not
 *   hidden.
 * - A rule that cannot run reports `not_run`, never `pass`. If the build output
 *   is missing, the script says so and exits non-zero instead of reporting a
 *   clean bundle.
 * - This is a static inspection. It is not a penetration test and not proof that
 *   the application is secure.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC_DIR = path.join(ROOT, '.next', 'static');
const CHUNK_DIR = path.join(STATIC_DIR, 'chunks');
const REPORT_DIR = path.join(ROOT, '.rea-verify');
const REA_RUNNER = path.join(ROOT, 'scripts', 'rea.mjs');
const asJson = process.argv.includes('--json');

/**
 * Absolute hosts that are known to be harmless framework constants: SVG/XML
 * namespaces, error-documentation links and licence URLs. A host outside this
 * set is reported for review — it is not automatically a defect, because a
 * review is what decides that, but it must not pass silently either.
 */
const FRAMEWORK_HOSTS = new Set([
  'www.w3.org',
  'w3.org',
  'nextjs.org',
  'react.dev',
  'reactjs.org',
  'github.com',
  'schema.org',
  'json-schema.org',
  'developer.mozilla.org',
  'tc39.es',
  'ecma-international.org',
]);

/** Chunks whose own text is allowed to mention loopback (core-js polyfills). */
const POLYFILL_ALLOWLIST = /^polyfills-[0-9a-f]+\.js$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* Preconditions                                                               */
/* -------------------------------------------------------------------------- */

if (!fs.existsSync(STATIC_DIR)) {
  console.error('[rea:verify] No production build found at .next/static.');
  console.error('[rea:verify] Run `npm run build` first. Nothing was verified; this is not a pass.');
  process.exit(2);
}

const allJs = walk(STATIC_DIR).filter((file) => file.endsWith('.js'));
if (allJs.length === 0) {
  console.error('[rea:verify] .next/static contains no JavaScript. Nothing was verified; this is not a pass.');
  process.exit(2);
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A rule receives the scanned files and returns a result. Severity `hard` fails
 * the run; `review` is reported for a human to judge.
 */
const RULES = [
  {
    id: 'loopback-endpoint',
    severity: 'hard',
    description:
      'Client JavaScript must not address loopback addresses. A browser runs on the user machine, so a loopback URL in shipped code is either dead or a local-service dependency.',
    run(files) {
      const hits = [];
      for (const file of files) {
        if (POLYFILL_ALLOWLIST.test(path.basename(file))) continue;
        const text = fs.readFileSync(file, 'utf8');
        for (const match of text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/gi)) {
          hits.push({ file: rel(file), match: match[0] });
        }
      }
      return {
        status: hits.length === 0 ? 'pass' : 'fail',
        detail: hits.length === 0 ? 'No loopback endpoint in any client chunk.' : `${hits.length} loopback endpoint(s).`,
        hits: hits.slice(0, 20),
        exempt: 'polyfills-*.js excluded (core-js origin parsing, not a request).',
      };
    },
  },
  {
    id: 'browser-token-storage',
    severity: 'hard',
    description:
      'Authentication material must not be persisted in localStorage or sessionStorage. Session state belongs in an httpOnly cookie so that a cross-site scripting defect cannot read it.',
    run(files) {
      const hits = [];
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const match of text.matchAll(/\b(?:local|session)Storage\s*\.\s*setItem\s*\(\s*['"`]([^'"`]{0,120})/g)) {
          hits.push({ file: rel(file), key: match[1] });
        }
      }
      return {
        status: hits.length === 0 ? 'pass' : 'fail',
        detail:
          hits.length === 0
            ? 'No localStorage/sessionStorage write in the shipped bundle.'
            : `${hits.length} browser-storage write(s).`,
        hits: hits.slice(0, 20),
      };
    },
  },
  {
    id: 'dynamic-code',
    severity: 'hard',
    description:
      'eval() and new Function() require unsafe-eval in the content security policy. The platform ships without it, so any such call is a latent runtime failure as well as a policy breach.',
    run(files) {
      const hits = [];
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        // Word-boundary eval, excluding `evaluate`, `interval` and property names.
        for (const match of text.matchAll(/(?<![\w$.])(?:eval\s*\(|new\s+Function\s*\()/g)) {
          hits.push({ file: rel(file), match: text.slice(Math.max(0, match.index - 24), match.index + 32) });
        }
      }
      return {
        status: hits.length === 0 ? 'pass' : 'fail',
        detail: hits.length === 0 ? 'No dynamic code construction found.' : `${hits.length} occurrence(s).`,
        hits: hits.slice(0, 10),
      };
    },
  },
  {
    id: 'shipped-source-maps',
    severity: 'hard',
    description:
      'Source maps published next to the bundle hand an attacker the original source, including comments and internal identifiers. They must not be served in production.',
    run() {
      const maps = walk(STATIC_DIR).filter((file) => file.endsWith('.map'));
      return {
        status: maps.length === 0 ? 'pass' : 'fail',
        detail: maps.length === 0 ? 'No .map file under .next/static.' : `${maps.length} source map(s) shipped.`,
        hits: maps.slice(0, 10).map((file) => ({ file: rel(file) })),
      };
    },
  },
  {
    id: 'third-party-host',
    severity: 'review',
    description:
      'Any absolute host in client code is a potential outbound destination. Framework constants are allow-listed; everything else is surfaced for a human to accept or remove.',
    run(files) {
      const hosts = new Map();
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
          const host = match[1].toLowerCase();
          if (FRAMEWORK_HOSTS.has(host) || host.endsWith('.w3.org')) continue;
          if (!hosts.has(host)) hosts.set(host, rel(file));
        }
      }
      return {
        status: hosts.size === 0 ? 'pass' : 'review',
        detail:
          hosts.size === 0
            ? 'Every absolute host in the bundle is a known framework constant.'
            : `${hosts.size} host(s) outside the allow-list; confirm none is contacted at runtime.`,
        hits: [...hosts].map(([host, file]) => ({ host, file })),
      };
    },
  },
  {
    id: 'secret-material',
    severity: 'hard',
    description:
      'A credential pattern in shipped client code is readable by every visitor. This checks for high-signal shapes only; it is a safety net, not a secrets scanner.',
    run(files) {
      const patterns = [
        ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
        ['aws access key id', /\bAKIA[0-9A-Z]{16}\b/],
        ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
        ['stripe live key', /\bsk_live_[0-9a-zA-Z]{24,}\b/],
        ['slack token', /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/],
        ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
      ];
      const hits = [];
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const [label, pattern] of patterns) {
          if (pattern.test(text)) hits.push({ file: rel(file), pattern: label });
        }
      }
      return {
        status: hits.length === 0 ? 'pass' : 'fail',
        detail: hits.length === 0 ? 'No credential-shaped string in the shipped bundle.' : `${hits.length} match(es).`,
        hits: hits.slice(0, 20),
      };
    },
  },
];

/* -------------------------------------------------------------------------- */
/* REA sealing                                                                 */
/* -------------------------------------------------------------------------- */

/** Baseline secret scan of source (not shipped) - recorded so the report is honest. */
function sealArtifact(file) {
  const result = spawnSync(process.execPath, [REA_RUNNER, 'inspect-artifact', file, '--format', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { file: rel(file), sealed: false, error: (result.stderr || result.stdout || 'unknown error').trim().slice(0, 400) };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const record = parsed.records?.[0] ?? parsed;
    const subject = record.subject ?? parsed.subject ?? {};
    return {
      file: rel(file),
      sealed: true,
      evidence_id: record.evidence_id ?? parsed.evidence_id ?? null,
      sha256: subject.digest?.sha256 ?? null,
      bytes: fs.statSync(file).size,
    };
  } catch (error) {
    return { file: rel(file), sealed: false, error: `unparsable REA output: ${error.message}` };
  }
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

const sealedTargets = fs.existsSync(CHUNK_DIR)
  ? fs.readdirSync(CHUNK_DIR).filter((name) => name.endsWith('.js')).sort()
  : [];

const ruleResults = RULES.map((rule) => {
  let outcome;
  try {
    outcome = rule.run(allJs);
  } catch (error) {
    outcome = { status: 'not_run', detail: `Rule could not complete: ${error.message}`, hits: [] };
  }
  return {
    id: rule.id,
    severity: rule.severity,
    description: rule.description,
    ...outcome,
  };
});

const sealed = sealedTargets.map((name) => sealArtifact(path.join(CHUNK_DIR, name)));

const failed = ruleResults.filter((rule) => rule.status === 'fail');
const unsealed = sealed.filter((entry) => !entry.sealed);
const verdict = failed.length > 0 ? 'fail' : unsealed.length > 0 ? 'incomplete' : 'pass';

const report = {
  generated_at: new Date().toISOString(),
  tool: 'rea:verify',
  // Stated plainly so the report cannot be quoted as something it is not.
  scope_note:
    'Static inspection of the production client bundle. Not a penetration test, not a vulnerability scan of the running application, and not evidence that the platform is secure.',
  verdict,
  artefacts: {
    scanned: allJs.length,
    scanned_bytes: allJs.reduce((total, file) => total + fs.statSync(file).size, 0),
    sealed: sealed.filter((entry) => entry.sealed).length,
    seal_bound: 'Shared chunk graph only (.next/static/chunks/*.js); sealing launches a process per file.',
    bundle_digest_sha256: sha256(allJs.map((file) => `${rel(file)}:${sha256(fs.readFileSync(file))}`).join('\n')),
  },
  sealed,
  rules: ruleResults,
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = path.join(REPORT_DIR, 'report.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(
  path.join(REPORT_DIR, 'bundle-manifest.txt'),
  allJs.map((file) => `${sha256(fs.readFileSync(file))}  ${rel(file)}`).join('\n') + '\n',
);

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const symbol = { pass: '✓', fail: '✗', review: '!', not_run: '?', incomplete: '!' };
  console.log('\n  FICAP client bundle verification (static inspection)\n');
  console.log(`  scanned   ${report.artefacts.scanned} files, ${(report.artefacts.scanned_bytes / 1024).toFixed(0)} KiB`);
  console.log(`  sealed    ${report.artefacts.sealed}/${sealedTargets.length} chunk artifacts through REA inspect-artifact`);
  console.log(`  bundle    sha256:${report.artefacts.bundle_digest_sha256.slice(0, 32)}…\n`);
  for (const rule of ruleResults) {
    console.log(`  ${symbol[rule.status] ?? '·'} ${rule.id.padEnd(24)} ${rule.status.toUpperCase().padEnd(7)} ${rule.detail}`);
    for (const hit of rule.hits.slice(0, 3)) {
      console.log(`      ${hit.file ?? ''} ${hit.host ?? hit.match ?? hit.key ?? hit.pattern ?? ''}`.trimEnd());
    }
  }
  if (unsealed.length > 0) {
    console.log('\n  seal failures:');
    for (const entry of unsealed) console.log(`      ${entry.file}: ${entry.error}`);
  }
  console.log(`\n  verdict   ${verdict.toUpperCase()}`);
  console.log(`  report    ${rel(reportPath)}`);
  console.log(`\n  ${report.scope_note}\n`);
}

process.exit(verdict === 'pass' ? 0 : 1);
