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
 ['A friend-requests B; B accepts', `${as(A)} select send_friend_request('bob'); reset role; ${as(B)} select respond_friend_request('${A}', true); reset role;`],
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

// ---- Phase 2b: identity ----
const D='dddddddd-dddd-4ddd-8ddd-dddddddddddd', E='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TOKEN='ExponentPushToken[abc123]';
steps.push(
  ['identity: setup D and E', `insert into auth.users values ('${D}'),('${E}'); ${as(D)} insert into profiles(id,username,display_name,time_zone) values ('${D}','dana','Dana','America/New_York'); reset role; ${as(E)} insert into profiles(id,username) values ('${E}','erin'); reset role;`],
  ['identity: username_available', `${as(D)} select username_available('dana') taken, username_available('new_name') free, username_available('No Caps') bad, username_available('ab') short, username_available(null) nul; reset role;`],
  ['identity: anon cannot call username_available (expect ERR)', `set role anon; select username_available('x_y_z'); reset role;`],
  ['identity: duplicate username, any case (expect ERR)', `${as(E)} update profiles set username='DANA' where id='${E}'; reset role;`],
  ['identity: user updates own profile', `${as(D)} update profiles set display_name='Dana R', time_zone='Europe/Paris' where id='${D}'; select display_name, time_zone from profiles where id='${D}'; reset role;`],
  ['identity: user cannot update another profile (0 rows)', `${as(E)} update profiles set display_name='hacked' where id='${D}'; reset role; select display_name from profiles where id='${D}';`],
  ['identity: register_device is idempotent', `${as(D)} select register_device('install-0001','iPhone17,1','26.1') = register_device('install-0001','iPhone17,1','26.2') same; select count(*), max(os_version) os from devices; reset role;`],
  ['identity: register_device requires sign-in (expect ERR)', `set role authenticated; select set_config('request.jwt.claim.sub','',false); select register_device('install-0001'); reset role;`],
  ['identity: register_push_token', `${as(D)} select register_push_token((select id from devices where installation_id='install-0001'), '${TOKEN}'); select count(*) from push_tokens; reset role;`],
  ['identity: cannot register a token for someone else device (expect ERR)', `${as(E)} select register_push_token((select id from devices where user_id='${D}' limit 1), '${TOKEN}'); reset role;`],
  ['identity: E cannot see D devices or tokens', `${as(E)} select count(*) from devices; select count(*) from push_tokens; reset role;`],
  ['identity: same phone, other account -> token moves', `${as(E)} select register_push_token(register_device('install-0001','iPhone17,1','26.2'), '${TOKEN}'); reset role; select d.user_id = '${E}'::uuid moved, count(*) over () n from push_tokens t join devices d on d.id = t.device_id;`],
  ['identity: invalid token format (expect ERR)', `${as(E)} select register_push_token((select id from devices where user_id='${E}'), 'not-a-token'); reset role;`],
  ['identity: solo sync upload (v2 + legacy v1)', `${as(D)} select submit_set(${q(rec('1730000000000',5,1500,[0.15]))}) is not null; select submit_set(${q({id:'1690000000000',startedAt:1690000000000,endedAt:1690000060000,reps:[{index:1,timestamp:1690000005000,quality:'good',source:'proximity',bottomDistance:null,topDistance:null,faceLostAtBottom:false}],calibratedTopDistance:null,depthTracking:false})}) is not null; select client_set_id, data_version from sets where user_id='${D}' order by 1; reset role;`],
  ['identity: D creates a battle with E; E deletes account', `${as(D)} select send_friend_request('erin'); reset role; ${as(E)} select respond_friend_request('${D}', true); select submit_set(${q(rec('e-solo',4,1500,[0.15]))}); insert into battles(id,created_by,mode,format,metric,invite_expires_at,ends_at) values ('7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e','${E}','async','max_reps','rep_count',now()+interval '1 day',now()+interval '1 day'); insert into battle_participants(battle_id,user_id,invited_by) values ('7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e','${D}','${E}'); reset role; ${as(D)} update battle_participants set status='accepted' where battle_id='7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e' and user_id='${D}'; reset role; select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('del-e',10,1500,[0.14]),battleId:'7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e',userId:E})}) is not null; select public.submit_set(${q({...rec('del-d',12,1500,[0.14]),battleId:'7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e',userId:D})}) is not null; reset role; select finalize_battles(); ${as(E)} select delete_my_account(); reset role; select (select count(*) from auth.users where id='${E}') users, (select count(*) from profiles where id='${E}') profiles, (select count(*) from devices where user_id='${E}') devices, (select count(*) from push_tokens) tokens, (select count(*) from friendships where '${E}' in (user_low,user_high)) friends, (select count(*) from battle_participants where user_id='${E}') parts, (select count(*) from sets where user_id='${E}') e_sets, (select count(*) from battles where id='7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e' and created_by is null) orphan_battles, (select count(*) from battle_results where battle_id='7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e') results, (select count(*) from battle_participants where battle_id='7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e' and invited_by is null) uninvited;`],
  ['identity: delete_my_account requires sign-in (expect ERR)', `set role authenticated; select set_config('request.jwt.claim.sub','',false); select delete_my_account(); reset role;`],
  ['identity: anon cannot delete accounts (expect ERR)', `set role anon; select delete_my_account(); reset role;`],
  ['identity: D account and sets untouched', `select count(*) from sets where user_id='${D}';`],
  ['identity: users still cannot null invited_by directly (expect ERR)', `${as(B)} update battle_participants set invited_by=null where user_id='${B}' and invited_by is not null; reset role;`],
  ['identity: results still locked for direct updates (expect ERR)', `set role service_role; update battle_results set best_set_id=null where best_set_id is not null; reset role;`],
);
Object.assign(checks, {
  'identity: username_available': (r) => ok(r[0][0].taken === false && r[0][0].free === true && r[0][0].bad === false && r[0][0].short === false && r[0][0].nul === false, 'username_available ' + JSON.stringify(r[0])),
  'identity: user updates own profile': (r) => ok(r[0][0].display_name === 'Dana R' && r[0][0].time_zone === 'Europe/Paris', 'profile update'),
  'identity: user cannot update another profile (0 rows)': (r) => ok(r[0][0].display_name === 'Dana R', 'profile hijack'),
  'identity: register_device is idempotent': (r) => ok(r[0][0].same === true && r[1][0].count === 1 && r[1][0].os === '26.2', 'device upsert'),
  'identity: register_push_token': (r) => ok(r[1][0].count === 1, 'token'),
  'identity: E cannot see D devices or tokens': (r) => ok(r[0][0].count === 0 && r[1][0].count === 0, 'device RLS'),
  'identity: same phone, other account -> token moves': (r) => { const x = r[r.length - 1]; ok(x.length === 1 && x[0].moved === true, 'token move ' + JSON.stringify(x)); },
  'identity: solo sync upload (v2 + legacy v1)': (r) => ok(r[2].length === 2 && r[2][0].data_version === 1 && r[2][1].data_version === 2, 'sync ' + JSON.stringify(r[2])),
  'identity: D creates a battle with E; E deletes account': (r) => {
    const x = r[r.length - 1][0];
    ok(x.users === 0 && x.profiles === 0 && x.devices === 0 && x.tokens === 0 && x.friends === 0 && x.parts === 0 && x.e_sets === 0 && x.orphan_battles === 1 && x.results === 1 && x.uninvited === 1, 'delete ' + JSON.stringify(x));
  },
  'identity: D account and sets untouched': (r) => ok(r[0][0].count === 3, 'D sets'),
});

