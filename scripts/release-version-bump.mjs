#!/usr/bin/env node
// Decide whether a production release needs a patch version bump, and optionally
// apply it to app.json, package.json, and the package-lock.json root version.
//
// Used by .github/workflows/release-pr-version.yml on a dev → main release PR.
// Development builds are not considered: this is production-only (runtimeVersion
// is appVersion). See docs/RELEASING.md.
//
//   node scripts/release-version-bump.mjs decide [--json]
//     Fingerprint the project the way EAS production builds do, list matching
//     production builds and builds of the current expo.version, print a decision.
//     Needs eas on PATH and EXPO_TOKEN or `eas login`.
//
//   node scripts/release-version-bump.mjs apply [<version>]
//     Rewrite the three version files in the current directory to <version>, or
//     to the next patch of the current expo.version. Does not talk to eas or git.
//
// Tests: scripts/tests/release-version-bump-cases.mjs (pure decide/apply, plus
// decide against a fake eas).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USABLE_BUILD = new Set(['FINISHED', 'IN_QUEUE', 'IN_PROGRESS', 'NEW']);

export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim());
  if (!m) {
    throw new Error(`version ${JSON.stringify(version)} is not a dotted patch version (for example 1.3.1)`);
  }
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

// matchingBuilds: production builds that already have this fingerprint.
// versionBuilds: production builds of the current expo.version (any fingerprint).
export function decide({ matchingBuilds = [], versionBuilds = [], currentVersion }) {
  const version = String(currentVersion ?? '').trim();
  if (!version) {
    throw new Error('currentVersion is required');
  }
  const match = (matchingBuilds || []).find((b) => USABLE_BUILD.has(b.status));
  if (match) {
    return {
      action: 'noop',
      reason: 'fingerprint-match',
      version,
      buildId: match.id ?? null,
    };
  }
  const existing = (versionBuilds || []).filter(
    (b) => b.status !== 'CANCELED' && b.status !== 'ERRORED',
  );
  if (existing.length === 0) {
    return { action: 'noop', reason: 'version-unused', version };
  }
  return {
    action: 'bump',
    reason: 'native-change-version-in-use',
    version,
    nextVersion: nextPatch(version),
  };
}

export function readCurrentVersion(root = '.') {
  return JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.version;
}

export function applyBump(root, version) {
  const next = version ?? nextPatch(readCurrentVersion(root));
  nextPatch(next); // validate

  const appPath = join(root, 'app.json');
  const app = JSON.parse(readFileSync(appPath, 'utf8'));
  app.expo.version = next;
  writeJson(appPath, app);

  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = next;
  writeJson(pkgPath, pkg);

  const lockPath = join(root, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = next;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = next;
  }
  writeJson(lockPath, lock);

  return next;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function easJson(args) {
  const r = spawnSync('eas', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim() || `eas ${args[0]} failed`;
    throw new Error(err);
  }
  // eas prints notices before the JSON on stdout
  const text = r.stdout || '';
  const start = text.search(/^[[{]/m);
  if (start < 0) {
    throw new Error(`eas ${args[0]} printed no JSON`);
  }
  return JSON.parse(text.slice(start));
}

function fingerprintProduction() {
  const data = easJson([
    'fingerprint:generate',
    '-p', 'ios',
    '--environment', 'production',
    '--json',
    '--non-interactive',
  ]);
  const hash = data && data.hash;
  if (!hash) throw new Error('could not compute the production fingerprint');
  return hash;
}

function listProductionBuilds(extraArgs) {
  return easJson([
    'build:list',
    '-p', 'ios',
    '--build-profile', 'production',
    ...extraArgs,
    '--limit', '20',
    '--json',
    '--non-interactive',
  ]) || [];
}

export function decideFromEas() {
  const currentVersion = readCurrentVersion('.');
  const fingerprint = fingerprintProduction();
  const matchingBuilds = listProductionBuilds(['--fingerprint-hash', fingerprint]);
  const versionBuilds = listProductionBuilds(['--runtime-version', currentVersion]);
  return { ...decide({ matchingBuilds, versionBuilds, currentVersion }), fingerprint };
}

function main(argv) {
  const args = argv.slice(2);
  const jsonOut = args.includes('--json');
  const cmd = args.find((a) => a !== '--json');
  if (cmd === 'decide') {
    const decision = decideFromEas();
    if (jsonOut) {
      process.stdout.write(`${JSON.stringify(decision)}\n`);
    } else if (decision.action === 'bump') {
      console.log(
        `bump ${decision.version} → ${decision.nextVersion} (${decision.reason}, fingerprint ${decision.fingerprint})`,
      );
    } else {
      console.log(
        `noop ${decision.version} (${decision.reason}, fingerprint ${decision.fingerprint})`,
      );
    }
    return;
  }
  if (cmd === 'apply') {
    const explicit = args.filter((a) => a !== '--json' && a !== 'apply')[0];
    const next = applyBump('.', explicit);
    console.log(`wrote version ${next} to app.json, package.json, and package-lock.json`);
    return;
  }
  console.error(
    'usage: node scripts/release-version-bump.mjs decide [--json]\n' +
      '       node scripts/release-version-bump.mjs apply [<version>]',
  );
  process.exit(2);
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    main(process.argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
