// node --test scripts/tests/release-version-bump-cases.mjs (named so jest does not pick it up).
// Behavioral tests for scripts/release-version-bump.mjs: when a production release
// needs a patch bump, when it must not, and that apply rewrites the three version
// files. Also runs `decide` against a fake eas on PATH. No network, no EXPO_TOKEN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'release-version-bump.mjs');
const { nextPatch, decide, applyBump, readCurrentVersion } = await import(
  pathToFileURL(SCRIPT).href
);

const FINISHED = { id: 'build-fin', status: 'FINISHED' };
const QUEUED = { id: 'build-q', status: 'IN_QUEUE' };
const PROGRESS = { id: 'build-p', status: 'IN_PROGRESS' };
const NEW = { id: 'build-n', status: 'NEW' };
const ERRORED = { id: 'build-e', status: 'ERRORED' };
const CANCELED = { id: 'build-c', status: 'CANCELED' };

test('nextPatch increments only the patch number', () => {
  assert.equal(nextPatch('1.3.1'), '1.3.2');
  assert.equal(nextPatch('1.3.9'), '1.3.10');
  assert.equal(nextPatch('1.0.0'), '1.0.1');
  assert.equal(nextPatch('2.10.99'), '2.10.100');
  assert.equal(nextPatch(' 1.3.1 '), '1.3.2');
});

test('nextPatch rejects versions that are not a dotted patch', () => {
  for (const bad of ['1.3', '1.3.1-beta', 'v1.3.1', '', undefined, '1.3.1.0']) {
    assert.throws(() => nextPatch(bad), /not a dotted patch version/);
  }
});

test('JS-only change (fingerprint already has a usable store build) does not bump', () => {
  const d = decide({
    matchingBuilds: [FINISHED],
    versionBuilds: [FINISHED],
    currentVersion: '1.3.1',
  });
  assert.equal(d.action, 'noop');
  assert.equal(d.reason, 'fingerprint-match');
  assert.equal(d.version, '1.3.1');
  assert.equal(d.nextVersion, undefined);
});

test('a queued, in-progress, or new build of this fingerprint is still OTA-only', () => {
  for (const build of [QUEUED, PROGRESS, NEW]) {
    const d = decide({
      matchingBuilds: [build],
      versionBuilds: [FINISHED],
      currentVersion: '1.3.1',
    });
    assert.equal(d.action, 'noop', build.status);
    assert.equal(d.reason, 'fingerprint-match', build.status);
  }
});

test('canceled or errored builds of this fingerprint do not count as a match', () => {
  const d = decide({
    matchingBuilds: [ERRORED, CANCELED],
    versionBuilds: [FINISHED],
    currentVersion: '1.3.1',
  });
  assert.equal(d.action, 'bump');
  assert.equal(d.reason, 'native-change-version-in-use');
  assert.equal(d.nextVersion, '1.3.2');
});

test('native change under a version that already has a store build bumps the patch', () => {
  const d = decide({
    matchingBuilds: [],
    versionBuilds: [FINISHED],
    currentVersion: '1.3.1',
  });
  assert.deepEqual(d, {
    action: 'bump',
    reason: 'native-change-version-in-use',
    version: '1.3.1',
    nextVersion: '1.3.2',
  });
});

test('a queued or in-progress store build of the current version also triggers a bump', () => {
  for (const build of [QUEUED, PROGRESS, NEW]) {
    const d = decide({
      matchingBuilds: [],
      versionBuilds: [build],
      currentVersion: '1.3.1',
    });
    assert.equal(d.action, 'bump', build.status);
    assert.equal(d.nextVersion, '1.3.2', build.status);
  }
});

test('native change under a version with no store build does not bump (already bumped)', () => {
  const d = decide({
    matchingBuilds: [],
    versionBuilds: [],
    currentVersion: '1.3.2',
  });
  assert.equal(d.action, 'noop');
  assert.equal(d.reason, 'version-unused');
  assert.equal(d.version, '1.3.2');
  assert.equal(d.nextVersion, undefined);
});

test('canceled or errored builds of the current version do not count as in-use', () => {
  const d = decide({
    matchingBuilds: [],
    versionBuilds: [ERRORED, CANCELED],
    currentVersion: '1.3.1',
  });
  assert.equal(d.action, 'noop');
  assert.equal(d.reason, 'version-unused');
});

test('fingerprint match wins over a version that is already in use', () => {
  const d = decide({
    matchingBuilds: [FINISHED],
    versionBuilds: [FINISHED],
    currentVersion: '1.3.1',
  });
  assert.equal(d.reason, 'fingerprint-match');
  assert.equal(d.action, 'noop');
});

test('re-running decide after a bump is a no-op (idempotent on edits/reopens)', () => {
  const first = decide({
    matchingBuilds: [],
    versionBuilds: [FINISHED],
    currentVersion: '1.3.1',
  });
  assert.equal(first.action, 'bump');
  const again = decide({
    matchingBuilds: [],
    versionBuilds: [],
    currentVersion: first.nextVersion,
  });
  assert.equal(again.action, 'noop');
  assert.equal(again.reason, 'version-unused');
  const third = decide({
    matchingBuilds: [],
    versionBuilds: [],
    currentVersion: first.nextVersion,
  });
  assert.deepEqual(third, again);
});

test('decide requires a current version', () => {
  assert.throws(() => decide({ matchingBuilds: [], versionBuilds: [] }), /currentVersion is required/);
});