// ---- Phase 3: friends, async battles, invite links, notifications ----
const F='f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', G='a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', H='b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
// Generated ids (battles, tokens) are kept in a scratch table between steps.
const ctx = (k) => `(select v from test_ctx where k='${k}')`;
const battleSet = (id, n, k, user, bottoms = [0.14]) =>
  `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q(rec(id, n, 1400, bottoms))} || jsonb_build_object('battleId', ${ctx(k)}, 'userId', '${user}')) is not null; reset role;`;
const outbox = (kind, user, k) => `(select count(*) from private.notification_outbox where kind='${kind}' and user_id='${user}'${k ? ` and battle_id=${ctx(k)}::uuid` : ''})`;
const create = (k, body, ids, tk) =>
  `with c as (select create_battle(${q(body)} || jsonb_build_object('friendIds', jsonb_build_array(${ids.map((i) => `'${i}'`).join(',')}))) r) insert into test_ctx select '${k}', r->>'battleId' from c${tk ? ` union all select '${tk}', r->>'inviteToken' from c` : ''} on conflict (k) do update set v = excluded.v;`;

steps.push(
  ['p3: setup F, G, H', `create table test_ctx (k text primary key, v text); grant all on test_ctx to authenticated, anon, service_role; delete from private.notification_outbox; insert into auth.users values ('${F}'),('${G}'),('${H}'); insert into profiles(id,username,display_name) values ('${F}','fred','Fred'),('${H}','hank',null); insert into profiles(id,username,time_zone) values ('${G}','gina','America/New_York');`],
  ['p3: direct friendship insert is denied (expect ERR)', `${as(F)} insert into friendships(user_low,user_high,requested_by) values (least('${F}'::uuid,'${G}'::uuid),greatest('${F}'::uuid,'${G}'::uuid),'${F}'); reset role;`],
  ['p3: direct friendship update is denied (expect ERR)', `${as(A)} update friendships set status='blocked'; reset role;`],
  ['p3: F requests G by username (any case)', `${as(F)} select send_friend_request('GINA') r; select send_friend_request('gina') again; reset role; select ${outbox('friend_request', G)} n;`],
  ['p3: unknown username (expect ERR)', `${as(F)} select send_friend_request('nobody_here'); reset role;`],
  ['p3: F cannot accept own request (expect ERR)', `${as(F)} select respond_friend_request('${G}', true); reset role;`],
  ['p3: G requesting back accepts', `${as(G)} select send_friend_request('fred') r; reset role; select ${outbox('friend_accepted', F)} n;`],
  ['p3: my_friends + search_users', `${as(F)} select username, relation from my_friends(); select username, relation from search_users('gi'); select count(*) from search_users('h'); select username, relation from search_users('ha'); select count(*) from search_users('%%'); reset role;`],
  ['p3: H blocks F: F cannot find H or see the block', `${as(H)} select block_user('${F}'); reset role; ${as(F)} select count(*) from search_users('ha'); select count(*) from friendships where '${H}' in (user_low,user_high); reset role; ${as(H)} select relation from my_friends(); reset role;`],
  ['p3: F cannot add H after the block (expect ERR)', `${as(F)} select send_friend_request('hank'); reset role;`],
  ['p3: only the blocker can unblock', `${as(F)} select unblock_user('${H}'); select remove_friend('${H}'); reset role; select count(*) from friendships where status='blocked'; ${as(H)} select unblock_user('${F}'); reset role; select count(*) from friendships where status='blocked';`],
  ['p3: friend_battle_record needs friendship (expect ERR)', `${as(F)} select friend_battle_record('${H}'); reset role;`],
  ['p3: create_battle rejects live (expect ERR)', `${as(F)} select create_battle(${q({ mode: 'live', format: 'max_reps', friendIds: [G] })}); reset role;`],
  ['p3: create_battle rejects non-friends (expect ERR)', `${as(F)} select create_battle(${q({ format: 'max_reps', friendIds: [H] })}); reset role;`],
  ['p3: create_battle rejects a 45 s timed battle (expect ERR)', `${as(F)} select create_battle(${q({ format: 'timed', durationS: 45, friendIds: [G] })}); reset role;`],
  ['p3: create_battle rejects a deadline past the max (expect ERR)', `${as(F)} select create_battle(${q({ format: 'max_reps', deadlineHours: 500, friendIds: [G] })}); reset role;`],
  ['p3: create_battle needs someone to invite (expect ERR)', `${as(F)} select create_battle(${q({ format: 'max_reps' })}); reset role;`],
  ['p3: F creates a max-reps battle with G + an invite link', `${as(F)} ${create('b1', { format: 'max_reps', inviteLink: true }, [G], 't1')} reset role; select status, max_participants, attempts_allowed, ends_at >= invite_expires_at and ends_at <= now() + interval '24 hours' deadline_ok, (select count(*) from battle_participants p where p.battle_id = b.id) parts from battles b where id = ${ctx('b1')}::uuid; select ${outbox('battle_invite', G, 'b1')} n;`],
  ['p3: anon previews the invite link', `set role anon; select invite_preview(${ctx('t1')}) p; select invite_preview('00000000000000000000000000000000') p; reset role;`],
  ['p3: anon cannot redeem (expect ERR)', `set role anon; select redeem_invite(${ctx('t1')}); reset role;`],
  ['p3: F plays first while pending', `${battleSet('p3-f', 20, 'b1', F)} select ${outbox('set_submitted', G, 'b1')} n;`],
  ['p3: users cannot claim notifications (expect ERR)', `${as(F)} select * from claim_notifications(10); reset role;`],
  ['p3: users cannot read the outbox (expect ERR)', `${as(F)} select count(*) from private.notification_outbox; reset role;`],
  ['p3: claim_notifications returns facts once', `set role service_role; select kind, user_id::text, facts from claim_notifications(100) order by id; select count(*) from claim_notifications(100); reset role;`],
  ['p3: G accepts -> active; creator notified', `${as(G)} update battle_participants set status='accepted' where battle_id=${ctx('b1')}::uuid and user_id='${G}'; reset role; select status from battles where id=${ctx('b1')}::uuid; select ${outbox('invite_accepted', F, 'b1')} n;`],
  ['p3: G plays; battle stays open while the link is usable', `${battleSet('p3-g', 15, 'b1', G)} select finalize_battles(); select status from battles where id=${ctx('b1')}::uuid;`],
  ['p3: H redeems the link (becomes F friend), idempotent', `${as(H)} select redeem_invite(${ctx('t1')})::text = ${ctx('b1')} same; select redeem_invite(${ctx('t1')})::text = ${ctx('b1')} again; reset role; select status, invite_link_token is not null via_link, invited_by::text from battle_participants where battle_id=${ctx('b1')}::uuid and user_id='${H}'; select status from friendships where user_low=least('${F}'::uuid,'${H}'::uuid) and user_high=greatest('${F}'::uuid,'${H}'::uuid); select ${outbox('invite_accepted', F, 'b1')} n;`],
  ['p3: F revokes the link', `${as(F)} select revoke_invite_link(${ctx('t1')}); reset role; set role anon; select invite_preview(${ctx('t1')})->>'status' s; reset role;`],
  ['p3: C cannot redeem a revoked link (expect ERR)', `${as(C)} select redeem_invite(${ctx('t1')}); reset role;`],
  ['p3: H plays -> everyone done -> completed and locked', `${battleSet('p3-h', 25, 'b1', H)} select finalize_battles(); select status from battles where id=${ctx('b1')}::uuid; select user_id::text u, rank, is_winner, valid_reps from battle_results where battle_id=${ctx('b1')}::uuid order by rank; select ${outbox('battle_result', F, 'b1')} + ${outbox('battle_result', G, 'b1')} + ${outbox('battle_result', H, 'b1')} n;`],
  ['p3: result facts', `set role service_role; select kind, user_id::text, facts from claim_notifications(100) where kind='battle_result' order by user_id; reset role;`],
  ['p3: my_battles detail for G', `${as(G)} select my_battles(${ctx('b1')}::uuid) b; select jsonb_array_length(my_battles()) n; reset role;`],
  ['p3: C does not see the battle', `${as(C)} select my_battles(${ctx('b1')}::uuid) b; reset role;`],
  ['p3: friend_battle_record (results only)', `${as(F)} select friend_battle_record('${G}') r; reset role;`],
  ['p3: battle waits for open in-app invites', `${as(F)} ${create('b2', { format: 'timed', durationS: 60 }, [G, H])} reset role; ${battleSet('p3-f2', 10, 'b2', F)} ${as(G)} update battle_participants set status='accepted' where battle_id=${ctx('b2')}::uuid and user_id='${G}'; reset role; ${battleSet('p3-g2', 12, 'b2', G, [0.14, 0.25, 0.30])} select finalize_battles(); select status from battles where id=${ctx('b2')}::uuid; ${as(H)} update battle_participants set status='declined' where battle_id=${ctx('b2')}::uuid and user_id='${H}'; reset role; select finalize_battles(); select status from battles where id=${ctx('b2')}::uuid; select ${outbox('invite_declined', F, 'b2')} n;`],
  ['p3: battles count Full AND Good reps, never Shallow (= set_metrics.counted_reps)', `select m.full_reps, m.good_reps, m.shallow_reps, m.implausible_reps, m.counted_reps, r.valid_reps from set_metrics m join sets s on s.id = m.set_id join battle_results r on r.battle_id = s.battle_id and r.user_id = s.user_id where s.client_set_id = 'p3-g2'; select counted_reps, full_reps, good_reps from set_metrics m join sets s on s.id = m.set_id where s.client_set_id = 'p3-h';`],
  ['p3: all invitees declined but a link is open -> stays pending', `${as(F)} ${create('b3', { format: 'max_reps', inviteLink: true }, [G], 't3')} reset role; ${as(G)} update battle_participants set status='declined' where battle_id=${ctx('b3')}::uuid and user_id='${G}'; reset role; select status from battles where id=${ctx('b3')}::uuid;`],
  ['p3: creator cancels -> invitees notified', `${as(F)} select cancel_battle(${ctx('b3')}::uuid); reset role; select status from battles where id=${ctx('b3')}::uuid; set role anon; select invite_preview(${ctx('t3')})->>'status' s; reset role;`],
  ['p3: reminders 2 h before the deadline, once', `insert into battles(id,created_by,mode,format,metric,invite_expires_at,ends_at,created_at) values ('99999999-9999-4999-8999-999999999999','${F}','async','max_reps','rep_count',now()+interval '1 hour',now()+interval '1 hour',now()-interval '23 hours'); insert into battle_participants(battle_id,user_id,invited_by) values ('99999999-9999-4999-8999-999999999999','${G}','${F}'); select finalize_battles(); select finalize_battles(); select count(*) from private.notification_outbox where kind='battle_reminder' and battle_id='99999999-9999-4999-8999-999999999999';`],
  ['p3: blocking declines open invites between the two', `${as(F)} ${create('b5', { format: 'max_reps' }, [G])} reset role; ${as(G)} select block_user('${F}'); reset role; select status from battle_participants where battle_id=${ctx('b5')}::uuid and user_id='${G}'; select status from battles where id=${ctx('b5')}::uuid; ${as(F)} select count(*) from my_friends() where username='gina'; reset role;`],
  ['p3: settings: async battle defaults readable by anon', `set role anon; select value->>'deadline_hours' h, value->'timed_durations_s' t from app_settings where key='async_battle_defaults'; select value->>'reminder_hours_before' r from app_settings where key='notifications'; reset role;`],
  ['p3: users cannot register the notify url (expect ERR)', `${as(F)} select register_notify_url('https://evil.example/x'); reset role;`],
  ['p3: service role registers the notify url', `set role service_role; select register_notify_url('https://example.supabase.co/functions/v1/notify'); reset role; select value from private.server_config where key='notify_url';`],
);
Object.assign(checks, {
  'p3: F requests G by username (any case)': (r) => ok(r[0][0].r === 'pending' && r[1][0].again === 'pending' && r[2][0].n === 1, 'request ' + JSON.stringify(r)),
  'p3: G requesting back accepts': (r) => ok(r[0][0].r === 'accepted' && r[1][0].n === 1, 'auto-accept'),
  'p3: my_friends + search_users': (r) => {
    ok(r[0].length === 1 && r[0][0].username === 'gina' && r[0][0].relation === 'friend', 'my_friends ' + JSON.stringify(r[0]));
    ok(r[1].length === 1 && r[1][0].relation === 'friend', 'search gi');
    ok(r[2][0].count === 0, 'short query');
    ok(r[3].length === 1 && r[3][0].username === 'hank' && r[3][0].relation === 'none', 'search ha');
    ok(r[4][0].count === 0, 'wildcards escaped');
  },
  'p3: H blocks F: F cannot find H or see the block': (r) => (r = r.slice(-3), ok(r[0][0].count === 0 && r[1][0].count === 0 && r[2][0].relation === 'blocked', 'block ' + JSON.stringify(r))),
  'p3: only the blocker can unblock': (r) => (r = r.filter((x) => x[0] && 'count' in x[0]), ok(r[0][0].count === 1 && r[1][0].count === 0, 'unblock ' + JSON.stringify(r))),
  'p3: F creates a max-reps battle with G + an invite link': (r) => {
    const b = r[0][0];
    ok(b.status === 'pending' && b.max_participants === 8 && b.attempts_allowed === 1 && b.deadline_ok && b.parts === 2, 'battle ' + JSON.stringify(b));
    ok(r[1][0].n === 1, 'invite push');
  },
  'p3: anon previews the invite link': (r) => {
    const p = r[0][0].p;
    ok(p.status === 'ok' && p.creator.username === 'fred' && p.battle.format === 'max_reps' && p.scores.length === 0, 'preview ' + JSON.stringify(p));
    ok(r[1][0].p.status === 'not_found', 'unknown token');
  },
  'p3: F plays first while pending': (r) => ok(r[r.length - 1][0].n === 1, 'set push to invitee'),
  'p3: claim_notifications returns facts once': (r) => {
    const rows = r[0];
    const kinds = rows.map((x) => x.kind).sort().join(',');
    ok(kinds === 'battle_invite,friend_accepted,friend_request,set_submitted', 'kinds ' + kinds);
    const inv = rows.find((x) => x.kind === 'battle_invite');
    ok(inv.user_id === G && inv.facts.actor.username === 'fred' && inv.facts.leader.validReps === 20 && inv.facts.timeZone === 'America/New_York', 'invite facts ' + JSON.stringify(inv.facts));
    const sub = rows.find((x) => x.kind === 'set_submitted');
    ok(sub.facts.actorScore.validReps === 20 && sub.facts.battle.format === 'max_reps' && sub.facts.battle.mySetDone === false, 'set facts ' + JSON.stringify(sub.facts));
    ok(r[1][0].count === 0, 'claimed twice');
  },
  'p3: G accepts -> active; creator notified': (r) => ok(r[0][0].status === 'active' && r[1][0].n === 1, 'accept'),
  'p3: G plays; battle stays open while the link is usable': (r) => ok(r[r.length - 1][0].status === 'active', 'finished too early'),
  'p3: H redeems the link (becomes F friend), idempotent': (r) => {
    ok(r[0][0].same && r[1][0].again, 'redeem id');
    ok(r[2][0].status === 'accepted' && r[2][0].via_link && r[2][0].invited_by === F, 'participant ' + JSON.stringify(r[2]));
    ok(r[3][0].status === 'accepted', 'friendship');
    ok(r[4][0].n === 2, 'creator pushes');
  },
  'p3: F revokes the link': (r) => ok(r[r.length - 1][0].s === 'revoked', 'revoked'),
  'p3: H plays -> everyone done -> completed and locked': (r) => {
    const n = r.length;
    ok(r[n - 3][0].status === 'completed', 'status ' + JSON.stringify(r));
    const res = r[n - 2];
    ok(res.length === 3 && res[0].u === H && res[0].is_winner && res[0].valid_reps === 25 && res[2].u === G, 'results ' + JSON.stringify(res));
    ok(r[n - 1][0].n === 3, 'result pushes');
  },
  'p3: result facts': (r) => {
    const byUser = Object.fromEntries(r[0].map((x) => [x.user_id, x.facts.result]));
    ok(byUser[H].isWinner && byUser[H].rank === 1 && byUser[H].players === 3 && !byUser[H].draw, 'winner ' + JSON.stringify(byUser[H]));
    ok(byUser[G].rank === 3 && byUser[G].top.length === 2 && byUser[G].top[0].username === 'hank', 'loser ' + JSON.stringify(byUser[G]));
  },
  'p3: my_battles detail for G': (r) => {
    const b = r[0][0].b[0];
    ok(b.locked === true && b.status === 'completed' && b.participants.length === 3, 'detail ' + JSON.stringify(b));
    const me = b.participants.find((p) => p.isMe);
    ok(me.username === 'gina' && me.rank === 3 && me.validReps === 15 && me.attemptsUsed === 1, 'me ' + JSON.stringify(me));
    ok(b.inviteLinks.length === 0, 'links hidden from non-creator');
    ok(r[1][0].n >= 1, 'list');
  },
  'p3: C does not see the battle': (r) => ok(r[0][0].b.length === 0, 'RLS leak'),
  'p3: friend_battle_record (results only)': (r) => {
    const x = r[0][0].r;
    ok(x.played === 1 && x.lost === 1 && x.won === 0 && x.recent.length === 1 && x.recent[0].me.rank === 2 && x.recent[0].them.rank === 3, 'record ' + JSON.stringify(x));
  },
  'p3: battle waits for open in-app invites': (r) => {
    const n = r.length;
    ok(r[n - 4][0].status === 'active', 'finished while H still invited ' + JSON.stringify(r));
    ok(r[n - 2][0].status === 'completed', 'not completed after decline');
    ok(r[n - 1][0].n === 1, 'decline push');
  },
  'p3: battles count Full AND Good reps, never Shallow (= set_metrics.counted_reps)': (r) => {
    const x = r[0][0];
    ok(x.full_reps === 4 && x.good_reps === 4 && x.shallow_reps === 4 && x.implausible_reps === 0, 'buckets ' + JSON.stringify(x));
    ok(x.counted_reps === 8 && x.valid_reps === 8, 'battle must count full + good ' + JSON.stringify(x));
    const y = r[1][0];
    ok(y.full_reps === 25 && y.good_reps === 0 && y.counted_reps === 25, 'all-full set ' + JSON.stringify(y));
  },
  'p3: all invitees declined but a link is open -> stays pending': (r) => ok(r[0][0].status === 'pending', 'cancelled despite link'),
  'p3: creator cancels -> invitees notified': (r) => (r = r.slice(-2), ok(r[0][0].status === 'cancelled' && r[1][0].s === 'closed', 'cancel ' + JSON.stringify(r))),
  'p3: reminders 2 h before the deadline, once': (r) => ok(r[r.length - 1][0].count === 2, 'reminders ' + JSON.stringify(r[r.length - 1])),
  'p3: blocking declines open invites between the two': (r) => (r = r.slice(-3), ok(r[0][0].status === 'declined' && r[1][0].status === 'cancelled' && r[2][0].count === 0, 'block ' + JSON.stringify(r))),
  'p3: settings: async battle defaults readable by anon': (r) => ok(r[0][0].h === '24' && JSON.stringify(r[0][0].t) === '[60,120]' && r[1][0].r === '2', 'settings'),
  'p3: service role registers the notify url': (r) => ok(r[r.length - 1][0].value === 'https://example.supabase.co/functions/v1/notify', 'url'),
});
