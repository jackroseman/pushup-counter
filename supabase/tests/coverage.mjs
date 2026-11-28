/**
 * Behavioral coverage of the public schema for `npm run test:db`.
 *
 * PGlite does not increment pg_stat_user_functions (track_functions stays at
 * zero), so this check uses the live catalog plus the steps in cases.mjs:
 * every public function and view must appear in at least one step that
 * asserts a decision (`checks[title]`) or an invalid transition (`expect ERR`),
 * unless it is listed below as intentionally not tested directly.
 *
 * A mention in a setup-only step does not count. Calling a function just to
 * touch it does not count unless that step has an assertion.
 */
const INTENTIONAL = {
  functions: {
    server_now:
      'Clock helper used inside RPCs. Window, deadline, and "days left" rules are asserted on those RPCs.',
    setting:
      'Settings lookup used inside RPCs. Readable defaults and value changes are asserted via app_settings and the RPCs that honor them.',
    depth_ratio:
      'Scoring primitive. Depth and shallow-rep decisions are asserted on set_metrics and standings.',
    battle_metric_value:
      'Scoring primitive. Rank, winner, and valid_reps decisions are asserted on challenge_standings / challenge_results.',
    tempo_score:
      'Scoring primitive. Tempo on a scored set is asserted through standings and set_metrics, not by calling the helper.',
    ensure_detector_config:
      'Called from submit_set when a set is stored. Detector rows are asserted through submit_set.',
    tg_battle_add_creator:
      'Trigger. Creator membership is asserted through create_challenge and participant rows.',
    tg_battle_defaults:
      'Trigger. Default window and attempt values are asserted on the created challenge.',
    tg_battle_results_immutable:
      'Trigger. Locked results are asserted by refused updates after finalize_challenges.',
    tg_participant_after:
      'Trigger. Accept / decline / forfeit side effects are asserted on challenge and notification rows.',
    tg_participant_guard:
      'Trigger. Illegal participant transitions are asserted as rejected updates.',
    tg_set_battle_guard:
      'Trigger. Who may attach a set, and when, is asserted through submit_set.',
    tg_sets_fill_time_zone:
      'Trigger. recorded_time_zone and local dates are asserted on the set row.',
  },
  views: {
    challenge_entries:
      'Source for live standings. Entry-level scoring is asserted through challenge_standings and challenge_results.',
    goal_for_date:
      'Used by my_progress and streak eligibility. Daily goal hits are asserted through those RPCs.',
    weekly_totals:
      'Used by my_progress and my_league. Weekly totals and ranks are asserted through those RPCs.',
    monthly_totals:
      'Used by my_progress. Monthly totals are asserted through that RPC.',
  },
};

function mentionPattern(name, asFunction) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return asFunction ? new RegExp(`\\b${escaped}\\s*\\(`, 'i') : new RegExp(`\\b${escaped}\\b`, 'i');
}

function behavioralSql(steps, checks) {
  return steps
    .filter(([title]) => /expect ERR/.test(title) || typeof checks[title] === 'function')
    .map(([title, sql]) => ({ title, sql }))
    .filter((s) => typeof s.sql === 'string');
}

function coveredBy(sqls, name, asFunction) {
  const re = mentionPattern(name, asFunction);
  return sqls.filter((s) => re.test(s.sql)).map((s) => s.title);
}

export function evaluateCoverage({ functions, views, steps, checks }) {
  const sqls = behavioralSql(steps, checks);
  const missing = [];
  const covered = [];
  const intentional = [];

  for (const fn of functions) {
    const reason = INTENTIONAL.functions[fn.name];
    const titles = coveredBy(sqls, fn.name, true);
    if (reason) intentional.push({ kind: 'function', ...fn, reason });
    else if (titles.length === 0) missing.push({ kind: 'function', ...fn });
    else covered.push({ kind: 'function', ...fn, tests: titles });
  }
  for (const view of views) {
    const reason = INTENTIONAL.views[view.name];
    const titles = coveredBy(sqls, view.name, false);
    if (reason) intentional.push({ kind: 'view', ...view, reason });
    else if (titles.length === 0) missing.push({ kind: 'view', ...view });
    else covered.push({ kind: 'view', ...view, tests: titles });
  }

  return { covered, intentional, missing, behavioralSteps: sqls.length };
}

export async function loadPublicCatalog(db) {
  const fns = await db.query(`
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
     order by 1, 2
  `);
  const views = await db.query(`
    select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('v', 'm')
     order by 1
  `);
  return { functions: fns.rows, views: views.rows };
}

export async function assertPublicApiCoverage(db, { steps, checks, assert }) {
  const catalog = await loadPublicCatalog(db);
  const report = evaluateCoverage({ ...catalog, steps, checks });
  if (report.missing.length) {
    const lines = report.missing.map((m) =>
      m.kind === 'function' ? `  function public.${m.name}(${m.args})` : `  view public.${m.name}`,
    );
    assert.fail(
      `public RPCs/views lack a behavioral test (a checks[] assertion or an expect ERR step):\n${lines.join('\n')}\n` +
        `Covered ${report.covered.length}, intentionally untested ${report.intentional.length}, missing ${report.missing.length}. ` +
        `Add a test of the decision the object owns, or list it in supabase/tests/coverage.mjs with a reason.`,
    );
  }
}

export { INTENTIONAL };