function fixture(version = '1.3.1') {
  const dir = mkdtempSync(join(tmpdir(), 'release-bump-'));
  writeFileSync(join(dir, 'app.json'), `${JSON.stringify({ expo: { name: 'Rep Royale', version } }, null, 2)}\n`);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'pushupcounter', version }, null, 2)}\n`);
  writeFileSync(
    join(dir, 'package-lock.json'),
    `${JSON.stringify({ name: 'pushupcounter', version, lockfileVersion: 3, packages: { '': { name: 'pushupcounter', version } } }, null, 2)}\n`,
  );
  return dir;
}

test('applyBump rewrites app.json, package.json, and both package-lock root versions', () => {
  const dir = fixture('1.3.1');
  const next = applyBump(dir);
  assert.equal(next, '1.3.2');
  assert.equal(JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo.version, '1.3.2');
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '1.3.2');
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, '1.3.2');
  assert.equal(lock.packages[''].version, '1.3.2');
  assert.equal(readCurrentVersion(dir), '1.3.2');
});

test('applyBump can set an explicit version and leaves other package-lock entries alone', () => {
  const dir = fixture('1.3.1');
  const lockPath = join(dir, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.packages['node_modules/expo'] = { version: '58.1.0' };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  assert.equal(applyBump(dir, '1.4.0'), '1.4.0');
  const after = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(after.version, '1.4.0');
  assert.equal(after.packages[''].version, '1.4.0');
  assert.equal(after.packages['node_modules/expo'].version, '58.1.0');
});

test('applyBump then decide with no store build of the new version does not bump again', () => {
  const dir = fixture('1.3.1');
  const next = applyBump(dir);
  const d = decide({
    matchingBuilds: [],
    versionBuilds: [],
    currentVersion: readCurrentVersion(dir),
  });
  assert.equal(next, '1.3.2');
  assert.equal(d.action, 'noop');
  assert.equal(d.reason, 'version-unused');
});

test('applyBump rejects a malformed target version', () => {
  const dir = fixture('1.3.1');
  assert.throws(() => applyBump(dir, '1.3'), /not a dotted patch version/);
  assert.equal(readCurrentVersion(dir), '1.3.1');
});

const FAKE_EAS = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_EAS_LOG, JSON.stringify(args) + '\\n');
const out = (s) => process.stdout.write('A notice eas prints first\\n' + s + '\\n');
switch (args[0]) {
  case 'fingerprint:generate':
    if (!args.includes('production')) { process.stderr.write('expected --environment production\\n'); process.exit(3); }
    out(JSON.stringify({ hash: process.env.FAKE_FINGERPRINT }));
    break;
  case 'build:list':
    if (!args.includes('production')) { process.stderr.write('expected --build-profile production\\n'); process.exit(3); }
    out(args.includes('--fingerprint-hash') ? process.env.FAKE_MATCH : process.env.FAKE_VERSION_BUILDS);
    break;
  default:
    process.stderr.write('unexpected eas call ' + args.join(' ') + '\\n');
    process.exit(3);
}
`;

function runDecide({ match = [], versionBuilds = [], fingerprint = 'abc123' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bump-cli-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'eas'), FAKE_EAS);
  chmodSync(join(bin, 'eas'), 0o755);
  const log = join(dir, 'calls.log');
  const r = spawnSync('node', [SCRIPT, 'decide', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_EAS_LOG: log,
      FAKE_FINGERPRINT: fingerprint,
      FAKE_MATCH: JSON.stringify(match),
      FAKE_VERSION_BUILDS: JSON.stringify(versionBuilds),
    },
  });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { ...r, calls, decision: r.status === 0 ? JSON.parse(r.stdout) : null };
}

test('CLI decide: JS-only production fingerprint is a no-op and never looks at development', () => {
  const repoVersion = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo.version;
  const r = runDecide({ match: [FINISHED], versionBuilds: [FINISHED], fingerprint: 'fp-js' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.decision.action, 'noop');
  assert.equal(r.decision.reason, 'fingerprint-match');
  assert.equal(r.decision.fingerprint, 'fp-js');
  assert.equal(r.decision.version, repoVersion);
  assert.equal(r.calls.length, 3);
  assert.equal(r.calls[0][0], 'fingerprint:generate');
  assert.ok(r.calls[0].includes('production'));
  assert.ok(!r.calls.some((c) => c.includes('development')));
  const listCalls = r.calls.filter((c) => c[0] === 'build:list');
  assert.equal(listCalls.length, 2);
  assert.ok(listCalls.every((c) => c.includes('production') && c.includes('ios')));
});

test('CLI decide: native change with a store build of this version reports a bump', () => {
  const repoVersion = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo.version;
  const r = runDecide({ match: [], versionBuilds: [FINISHED], fingerprint: 'fp-native' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.decision.action, 'bump');
  assert.equal(r.decision.reason, 'native-change-version-in-use');
  assert.equal(r.decision.version, repoVersion);
  assert.equal(r.decision.nextVersion, nextPatch(repoVersion));
  assert.equal(r.decision.fingerprint, 'fp-native');
});

test('CLI decide: native change with no store build of this version is a no-op', () => {
  const r = runDecide({ match: [], versionBuilds: [CANCELED], fingerprint: 'fp-newver' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.decision.action, 'noop');
  assert.equal(r.decision.reason, 'version-unused');
});

test('CLI apply writes the next patch into a fixture and can be pointed at a directory via cwd', () => {
  const dir = fixture('1.3.9');
  const r = spawnSync('node', [SCRIPT, 'apply'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wrote version 1\.3\.10/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo.version, '1.3.10');
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '1.3.10');
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, '1.3.10');
  assert.equal(lock.packages[''].version, '1.3.10');
});

test('CLI rejects an unknown command without talking to eas', () => {
  const r = spawnSync('node', [SCRIPT, 'ship'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
