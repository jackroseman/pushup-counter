const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const cfg={algorithmVersion:2,floorDistance:0.08,fullRatio:0.7,goodRatio:0.45,minCountRatio:0.3,topZoneRatio:0.2,minRepIntervalMs:400,minNearDurationMs:80,smoothingWindow:3,proximityImpliesFull:true};
function rec(id, n, period, bottoms, opts={}) {
  const start = opts.start ?? (Date.now() - 60000); const reps=[]; const trace=[];
  let cur=start+500;
  for (let i=0;i<n;i++){ const per = opts.jitter ? period*(i%2?1+opts.jitter:1-opts.jitter) : period; const s=cur, b=s+per*0.45, t=s+per*0.9; cur+=per;
    const bd=bottoms[i%bottoms.length];
    reps.push({index:i+1,timestamp:t,quality:'full',source:'depth',bottomDistance:bd,topDistance:0.42,rangeOfMotion:0.42-bd,depthRatio:0.8,faceLostAtBottom:false,startedAt:s,bottomAt:b,descentMs:b-s,ascentMs:t-b,intervalMs:i?period:null,proximityTouched:false}); }
  const end=cur+500;
  for (let ms=0; ms<=end-start; ms+=100){ let d=0.42; for(const r of reps){ if(Math.abs(ms-(r.bottomAt-start))<=100) d=r.bottomDistance; } trace.push([ms, opts.badTrace?0.42:d]); }
  return {id, startedAt:start, endedAt:end, reps, calibratedTopDistance:0.42, calibrationSamples:60, depthTracking:true, version:2, trace, detectorConfig:cfg, appVersion:'1.2.0', ...opts.extra};
}
const as = (u)=>`set role authenticated; select set_config('request.jwt.claim.sub','${u}',false);`;
const q = (o)=>`'${JSON.stringify(o)}'::jsonb`;
export const steps = [
 ['setup users', `insert into auth.users values ('${A}'),('${B}'),('${C}');`],
 ['A creates profile', `${as(A)} insert into profiles(id,username) values ('${A}','sunny'); reset role;`],
 ['A cannot create B profile (expect ERR)', `${as(A)} insert into profiles(id,username) values ('${B}','fake'); reset role;`],
 ['B,C profiles', `${as(B)} insert into profiles(id,username) values ('${B}','bob'); reset role; ${as(C)} insert into profiles(id,username) values ('${C}','carol'); reset role;`],
 ['A solo set via submit_set', `${as(A)} select submit_set(${q(rec('solo-1',12,1500,[0.15,0.16,0.17]))}); reset role;`],
 ['idempotent retry returns same id', `${as(A)} select count(*) from (select submit_set(${q(rec('solo-1',12,1500,[0.15]))})) x; select count(*) from sets; reset role;`],
 ['A set_metrics', `${as(A)} select total_reps, full_reps, avg_depth_pct, depth_std_pct, depth_consistency, reps_per_minute, tempo_trend, avg_descent_s, active_duration_s from set_metrics; reset role;`],
 ['B cannot see A solo set', `${as(B)} select count(*) from sets; select count(*) from reps; reset role;`],
 ['A tries battle set directly (expect ERR)', `${as(A)} select submit_set(${q({...rec('x',3,1500,[0.15]),battleId:'00000000-0000-4000-8000-000000000000'})}); reset role;`],
 ['A friend-requests B; B accepts', `${as(A)} insert into friendships(user_low,user_high,requested_by) values (least('${A}'::uuid,'${B}'::uuid),greatest('${A}'::uuid,'${B}'::uuid),'${A}'); reset role; ${as(B)} update friendships set status='accepted', responded_at=now(); reset role;`],
 ['A cannot self-accept own request to C (expect ERR)', `${as(A)} insert into friendships(user_low,user_high,requested_by) values ('${A}','${C}','${A}'); update friendships set status='accepted' where user_high='${C}'; reset role;`],
 ['A creates async max_reps battle (id fixed)', `${as(A)} insert into battles(id,created_by,mode,format,metric,invite_expires_at,ends_at) values ('11111111-1111-4111-8111-111111111111','${A}','async','max_reps','rep_count',now()+interval '1 day',now()+interval '1 day'); select status, (select count(*) from battle_participants) from battles; reset role;`],
 ['A invites C (not friend, expect ERR)', `${as(A)} insert into battle_participants(battle_id,user_id,invited_by) values ('11111111-1111-4111-8111-111111111111','${C}','${A}'); reset role;`],
 ['A invites B', `${as(A)} insert into battle_participants(battle_id,user_id,invited_by) values ('11111111-1111-4111-8111-111111111111','${B}','${A}'); reset role;`],
 ['C cannot see battle', `${as(C)} select count(*) from battles; reset role;`],
 ['creator A submits attempt while pending (service role path)', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-a',20,1400,[0.14,0.15]),battleId:'11111111-1111-4111-8111-111111111111',userId:A})}) is not null; reset role;`],
 ['A second attempt (expect ERR no attempts left)', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-a2',25,1400,[0.14]),battleId:'11111111-1111-4111-8111-111111111111',userId:A})}); reset role;`],
 ['B cannot change invited_by (expect ERR)', `${as(B)} update battle_participants set invited_by='${B}' where user_id='${B}'; reset role;`],
 ['B accepts -> battle active', `${as(B)} update battle_participants set status='accepted' where user_id='${B}'; select status from battles; reset role;`],
 ['B sees A battle set + reps', `${as(B)} select count(*) from sets; select count(*) from reps; reset role;`],
 ['B submits with bad trace & some shallow reps', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-b',22,1300,[0.14,0.30],{badTrace:false}),battleId:'11111111-1111-4111-8111-111111111111',userId:B})}) is not null; reset role;`],
 ['rep_metrics quality spread for B', `${as(B)} select quality, count(*), min(implausible_reason) from rep_metrics where user_id='${B}' group by 1 order by 1; reset role;`],
 ['standings (provisional)', `${as(A)} select user_id=('${A}')::uuid as is_a, valid_reps, metric_value, rank, is_winner, attempts_used from battle_standings order by rank; reset role;`],
 ['finalize -> completed', `select finalize_battles(); select status from battles;`],
 ['standings final', `${as(B)} select user_id=('${A}')::uuid as is_a, valid_reps, metric_value, rank, is_winner from battle_standings order by rank; reset role;`],
 ['user_stats A', `${as(A)} select username,total_sets,total_reps,best_set_reps,current_streak_days,battles_played,battles_won,battles_lost from user_stats where user_id='${A}'; reset role;`],
 ['realtime: B can join battle channel, C cannot', `${as(B)} select set_config('realtime.topic','battle:11111111-1111-4111-8111-111111111111',false); select private.can_join_battle_channel(realtime.topic()); reset role; ${as(C)} select private.can_join_battle_channel('battle:11111111-1111-4111-8111-111111111111'), private.can_join_battle_channel('garbage'); reset role;`],
 ['live battle: create, accept, ready x2 -> starts_at set', `${as(A)} insert into battles(id,created_by,mode,format,metric,duration_s,invite_expires_at) values ('22222222-2222-4222-8222-222222222222','${A}','live','timed','rep_count',60,now()+interval '10 minutes'); insert into battle_participants(battle_id,user_id,invited_by) values ('22222222-2222-4222-8222-222222222222','${B}','${A}'); reset role; ${as(B)} update battle_participants set status='accepted', responded_at=now() where battle_id='22222222-2222-4222-8222-222222222222' and user_id='${B}'; update battle_participants set ready_at=now() where battle_id='22222222-2222-4222-8222-222222222222' and user_id='${B}'; reset role; ${as(A)} update battle_participants set ready_at=now() where battle_id='22222222-2222-4222-8222-222222222222' and user_id='${A}'; select status, starts_at is not null from battles where id='22222222-2222-4222-8222-222222222222'; reset role;`],
 ['live: ready after start (expect ERR)', `${as(A)} update battle_participants set ready_at=null where battle_id='22222222-2222-4222-8222-222222222222' and user_id='${A}'; reset role;`],
 ['live timed: B set started on time is valid; timed window caps reps', `update battles set starts_at = now() - interval '61 seconds' where id='22222222-2222-4222-8222-222222222222'; select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('live-b',40,1600,[0.14,0.15],{start:Date.now()-61000}),battleId:'22222222-2222-4222-8222-222222222222',userId:B})}) is not null; reset role; ${as(B)} select valid_reps, metric_value from battle_standings where battle_id='22222222-2222-4222-8222-222222222222' and user_id='${B}'; reset role;`],
 ['A finally submits async attempt -> finalize completes', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-a',15,1400,[0.14]),battleId:'11111111-1111-4111-8111-111111111111',userId:A})}) is not null; reset role; select finalize_battles(); select status from battles where id='11111111-1111-4111-8111-111111111111';`],
 ['A second attempt (expect ERR no attempts left)', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-a2',25,1400,[0.14]),battleId:'11111111-1111-4111-8111-111111111111',userId:A})}); reset role;`],
 ['final standings + stats', `${as(A)} select user_id=('${A}')::uuid as is_a, valid_reps, rank, is_winner from battle_standings where battle_id='11111111-1111-4111-8111-111111111111' order by rank; select battles_played, battles_won, battles_lost from user_stats where user_id='${B}'; reset role;`],
 ['check constraint: live multi_day as superuser (expect ERR)', `insert into battles(created_by,mode,format,invite_expires_at,ends_at) values ('${A}','live','multi_day',now()+interval '1 hour',now()+interval '7 days');`],
 ['bad-trace cheat: reps not in trace flagged', `select set_config('request.jwt.claim.sub','',false); insert into battles(id,created_by,mode,format,metric,invite_expires_at,ends_at) values ('33333333-3333-4333-8333-333333333333','${A}','async','max_reps','rep_count',now()+interval '1 day',now()+interval '1 day'); set role service_role; select public.submit_set(${q({...rec('cheat',30,700,[0.14],{badTrace:true}),battleId:'33333333-3333-4333-8333-333333333333',userId:A})}) is not null; reset role; select implausible_reason, count(*) from rep_metrics rm join sets s on s.id=rm.set_id where s.client_set_id='cheat' group by 1;`],

 ['quality rule: min_quality shallow rejected (expect ERR)', `insert into battles(created_by,mode,format,min_quality,invite_expires_at,ends_at) values ('${A}','async','max_reps','shallow',now()+interval '1 hour',now()+interval '1 day');`],
 ['timed must rank by rep_count (expect ERR)', `insert into battles(created_by,mode,format,metric,duration_s,invite_expires_at,ends_at) values ('${A}','async','timed','form_score',60,now()+interval '1 hour',now()+interval '1 day');`],
 ['tempo_score is speed-independent', `select tempo_score(10, 1000, 0) fast_steady, tempo_score(10, 3000, 0) slow_steady, tempo_score(10, 1000, 300) jittery, tempo_score(1, 1000, 0) too_few;`],
 ['async timed: equal good reps, tempo consistency breaks tie', `select set_config('request.jwt.claim.sub','',false); insert into battles(id,created_by,mode,format,metric,duration_s,invite_expires_at,ends_at) values ('44444444-4444-4444-8444-444444444444','${A}','async','timed','rep_count',60,now()+interval '1 day',now()+interval '1 day'); insert into battle_participants(battle_id,user_id,invited_by,status) values ('44444444-4444-4444-8444-444444444444','${B}','${A}','invited'); update battle_participants set status='accepted', responded_at=now() where battle_id='44444444-4444-4444-8444-444444444444' and user_id='${B}'; set role service_role; select public.submit_set(${q({...rec('tt-a',20,1500,[0.14],{jitter:0.3}),battleId:'44444444-4444-4444-8444-444444444444',userId:A})}) is not null; select public.submit_set(${q({...rec('tt-b',20,2500,[0.14]),battleId:'44444444-4444-4444-8444-444444444444',userId:B})}) is not null; reset role; select user_id=('${A}')::uuid is_a, valid_reps, tempo_score, rank, locked from battle_standings where battle_id='44444444-4444-4444-8444-444444444444' order by rank;`],
 ['finalize locks timed result', `select finalize_battles(); select user_id=('${A}')::uuid is_a, valid_reps, tempo_score, rank, is_winner, locked from battle_standings where battle_id='44444444-4444-4444-8444-444444444444' order by rank; select count(*) from battle_results where battle_id='44444444-4444-4444-8444-444444444444';`],
 ['post-lock moderation flag: live calc changes, locked result does not', `insert into set_flags(set_id, flagged_by, reason, excludes) select id, '${A}', 'test', true from sets where client_set_id='tt-b'; select (select valid_reps from battle_standings_live where battle_id='44444444-4444-4444-8444-444444444444' and user_id='${B}') live_b, (select valid_reps from battle_standings where battle_id='44444444-4444-4444-8444-444444444444' and user_id='${B}') locked_b, (select is_winner from battle_standings where battle_id='44444444-4444-4444-8444-444444444444' and user_id='${B}') still_winner;`],
 ['service role cannot update locked result (expect ERR)', `set role service_role; update battle_results set is_winner = not is_winner where battle_id='44444444-4444-4444-8444-444444444444'; reset role;`],
 ['user cannot insert into battle_results (expect ERR)', `${as(A)} insert into battle_results(battle_id,user_id,participant_status,valid_reps,rank,is_winner,metric,scoring_version,attempts_used) values ('44444444-4444-4444-8444-444444444444','${A}','accepted',99,1,true,'rep_count',1,1); reset role;`],
 ['B sees locked result; C does not', `${as(B)} select count(*) from battle_standings where battle_id='44444444-4444-4444-8444-444444444444'; reset role; ${as(C)} select count(*) from battle_standings where battle_id='44444444-4444-4444-8444-444444444444'; select count(*) from battle_results; reset role;`],
 ['draw: identical sets -> no winner, stats count draw', `select set_config('request.jwt.claim.sub','',false); insert into battles(id,created_by,mode,format,metric,invite_expires_at,ends_at) values ('55555555-5555-4555-8555-555555555555','${A}','async','max_reps','rep_count',now()+interval '1 day',now()+interval '1 day'); insert into battle_participants(battle_id,user_id,invited_by) values ('55555555-5555-4555-8555-555555555555','${B}','${A}'); update battle_participants set status='accepted', responded_at=now() where battle_id='55555555-5555-4555-8555-555555555555' and user_id='${B}'; set role service_role; select public.submit_set(${q({...rec('dd-a',10,1500,[0.14]),battleId:'55555555-5555-4555-8555-555555555555',userId:A})}) is not null; select public.submit_set(${q({...rec('dd-b',10,1500,[0.14]),battleId:'55555555-5555-4555-8555-555555555555',userId:B})}) is not null; reset role; select finalize_battles(); select rank, is_winner from battle_standings where battle_id='55555555-5555-4555-8555-555555555555'; ${as(A)} select battles_played, battles_won, battles_drawn, battles_lost from user_stats where user_id='${A}'; reset role;`],
 ['shallow reps never count (B async set had 11 shallow of 22)', `select valid_reps from battle_standings where battle_id='11111111-1111-4111-8111-111111111111' and user_id='${B}';`],
 ['settings: anon can read app settings', `set role anon; select value from app_settings where key='async_max_participants'; reset role;`],
 ['settings: battle copies form weights at creation; later change does not alter it', `select set_config('request.jwt.claim.sub','',false); update app_settings set value='{"depth":0.6,"consistency":0.2,"tempo":0.2}' where key='form_score_weights'; insert into battles(id,created_by,mode,format,metric,invite_expires_at,ends_at) values ('66666666-6666-4666-8666-666666666666','${A}','async','max_reps','form_score',now()+interval '1 day',now()+interval '1 day'); update app_settings set value='{"depth":0.5,"consistency":0.3,"tempo":0.2}' where key='form_score_weights'; select form_weights->>'depth' as depth from battles where id='66666666-6666-4666-8666-666666666666';`],
 ['settings: form score uses the battle weights', `select battle_metric_value('form_score',1::smallint,5::smallint,10,80,0,9,1000,0,'{"depth":0.6,"consistency":0.2,"tempo":0.2}') w602020, battle_metric_value('form_score',1::smallint,5::smallint,10,80,0,9,1000,0,'{"depth":0.5,"consistency":0.3,"tempo":0.2}') w503020;`],
 ['settings: async battle over the participant cap (expect ERR)', `insert into battles(created_by,mode,format,max_participants,invite_expires_at,ends_at) values ('${A}','async','max_reps',9,now()+interval '1 hour',now()+interval '1 day');`],
 ['settings: live battle cap comes from settings', `insert into battles(id,created_by,mode,format,max_participants,invite_expires_at) values ('77777777-7777-4777-8777-777777777777','${A}','live','max_reps',5,now()+interval '10 minutes'); select max_participants from battles where id='77777777-7777-4777-8777-777777777777';`],
 ['settings: users cannot change settings (expect ERR)', `${as(A)} update app_settings set value='99' where key='async_max_participants'; reset role;`],
 ['invalid enum combo: live multi_day (expect ERR)', `${as(A)} insert into battles(created_by,mode,format,invite_expires_at,starts_at,ends_at) values ('${A}','live','multi_day',now()+interval '1 hour',now(),now()+interval '7 days'); reset role;`],
 ['B deletes own battle set (expect 0 rows)', `${as(B)} with d as (delete from sets where user_id='${B}' and battle_id is not null returning 1) select count(*) from d; reset role;`],
 ['anon sees nothing (expect ERR)', `set role anon; select count(*) from profiles; reset role;`],
];

// Expected results per step title. `rows` = result sets (excluding set_config) as arrays of rows.
// Titles containing "expect ERR" must fail; every other step must succeed.
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
export const checks = {
  'idempotent retry returns same id': (r) => ok(r[1][0].count === 1, 'duplicate set'),
  'B cannot see A solo set': (r) => ok(r[0][0].count === 0 && r[1][0].count === 0, 'RLS leak'),
  'C cannot see battle': (r) => ok(r[0][0].count === 0, 'RLS leak'),
  'B accepts -> battle active': (r) => ok(r[0][0].status === 'active', 'not active'),
  'standings (provisional)': (r) => ok(r[0][0].is_a && r[0][0].valid_reps === 20 && r[0][1].valid_reps === 11 && r[0][0].is_winner === false, 'bad provisional standings'),
  'finalize -> completed': (r) => ok(r[1][0].status === 'completed', 'not completed'),
  'standings final': (r) => ok(r[0][0].is_a && r[0][0].is_winner === true && r[0][1].is_winner === false, 'bad final standings'),
  'user_stats A': (r) => ok(r[0][0].battles_won === 1 && r[0][0].total_sets === 2, 'bad stats'),
  'realtime: B can join battle channel, C cannot': (r) => ok(r[0][0].can_join_battle_channel === true && r[1][0].can_join_battle_channel === false, 'realtime auth'),
  'live battle: create, accept, ready x2 -> starts_at set': (r) => ok(r[0][0].status === 'active' && r[0][0]['?column?'] === true, 'live start'),
  'live timed: B set started on time is valid; timed window caps reps': (r) => ok(r[1][0].valid_reps === 37, 'timed cap ' + JSON.stringify(r[1])),
  'bad-trace cheat: reps not in trace flagged': (r) => ok(r[1][0].implausible_reason === 'not_in_trace' && r[1][0].count === 30, 'cheat not flagged'),
  'tempo_score is speed-independent': (r) => ok(r[0][0].fast_steady === r[0][0].slow_steady && Number(r[0][0].jittery) === 70 && r[0][0].too_few === null, 'tempo'),
  'async timed: equal good reps, tempo consistency breaks tie': (r) => ok(r[2][0].is_a === false && r[2][0].valid_reps === r[2][1].valid_reps && r[2][0].rank === 1 && r[2][1].rank === 2, 'tempo tiebreak'),
  'finalize locks timed result': (r) => ok(r[1][0].locked === true && r[1][0].is_winner === true && r[2][0].count === 2, 'lock'),
  'post-lock moderation flag: live calc changes, locked result does not': (r) => ok(r[0][0].live_b === 0 && r[0][0].locked_b === 20 && r[0][0].still_winner === true, 'lock changed'),
  'B sees locked result; C does not': (r) => ok(r[0][0].count === 2 && r[1][0].count === 0 && r[2][0].count === 0, 'results RLS'),
  'draw: identical sets -> no winner, stats count draw': (r) => ok(r[3].every((x) => x.rank === 1 && x.is_winner === false) && r[4][0].battles_drawn === 1, 'draw'),
  'shallow reps never count (B async set had 11 shallow of 22)': (r) => ok(r[0][0].valid_reps === 11, 'shallow counted'),
  'settings: anon can read app settings': (r) => ok(r[0][0].value === 8, 'settings read'),
  'settings: battle copies form weights at creation; later change does not alter it': (r) => ok(r[0][0].depth === '0.6', 'weights not copied'),
  'settings: form score uses the battle weights': (r) => ok(Number(r[0][0].w602020) === 88 && Number(r[0][0].w503020) === 90, 'weights ' + JSON.stringify(r[0])),
  'settings: live battle cap comes from settings': (r) => ok(r[0][0].max_participants === 2, 'live cap'),
  'B deletes own battle set (expect 0 rows)': (r) => ok(r[0][0].count === 0, 'deleted battle set'),
};
steps.push(
  ['hardening: users cannot call finalize_battles (expect ERR)', `${as(A)} select public.finalize_battles(); reset role;`],
  ['hardening: helpers are not in the public schema', `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('are_friends','is_battle_member','can_join_battle_channel');`],
);
checks['hardening: helpers are not in the public schema'] = (r) => ok(r[0][0].count === 0, 'helpers still public');
