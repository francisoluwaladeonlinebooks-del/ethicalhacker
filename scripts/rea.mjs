#!/usr/bin/env node
/**
 * Run the REA command line without `npx`, on a Node runtime REA accepts.
 *
 *   npm run rea -- capabilities
 *   npm run rea:doctor
 *   npm run rea:mcp
 *
 * Why a runner rather than a direct script entry: REA declares
 *
 *   engines: { node: "^22.23.4 || ^24.22.1 || >=26.12.1" }
 *
 * while this application supports Node >= 20, and the host that runs the build
 * may well be on a 22.x release below 22.23.4. Invoking REA with `npx` would
 * then use that older runtime and `rea doctor` would report the runtime as
 * unsupported. This runner resolves a compliant runtime first — the local
 * `.toolchain` copy if one has been fetched, otherwise the current one if it
 * already qualifies — and refuses to disguise the problem when neither does.
 *
 * The version range is read from REA's own manifest rather than duplicated
 * here, so upgrading REA cannot silently invalidate this check.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const REA_DIR = path.join(ROOT, 'node_modules', 'rea-agents');
const ENTRY = path.join(REA_DIR, 'scripts', 'rea.mjs');
const TOOLCHAIN = path.join(ROOT, '.toolchain');

function fail(message, hint) {
  console.error(`\n[rea] ${message}`);
  if (hint) console.error(`[rea] ${hint}`);
  process.exit(1);
}

if (!fs.existsSync(ENTRY)) {
  fail('REA is not installed.', 'Run `npm install` first (rea-agents is a devDependency).');
}

const manifest = JSON.parse(fs.readFileSync(path.join(REA_DIR, 'package.json'), 'utf8'));
const required = manifest.engines?.node ?? '';
const requiredRea = manifest.version;

/** Minimal range check for the comparator set REA actually uses. */
function satisfies(version, range) {
  if (!range) return true;
  const parse = (v) => String(v)
    .replace(/^v/, '')
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10));

  const cmp = (a, b) => {
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < 3; i += 1) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
    }
    return 0;
  };

  // Every comparator group must pass (the set REA uses is a disjunction of
  // plain comparators; a comma/space-joined set is treated as a conjunction).
  return range.split('||').some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => {
        if (token.startsWith('^')) {
          const base = token.slice(1);
          const [major] = parse(base);
          const upper = major === 0 ? `0.${parse(base)[1] + 1}.0` : `${major + 1}.0.0`;
          return cmp(version, base) >= 0 && cmp(version, upper) < 0;
        }
        if (token.startsWith('>=')) return cmp(version, token.slice(2)) >= 0;
        if (token.startsWith('>')) return cmp(version, token.slice(1)) > 0;
        if (token.startsWith('<=')) return cmp(version, token.slice(2)) <= 0;
        if (token.startsWith('<')) return cmp(version, token.slice(1)) < 0;
        return cmp(version, token) === 0;
      }),
  );
}

/** Find an installed toolchain runtime whose version satisfies REA. */
function findToolchainRuntime() {
  if (!fs.existsSync(TOOLCHAIN)) return null;
  const candidates = fs
    .readdirSync(TOOLCHAIN, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('node-'))
    .map((entry) => entry.name.slice('node-'.length))
    .filter((version) => satisfies(version, required))
    .sort((a, b) => (a < b ? 1 : -1));

  for (const version of candidates) {
    const modules = path.join(TOOLCHAIN, `node-${version}`, 'node_modules');
    if (!fs.existsSync(modules)) continue;
    for (const pkg of fs.readdirSync(modules)) {
      if (!pkg.startsWith('node-')) continue;
      const bin = process.platform === 'win32'
        ? path.join(modules, pkg, 'node.exe')
        : path.join(modules, pkg, 'bin', 'node');
      if (fs.existsSync(bin)) return { bin, version };
    }
  }
  return null;
}

const local = findToolchainRuntime();
const current = process.execPath;
const currentVersion = process.versions.node;

let runtime;
let runtimeLabel;
if (local) {
  runtime = local.bin;
  runtimeLabel = `local toolchain v${local.version}`;
} else if (satisfies(currentVersion, required)) {
  runtime = current;
  runtimeLabel = `current runtime v${currentVersion}`;
} else {
  fail(
    `No Node runtime satisfies REA ${requiredRea} (requires node ${required}).`,
    `Current runtime is v${currentVersion}. Run \`npm run rea:toolchain\` to fetch a compliant one.`,
  );
}

// One line on stderr so stdout stays clean for JSON output (`--json`).
if (process.env.REA_VERBOSE_RUNTIME === '1') {
  console.error(`[rea] ${requiredRea} on ${runtimeLabel} (requires node ${required})`);
}

const result = spawnSync(runtime, [ENTRY, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
