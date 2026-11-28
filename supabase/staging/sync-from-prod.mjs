// STAGING ONLY: copies the data in production into staging, so dev builds are tested
// against real-shaped data. Run by .github/workflows/sync-staging.yml (manual).
//
//   SUPABASE_ACCESS_TOKEN=... SOURCE_REF=<prod ref> TARGET_REF=<staging ref> \
//     node supabase/staging/sync-from-prod.mjs [--dry-run]
//
// How it works (Supabase Management API only; no pg_dump, no database password):
//   1. Reads the tables below from production through the READ-ONLY query endpoint, which
//      cannot write. Production is never modified.
//   2. In ONE transaction on staging: empties the same tables, deletes every staging auth
//      user except the test bot, inserts the copied rows with triggers off
//      (session_replication_role = replica, so no notifications fire and no guard blocks
//      the load), scrubs the copied users, and resets the identity sequences.
//
// Migration safe: the columns to insert come from staging's own catalog and are limited to
// the keys present in the production rows. A column that only staging has takes its
// default; a column that only production has is ignored. A new NOT NULL column without a
// default makes the whole transaction fail and roll back, the same way it would on
// production's real rows. Tables that exist only in staging are left alone.
//
// What is NOT copied: push_tokens (staging must never push to a real phone), the
// notification outbox, private.server_config (the staging notify URL), app_settings
// (staging owns its tuning), auth sessions and tokens.
//
// Scrubbing: every copied user except KEEP_USERNAME loses email, phone and metadata, and
// gets a made-up Apple subject, so nobody but that one person can sign in. Usernames and
// display names are kept. The repo is public: this script logs row counts only, never
// row values, never SQL, and never an API response body.
import { pathToFileURL } from 'node:url';

const API = 'https://api.supabase.com/v1/projects';
const BOT_ID = '00000000-0000-4000-8000-00000000b07a'; // supabase/staging/test_bot.sql
const KEEP_USERNAME = 'jack';
const REF_PATTERN = /^[a-z]{20}$/;

// key: name in the exported JSON. table: where it goes. Order does not matter for the
// load (foreign keys are not checked with triggers off); it is the order counts print in.
export const TABLES = [
  { key: 'detector_configs', table: 'public.detector_configs' },
  { key: 'programs', table: 'public.programs' },
  { key: 'program_segments', table: 'public.program_segments' },
  { key: 'users', table: 'auth.users' },
  { key: 'identities', table: 'auth.identities' },
  { key: 'profiles', table: 'public.profiles' },
  { key: 'devices', table: 'public.devices' },
  { key: 'notification_prefs', table: 'public.notification_prefs' },
  { key: 'friendships', table: 'public.friendships' },
  { key: 'friend_invite_links', table: 'public.friend_invite_links' },
  { key: 'challenges', table: 'public.challenges' },
  { key: 'challenge_invite_links', table: 'public.challenge_invite_links' },
  { key: 'challenge_participants', table: 'public.challenge_participants' },
  { key: 'sets', table: 'public.sets' },
  { key: 'reps', table: 'public.reps' },
  { key: 'set_traces', table: 'public.set_traces' },
  { key: 'set_flags', table: 'public.set_flags' },
  { key: 'challenge_results', table: 'public.challenge_results' },
  { key: 'goal_enrollments', table: 'public.goal_enrollments' },
  { key: 'deleted_sets', table: 'public.deleted_sets' },
  { key: 'friend_invite_redemptions', table: 'private.friend_invite_redemptions' },
];

// Emptied on staging but never filled from production.
const EMPTIED_ONLY = ['public.push_tokens', 'private.notification_outbox'];

// Tables with an identity column: their sequence must pass the highest copied id.
const SEQUENCES = [
  { table: 'public.detector_configs', sequence: 'public.detector_configs_id_seq' },
  { table: 'public.set_flags', sequence: 'public.set_flags_id_seq' },
  {
    table: 'private.friend_invite_redemptions',
    sequence: 'private.friend_invite_redemptions_id_seq',
  },
];

export function assertSafeTargets({ sourceRef, targetRef, sourceName, targetName }) {
  if (!REF_PATTERN.test(sourceRef ?? '') || !REF_PATTERN.test(targetRef ?? '')) {
    throw new Error('SOURCE_REF and TARGET_REF must both be 20-letter project refs.');
  }
  if (sourceRef === targetRef) throw new Error('The source and the target are the same project.');
  if (!/staging/i.test(targetName ?? '')) {
    throw new Error('The target project is not named staging. Refusing to write to it.');
  }
  if (/staging/i.test(sourceName ?? '')) {
    throw new Error('The source project is named staging. It must be production.');
  }
}

export function buildReadSql() {
  const parts = TABLES.map(
    ({ key, table }) =>
      `'${key}', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${table} t)`,
  );
  return `select jsonb_build_object(${parts.join(', ')}) as d`;
}

