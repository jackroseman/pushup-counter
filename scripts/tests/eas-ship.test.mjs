// Runs scripts/eas-ship.sh against a fake `eas` on PATH and checks which eas commands it
// would run (dry run) or runs. No network, no EXPO_TOKEN. `npm run test:scripts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'eas-ship.sh');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo.version;

// Fake eas: logs each call (one JSON argv per line) and answers from FAKE_* env vars.
const FAKE_EAS = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_EAS_LOG, JSON.stringify(args) + '\\n');
const out = (s) => process.stdout.write('A notice eas prints first\\n' + s + '\\n');
switch (args[0]) {
  case 'fingerprint:generate': out(JSON.stringify({ hash: process.env.FAKE_FINGERPRINT })); break;
  case 'build:list':
    out(args.includes('--fingerprint-hash') ? process.env.FAKE_MATCH : process.env.FAKE_VERSION_BUILDS);
    break;
  case 'workflow:runs':
    if (process.env.FAKE_RUNS === 'notfound') { process.stderr.write('Workflow not found\\n'); process.exit(1); }
    out(process.env.FAKE_RUNS);
    break;
  case 'workflow:run': process.exit(Number(process.env.FAKE_RUN_EXIT || 0));
  case 'update': process.exit(Number(process.env.FAKE_UPDATE_EXIT || 0));
  default: process.stderr.write('unexpected eas call ' + args.join(' ') + '\\n'); process.exit(3);
}
`;

function run(profile, { dryRun = false, match = [], versionBuilds = [], runs = [], rollout, updateExit } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eas-ship-'));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'eas'), FAKE_EAS);
  chmodSync(join(bin, 'eas'), 0o755);
  const log = join(dir, 'calls.log');
  const args = [SCRIPT, profile, '--message', 'test merge'];
  if (dryRun) args.push('--dry-run');
  if (rollout) args.push('--rollout', rollout);
  const r = spawnSync('bash', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_ACTIONS: '',
      GITHUB_REF_NAME: profile === 'production' ? 'main' : 'dev',
      FAKE_EAS_LOG: log,
      FAKE_FINGERPRINT: 'f1ngerprint0000000000000000000000000000',
      FAKE_MATCH: JSON.stringify(match),
      FAKE_VERSION_BUILDS: JSON.stringify(versionBuilds),
      FAKE_RUNS: runs === 'notfound' ? 'notfound' : JSON.stringify(runs),
      FAKE_UPDATE_EXIT: String(updateExit ?? 0),
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { ...r, calls, real: calls.filter((c) => c[0] === 'workflow:run' || c[0] === 'update') };
}

const BUILD = { id: 'b5030fd5-0000', status: 'FINISHED', runtime: { version: 'rt' } };

for (const [profile, workflow] of [['development', 'build-dev.yml'], ['production', 'build-production.yml']]) {
  test(`${profile}: JS-only change publishes one OTA and starts no build`, () => {
    const r = run(profile, { match: [BUILD] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.real.map((c) => c[0]), ['update']);
    assert.deepEqual(r.real[0].slice(0, 5), ['update', '--channel', profile, '--environment', profile]);
  });

  test(`${profile}: JS-only rollout is passed through`, () => {
    const r = run(profile, { match: [BUILD], rollout: '10' });
    assert.equal(r.status, 0, r.stderr);
    const u = r.real[0];
    assert.equal(u[u.indexOf('--rollout-percentage') + 1], '10');
  });

  test(`${profile}: native change starts ${workflow} once, then publishes the OTA for the new runtime`, () => {
    const r = run(profile, { runs: [{ id: 'old', status: 'SUCCESS' }] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.real.map((c) => c[0]), ['workflow:run', 'update']);
    assert.equal(r.real[0][1], `.eas/workflows/${workflow}`);
    assert.ok(!r.real[1].includes('--rollout-percentage'), 'the first update of a runtime goes to 100%');
    assert.deepEqual(r.real[1].slice(0, 5), ['update', '--channel', profile, '--environment', profile]);
  });

  test(`${profile}: native change, workflow never run before ("Workflow not found")`, () => {
    const r = run(profile, { runs: 'notfound' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.real.map((c) => c[0]), ['workflow:run', 'update']);
  });

  test(`${profile}: native change while ${workflow} is running starts no second build but still publishes`, () => {
    const r = run(profile, { runs: [{ id: 'busy', status: 'IN_PROGRESS' }] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.real.map((c) => c[0]), ['update']);
    assert.match(r.stdout, /already running/);
  });

  test(`${profile}: native change dry run prints both steps and runs neither`, () => {
    const r = run(profile, { dryRun: true });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.real, []);
    assert.match(r.stdout, new RegExp(`dry run: eas workflow:run \\.eas/workflows/${workflow.replace('.', '\\.')} --ref [0-9a-f]{40}`));
    assert.match(r.stdout, new RegExp(`dry run: eas update --channel ${profile} --environment ${profile} `));
  });

  test(`${profile}: JS-only dry run prints the OTA only`, () => {
    const r = run(profile, { dryRun: true, match: [BUILD] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.real, []);
    assert.doesNotMatch(r.stdout, /workflow:run/);
    assert.match(r.stdout, /dry run: eas update --channel/);
  });

  test(`${profile}: a failed OTA publish after starting the build fails the job`, () => {
    const r = run(profile, { updateExit: 1 });
    assert.notEqual(r.status, 0);
    assert.deepEqual(r.real.map((c) => c[0]), ['workflow:run', 'update']);
  });
}

test('production: native change under a version that already has a store build fails and publishes nothing', () => {
  const r = run('production', { versionBuilds: [{ id: 'x', status: 'FINISHED' }] });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.real, []);
  assert.match(r.stderr, new RegExp(`version ${VERSION.replace(/\./g, '\\.')}`));
});

test('production: canceled or errored builds of the version do not block a new build', () => {
  const r = run('production', { versionBuilds: [{ id: 'x', status: 'ERRORED' }, { id: 'y', status: 'CANCELED' }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.real.map((c) => c[0]), ['workflow:run', 'update']);
});

test('development: the version check is production-only', () => {
  const r = run('development', { versionBuilds: [{ id: 'x', status: 'FINISHED' }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.real.map((c) => c[0]), ['workflow:run', 'update']);
});

test('rejects an unknown profile', () => {
  const r = run('staging');
  assert.equal(r.status, 2);
});
