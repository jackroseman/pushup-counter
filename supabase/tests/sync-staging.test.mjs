// No database: checks the guards and the SQL the staging sync builds
// (supabase/staging/sync-from-prod.mjs). The load itself is exercised by a dry run and a
// real run of the "Sync staging from production" workflow.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSafeTargets,
  buildLoadSql,
  buildReadSql,
  buildVerifySql,
  TABLES,
} from '../staging/sync-from-prod.mjs';

const prod = 'qjvmkqajlvpzfyynbetn';
const staging = 'qkfdkeoijboazztnliob';

test('refuses a target that is the source, not staging, or malformed', () => {
  const ok = { sourceRef: prod, targetRef: staging, sourceName: 'pushup-battles-prod', targetName: 'pushup-battles-staging' };
  assert.doesNotThrow(() => assertSafeTargets(ok));
  assert.throws(() => assertSafeTargets({ ...ok, targetRef: prod, targetName: 'pushup-battles-staging' }), /same project/);
  assert.throws(() => assertSafeTargets({ ...ok, targetName: 'pushup-battles-prod' }), /not named staging/);
  assert.throws(() => assertSafeTargets({ ...ok, sourceName: 'pushup-battles-staging' }), /must be production/);
  assert.throws(() => assertSafeTargets({ ...ok, targetRef: 'nope' }), /20-letter/);
  assert.throws(() => assertSafeTargets({ ...ok, sourceRef: undefined }), /20-letter/);
});

test('never copies push tokens, the outbox, server config, app settings or sessions', () => {
  const copied = TABLES.map((t) => t.table);
  for (const banned of ['push_tokens', 'notification_outbox', 'server_config', 'app_settings', 'sessions', 'refresh_tokens']) {
    assert.ok(!copied.some((t) => t.includes(banned)), `${banned} must not be copied`);
  }
  const load = buildLoadSql(Object.fromEntries(TABLES.map((t) => [t.key, []])));
  assert.match(load, /truncate [^;]*public\.push_tokens[^;]*private\.notification_outbox/);
  assert.doesNotMatch(load, /truncate [^;]*app_settings/);
  assert.doesNotMatch(load, /truncate [^;]*server_config/);
});

test('the read query only reads, and covers every table', () => {
  const read = buildReadSql();
  assert.doesNotMatch(read, /\b(insert|update|delete|truncate|drop|alter)\b/i);
  for (const t of TABLES) assert.ok(read.includes(`'${t.key}'`));
});

test('the load is one transaction with triggers off for the insert and a scrub', () => {
  const load = buildLoadSql(Object.fromEntries(TABLES.map((t) => [t.key, []])));
  assert.match(load, /^begin;/);
  assert.match(load, /commit;$/);
  assert.match(load, /set local session_replication_role = replica/);
  assert.match(load, /provider_id = 'staging-'/);
  assert.match(load, /raw_user_meta_data = '\{\}'/);
  assert.match(load, /setval\('public\.detector_configs_id_seq'/);
});

test('refuses data that would break out of the SQL quoting', () => {
  assert.throws(() => buildLoadSql({ x: '$sync$' }), /quote tag/);
});

test('the verify query counts every table and checks the kept user', () => {
  const verify = buildVerifySql();
  for (const t of TABLES) assert.ok(verify.includes(`from ${t.table}`));
  assert.match(verify, /keep_user_present/);
});