export function buildLoadSql(data) {
  const json = JSON.stringify(data);
  if (json.includes('$sync$')) throw new Error('The data contains the SQL quote tag.');
  const values = TABLES.map(({ key, table }) => `('${key}', '${table}')`).join(', ');
  const emptied = [...TABLES.filter(({ table }) => !table.startsWith('auth.')).map((t) => t.table), ...EMPTIED_ONLY];
  const keep = `(select id from public.profiles where username = '${KEEP_USERNAME}')`;
  const sequences = SEQUENCES.map(
    ({ table, sequence }) =>
      `select setval('${sequence}', coalesce((select max(id) from ${table}), 1), (select count(*) > 0 from ${table}));`,
  ).join('\n');
  return `begin;
create temp table _src on commit drop as select $sync$${json}$sync$::jsonb as d;
create temp table _bot_profile on commit drop as select * from public.profiles where id = '${BOT_ID}';
create temp table _bot_prefs on commit drop as select * from public.notification_prefs where user_id = '${BOT_ID}';
set local session_replication_role = replica;
truncate ${emptied.join(', ')};
-- Deleting users with triggers on lets the auth tables cascade (identities, sessions, tokens).
set local session_replication_role = origin;
delete from auth.users where id <> '${BOT_ID}';
set local session_replication_role = replica;
insert into public.profiles select * from _bot_profile;
insert into public.notification_prefs select * from _bot_prefs;
do $do$
declare r record; cols text;
begin
  for r in select * from (values ${values}) v(k, t) loop
    if jsonb_array_length((select d -> r.k from _src)) = 0 then continue; end if;
    select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = split_part(r.t, '.', 1) and c.table_name = split_part(r.t, '.', 2)
       and c.is_generated = 'NEVER'
       and exists (select 1 from jsonb_object_keys((select (d -> r.k) -> 0 from _src)) k
                    where k = c.column_name);
    execute format(
      'insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s, (select d -> %L from _src))',
      r.t, cols, cols, r.t, r.k);
  end loop;
end $do$;
update auth.users
   set email = null, phone = null, raw_user_meta_data = '{}'::jsonb, encrypted_password = null
 where id <> ${keep} and id <> '${BOT_ID}';
update auth.identities
   set provider_id = 'staging-' || user_id::text,
       identity_data = jsonb_build_object('sub', 'staging-' || user_id::text)
 where user_id <> ${keep};
${sequences}
commit;`;
}

export function buildVerifySql() {
  const counts = TABLES.map(
    ({ key, table }) => `select '${key}' as k, count(*)::text as v from ${table}`,
  ).join('\nunion all ');
  return `${counts}
union all select 'keep_user_present', exists(select 1 from public.profiles p join auth.users u on u.id = p.id
  join auth.identities i on i.user_id = u.id and i.provider = 'apple' and i.provider_id not like 'staging-%'
  where p.username = '${KEEP_USERNAME}')::text
union all select 'push_tokens', count(*)::text from public.push_tokens
union all select 'outbox', count(*)::text from private.notification_outbox`;
}

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Never log the body: an error can quote the data.
  if (!res.ok) throw new Error(`${method} ${path.replace(/^\/[a-z]+/, '/<ref>')} failed: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const sourceRef = process.env.SOURCE_REF;
  const targetRef = process.env.TARGET_REF;
  const dryRun = process.argv.includes('--dry-run');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set.');

  const [source, target] = await Promise.all(
    [sourceRef, targetRef].map((ref) => call(token, 'GET', `/${ref}`)),
  );
  assertSafeTargets({ sourceRef, targetRef, sourceName: source.name, targetName: target.name });
  console.log(`Source: ${source.name} (read only). Target: ${target.name}.`);

  const rows = await call(token, 'POST', `/${sourceRef}/database/query/read-only`, {
    query: buildReadSql(),
  });
  const data = rows[0]?.d;
  if (!data) throw new Error('The source returned no data.');
  const counts = TABLES.map(({ key, table }) => `${table}: ${data[key].length}`);
  console.log(`Read from the source:\n  ${counts.join('\n  ')}`);

  if (dryRun) {
    console.log('Dry run: nothing was written to the target.');
    return;
  }

  await call(token, 'POST', `/${targetRef}/database/query`, { query: buildLoadSql(data) });
  const verify = await call(token, 'POST', `/${targetRef}/database/query`, {
    query: buildVerifySql(),
  });
  const got = Object.fromEntries(verify.map(({ k, v }) => [k, v]));
  const mismatched = TABLES.filter(({ key }) => Number(got[key]) !== data[key].length).map(
    ({ table }) => table,
  );
  console.log(`Target after the load:\n  ${TABLES.map(({ key, table }) => `${table}: ${got[key]}`).join('\n  ')}`);
  console.log(`push_tokens: ${got.push_tokens}, outbox: ${got.outbox}`);
  if (got.keep_user_present !== 'true') throw new Error(`@${KEEP_USERNAME} is missing in the target.`);
  if (mismatched.length) throw new Error(`Row counts differ for: ${mismatched.join(', ')}`);
  console.log('Done. Every table matches the source.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
