// Database tests: loads Supabase stubs + every migration into PGlite (in-process Postgres),
// then runs the scenario steps in cases.mjs in order. Run: npm run test:db
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { steps, checks } from './cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
// pg_cron is not available in PGlite; scheduling migrations are skipped locally.
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.endsWith('_cron.sql')).sort();

const db = new PGlite({ extensions: { citext } });

test('migrations apply', async () => {
  await db.exec(`alter database postgres set search_path = "$user", public, extensions`);
  await db.exec(fs.readFileSync(path.join(here, 'stubs.sql'), 'utf8'));
  for (const f of migrations) await db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
});

for (const [title, sql] of steps) {
  test(title, async () => {
    const expectErr = /expect ERR/.test(title);
    let results;
    try {
      results = await db.exec(sql);
    } catch (e) {
      await db.exec('reset role; rollback;').catch(() => {});
      if (expectErr) return;
      throw e;
    }
    await db.exec('reset role;');
    assert.ok(!expectErr, 'expected an error, but the step succeeded');
    const rows = results
      .filter((x) => x.fields.length && !(x.fields.length === 1 && x.fields[0].name === 'set_config'))
      .map((x) => x.rows);
    checks[title]?.(rows);
  });
}
