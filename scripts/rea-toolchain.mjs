#!/usr/bin/env node
/**
 * Fetch a Node.js runtime that satisfies REA's engine requirement.
 *
 * REA (rea-agents) declares:
 *
 *   engines: { node: "^22.23.4 || ^24.22.1 || >=26.12.1" }
 *
 * The application itself runs on Node >= 20, so this project does not need a
 * newer runtime — only the REA command line does. Rather than raise the
 * platform's own requirement (which would be false: the app is fine on 20), a
 * second runtime is fetched into `.toolchain/` and used only when REA runs.
 *
 * Where the runtime comes from matters. nodejs.org is not reachable from every
 * restricted build environment, but the npm registry publishes the same
 * official builds as platform packages (`node-linux-x64`, `node-darwin-arm64`,
 * ...). Those packages carry the binary inside the tarball and run no install
 * script, so this stays offline-safe once the registry is reachable and needs
 * no privileged installation.
 *
 * Usage:
 *   node scripts/rea-toolchain.mjs [version]
 *
 * Default version is the lowest one REA accepts, which keeps the REA runtime as
 * close as possible to the runtime the application already uses.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_VERSION = '22.23.4';
const ROOT = path.resolve(import.meta.dirname, '..');
const TOOLCHAIN = path.join(ROOT, '.toolchain');

/** Map the host platform to the npm package that carries an official build. */
function platformPackage() {
  const { platform, arch } = process;
  const map = {
    'linux-x64': 'node-linux-x64',
    'linux-arm64': 'node-linux-arm64',
    'darwin-x64': 'node-darwin-x64',
    'darwin-arm64': 'node-darwin-arm64',
    'win32-x64': 'node-win-x64',
  };
  const key = `${platform}-${arch}`;
  const name = map[key];
  if (!name) {
    throw new Error(
      `No official Node build is published under this name for ${key}. ` +
        `Install Node 22.23.4+ (or 24.22.1+, or 26.12.1+) yourself and re-run; the runner will use it.`,
    );
  }
  return name;
}

/** Locate the node binary inside the installed platform package. */
function binaryPath(version) {
  const pkg = platformPackage();
  const base = path.join(TOOLCHAIN, `node-${version}`, 'node_modules', pkg);
  return process.platform === 'win32' ? path.join(base, 'node.exe') : path.join(base, 'bin', 'node');
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function main() {
  const version = process.argv[2] ?? DEFAULT_VERSION;
  const pkg = platformPackage();
  const target = path.join(TOOLCHAIN, `node-${version}`);
  const bin = binaryPath(version);

  if (fs.existsSync(bin)) {
    const current = spawnSync(bin, ['-v'], { encoding: 'utf8' }).stdout?.trim();
    console.log(`[rea-toolchain] already present: ${bin} (${current})`);
    return;
  }

  console.log(`[rea-toolchain] fetching ${pkg}@${version} into ${path.relative(ROOT, target)}`);
  fs.mkdirSync(target, { recursive: true });

  // --no-save keeps this out of the project manifest: the runtime is a local
  // build tool, not a dependency of the application.
  run('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', target, `${pkg}@${version}`]);

  if (!fs.existsSync(bin)) {
    throw new Error(`Expected a node binary at ${bin} after installing ${pkg}@${version}.`);
  }

  const reported = spawnSync(bin, ['-v'], { encoding: 'utf8' }).stdout?.trim();
  console.log(`[rea-toolchain] ready: ${reported}`);
}

try {
  main();
} catch (error) {
  console.error(`[rea-toolchain] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
