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
 ['A tries battle set directly (expect ERR)', `${as(A)} select submit_set(${q({...rec('x',3,1500,[0.15]),challengeId:'00000000-0000-4000-8000-000000000000'})}); reset role;`],
 ['A friend-requests B; B accepts', `${as(A)} select send_friend_request('bob'); reset role; ${as(B)} select respond_friend_request('${A}', true); reset role;`],
 ['A cannot self-accept own request to C (expect ERR)', `${as(A)} insert into friendships(user_low,user_high,requested_by) values ('${A}','${C}','${A}'); update friendships set status='accepted' where user_high='${C}'; reset role;`],
 ['A creates async max_reps battle (id fixed)', `${as(A)} insert into challenges(id,created_by,mode,kind,metric,invite_expires_at,ends_at) values ('11111111-1111-4111-8111-111111111111','${A}','async','best_set','rep_count',now()+interval '1 day',now()+interval '1 day'); select status, (select count(*) from challenge_participants) from challenges; reset role;`],
 ['A invites C (not friend, expect ERR)', `${as(A)} insert into challenge_participants(challenge_id,user_id,invited_by) values ('11111111-1111-4111-8111-111111111111','${C}','${A}'); reset role;`],
 ['A invites B', `${as(A)} insert into challenge_participants(challenge_id,user_id,invited_by) values ('11111111-1111-4111-8111-111111111111','${B}','${A}'); reset role;`],
 ['C cannot see battle', `${as(C)} select count(*) from challenges; reset role;`],
 ['creator A submits attempt while pending (service role path)', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-a',20,1400,[0.14,0.15]),challengeId:'11111111-1111-4111-8111-111111111111',userId:A})}) is not null; reset role;`],
 ['A second attempt (expect ERR no attempts left)', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-a2',25,1400,[0.14]),challengeId:'11111111-1111-4111-8111-111111111111',userId:A})}); reset role;`],
 ['B cannot change invited_by (expect ERR)', `${as(B)} update challenge_participants set invited_by='${B}' where user_id='${B}'; reset role;`],
 ['B accepts -> battle active', `${as(B)} update challenge_participants set status='accepted' where user_id='${B}'; select status from challenges; reset role;`],
 ['B sees A battle set + reps', `${as(B)} select count(*) from sets; select count(*) from reps; reset role;`],
 ['B submits with bad trace & some shallow reps', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-b',22,1300,[0.14,0.30],{badTrace:false}),challengeId:'11111111-1111-4111-8111-111111111111',userId:B})}) is not null; reset role;`],
 ['rep_metrics quality spread for B', `${as(B)} select quality, count(*), min(implausible_reason) from rep_metrics where user_id='${B}' group by 1 order by 1; reset role;`],
 ['standings (provisional)', `${as(A)} select user_id=('${A}')::uuid as is_a, valid_reps, metric_value, rank, is_winner, attempts_used from challenge_standings order by rank; reset role;`],
 ['finalize -> completed', `select finalize_challenges(); select status from challenges;`],
 ['standings final', `${as(B)} select user_id=('${A}')::uuid as is_a, valid_reps, metric_value, rank, is_winner from challenge_standings order by rank; reset role;`],
 ['user_stats A', `${as(A)} select (select count(*) from sets where user_id='${A}') as total_sets, (select count(*) from challenge_standings where user_id='${A}' and challenge_status='completed' and is_winner) as challenges_won; reset role;`],
 ['realtime: B can join battle channel, C cannot', `${as(B)} select set_config('realtime.topic','battle:11111111-1111-4111-8111-111111111111',false); select private.can_join_challenge_channel(realtime.topic()); reset role; ${as(C)} select private.can_join_challenge_channel('battle:11111111-1111-4111-8111-111111111111'), private.can_join_challenge_channel('garbage'); reset role;`],
 ['live battle: create, accept, ready x2 -> starts_at set', `${as(A)} insert into challenges(id,created_by,mode,kind,metric,duration_s,invite_expires_at) values ('22222222-2222-4222-8222-222222222222','${A}','live','best_set','rep_count',60,now()+interval '10 minutes'); insert into challenge_participants(challenge_id,user_id,invited_by) values ('22222222-2222-4222-8222-222222222222','${B}','${A}'); reset role; ${as(B)} update challenge_participants set status='accepted', responded_at=now() where challenge_id='22222222-2222-4222-8222-222222222222' and user_id='${B}'; update challenge_participants set ready_at=now() where challenge_id='22222222-2222-4222-8222-222222222222' and user_id='${B}'; reset role; ${as(A)} update challenge_participants set ready_at=now() where challenge_id='22222222-2222-4222-8222-222222222222' and user_id='${A}'; select status, starts_at is not null from challenges where id='22222222-2222-4222-8222-222222222222'; reset role;`],
 ['live: ready after start (expect ERR)', `${as(A)} update challenge_participants set ready_at=null where challenge_id='22222222-2222-4222-8222-222222222222' and user_id='${A}'; reset role;`],
 ['live timed: B set started on time is valid; timed window caps reps', `update challenges set starts_at = now() - interval '61 seconds' where id='22222222-2222-4222-8222-222222222222'; select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('live-b',40,1600,[0.14,0.15],{start:Date.now()-61000}),challengeId:'22222222-2222-4222-8222-222222222222',userId:B})}) is not null; reset role; ${as(B)} select valid_reps, metric_value from challenge_standings where challenge_id='22222222-2222-4222-8222-222222222222' and user_id='${B}'; reset role;`],
 ['A finally submits async attempt -> finalize completes', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-a',15,1400,[0.14]),challengeId:'11111111-1111-4111-8111-111111111111',userId:A})}) is not null; reset role; select finalize_challenges(); select status from challenges where id='11111111-1111-4111-8111-111111111111';`],
 ['A second attempt (expect ERR no attempts left)', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('b1-a2',25,1400,[0.14]),challengeId:'11111111-1111-4111-8111-111111111111',userId:A})}); reset role;`],
 ['final standings + stats', `${as(A)} select user_id=('${A}')::uuid as is_a, valid_reps, rank, is_winner from challenge_standings where challenge_id='11111111-1111-4111-8111-111111111111' order by rank; select count(*) filter (where challenge_status='completed') as challenges_played, count(*) filter (where is_winner) as challenges_won, count(*) filter (where challenge_status='completed' and not is_winner and not (rank = 1 and metric_value is not null)) as challenges_lost from challenge_standings where user_id='${B}'; reset role;`],
 ['check constraint: live multi_day as superuser (expect ERR)', `insert into challenges(created_by,mode,kind,invite_expires_at,ends_at) values ('${A}','live','total',now()+interval '1 hour',now()+interval '7 days');`],
 ['bad-trace cheat: reps not in trace flagged', `select set_config('request.jwt.claim.sub','',false); insert into challenges(id,created_by,mode,kind,metric,invite_expires_at,ends_at) values ('33333333-3333-4333-8333-333333333333','${A}','async','best_set','rep_count',now()+interval '1 day',now()+interval '1 day'); set role service_role; select public.submit_set(${q({...rec('cheat',30,700,[0.14],{badTrace:true}),challengeId:'33333333-3333-4333-8333-333333333333',userId:A})}) is not null; reset role; select implausible_reason, count(*) from rep_metrics rm join sets s on s.id=rm.set_id where s.client_set_id='cheat' group by 1;`],

 ['quality rule: min_quality shallow rejected (expect ERR)', `insert into challenges(created_by,mode,kind,min_quality,invite_expires_at,ends_at) values ('${A}','async','best_set','shallow',now()+interval '1 hour',now()+interval '1 day');`],
 ['timed must rank by rep_count (expect ERR)', `insert into challenges(created_by,mode,kind,metric,duration_s,invite_expires_at,ends_at) values ('${A}','async','best_set','form_score',60,now()+interval '1 hour',now()+interval '1 day');`],
 ['tempo_score is speed-independent', `select tempo_score(10, 1000, 0) fast_steady, tempo_score(10, 3000, 0) slow_steady, tempo_score(10, 1000, 300) jittery, tempo_score(1, 1000, 0) too_few;`],
 ['async timed: equal good reps, tempo consistency breaks tie', `select set_config('request.jwt.claim.sub','',false); insert into challenges(id,created_by,mode,kind,metric,duration_s,invite_expires_at,ends_at) values ('44444444-4444-4444-8444-444444444444','${A}','async','best_set','rep_count',60,now()+interval '1 day',now()+interval '1 day'); insert into challenge_participants(challenge_id,user_id,invited_by,status) values ('44444444-4444-4444-8444-444444444444','${B}','${A}','invited'); update challenge_participants set status='accepted', responded_at=now() where challenge_id='44444444-4444-4444-8444-444444444444' and user_id='${B}'; set role service_role; select public.submit_set(${q({...rec('tt-a',20,1500,[0.14],{jitter:0.3}),challengeId:'44444444-4444-4444-8444-444444444444',userId:A})}) is not null; select public.submit_set(${q({...rec('tt-b',20,2500,[0.14]),challengeId:'44444444-4444-4444-8444-444444444444',userId:B})}) is not null; reset role; select user_id=('${A}')::uuid is_a, valid_reps, tempo_score, rank, locked from challenge_standings where challenge_id='44444444-4444-4444-8444-444444444444' order by rank;`],
 ['finalize locks timed result', `select finalize_challenges(); select user_id=('${A}')::uuid is_a, valid_reps, tempo_score, rank, is_winner, locked from challenge_standings where challenge_id='44444444-4444-4444-8444-444444444444' order by rank; select count(*) from challenge_results where challenge_id='44444444-4444-4444-8444-444444444444';`],
 ['post-lock moderation flag: live calc changes, locked result does not', `insert into set_flags(set_id, flagged_by, reason, excludes) select id, '${A}', 'test', true from sets where client_set_id='tt-b'; select (select valid_reps from challenge_standings_live where challenge_id='44444444-4444-4444-8444-444444444444' and user_id='${B}') live_b, (select valid_reps from challenge_standings where challenge_id='44444444-4444-4444-8444-444444444444' and user_id='${B}') locked_b, (select is_winner from challenge_standings where challenge_id='44444444-4444-4444-8444-444444444444' and user_id='${B}') still_winner;`],
 ['service role cannot update locked result (expect ERR)', `set role service_role; update challenge_results set is_winner = not is_winner where challenge_id='44444444-4444-4444-8444-444444444444'; reset role;`],
 ['user cannot insert into challenge_results (expect ERR)', `${as(A)} insert into challenge_results(challenge_id,user_id,participant_status,valid_reps,rank,is_winner,metric,scoring_version,attempts_used) values ('44444444-4444-4444-8444-444444444444','${A}','accepted',99,1,true,'rep_count',1,1); reset role;`],
 ['B sees locked result; C does not', `${as(B)} select count(*) from challenge_standings where challenge_id='44444444-4444-4444-8444-444444444444'; reset role; ${as(C)} select count(*) from challenge_standings where challenge_id='44444444-4444-4444-8444-444444444444'; select count(*) from challenge_results; reset role;`],
 ['draw: identical sets -> no winner, stats count draw', `select set_config('request.jwt.claim.sub','',false); insert into challenges(id,created_by,mode,kind,metric,invite_expires_at,ends_at) values ('55555555-5555-4555-8555-555555555555','${A}','async','best_set','rep_count',now()+interval '1 day',now()+interval '1 day'); insert into challenge_participants(challenge_id,user_id,invited_by) values ('55555555-5555-4555-8555-555555555555','${B}','${A}'); update challenge_participants set status='accepted', responded_at=now() where challenge_id='55555555-5555-4555-8555-555555555555' and user_id='${B}'; set role service_role; select public.submit_set(${q({...rec('dd-a',10,1500,[0.14]),challengeId:'55555555-5555-4555-8555-555555555555',userId:A})}) is not null; select public.submit_set(${q({...rec('dd-b',10,1500,[0.14]),challengeId:'55555555-5555-4555-8555-555555555555',userId:B})}) is not null; reset role; select finalize_challenges(); select rank, is_winner from challenge_standings where challenge_id='55555555-5555-4555-8555-555555555555'; ${as(A)} select count(*) filter (where challenge_status='completed') as challenges_played, count(*) filter (where is_winner) as challenges_won, count(*) filter (where challenge_status='completed' and not is_winner and rank = 1 and metric_value is not null) as challenges_drawn, count(*) filter (where challenge_status='completed' and not is_winner and not (rank = 1 and metric_value is not null)) as challenges_lost from challenge_standings where user_id='${A}'; reset role;`],
 ['shallow reps never count (B async set had 11 shallow of 22)', `select valid_reps from challenge_standings where challenge_id='11111111-1111-4111-8111-111111111111' and user_id='${B}';`],
 ['settings: anon can read app settings', `set role anon; select value from app_settings where key='async_max_participants'; reset role;`],
 ['settings: battle copies form weights at creation; later change does not alter it', `select set_config('request.jwt.claim.sub','',false); update app_settings set value='{"depth":0.6,"consistency":0.2,"tempo":0.2}' where key='form_score_weights'; insert into challenges(id,created_by,mode,kind,metric,invite_expires_at,ends_at) values ('66666666-6666-4666-8666-666666666666','${A}','async','best_set','form_score',now()+interval '1 day',now()+interval '1 day'); update app_settings set value='{"depth":0.5,"consistency":0.3,"tempo":0.2}' where key='form_score_weights'; select form_weights->>'depth' as depth from challenges where id='66666666-6666-4666-8666-666666666666';`],
 ['settings: form score uses the battle weights', `select battle_metric_value('form_score',1::smallint,5::smallint,10,80,0,9,1000,0,'{"depth":0.6,"consistency":0.2,"tempo":0.2}') w602020, battle_metric_value('form_score',1::smallint,5::smallint,10,80,0,9,1000,0,'{"depth":0.5,"consistency":0.3,"tempo":0.2}') w503020;`],
 ['settings: async battle over the participant cap (expect ERR)', `insert into challenges(created_by,mode,kind,max_participants,invite_expires_at,ends_at) values ('${A}','async','best_set',9,now()+interval '1 hour',now()+interval '1 day');`],
 ['settings: live battle cap comes from settings', `insert into challenges(id,created_by,mode,kind,max_participants,invite_expires_at) values ('77777777-7777-4777-8777-777777777777','${A}','live','best_set',5,now()+interval '10 minutes'); select max_participants from challenges where id='77777777-7777-4777-8777-777777777777';`],
 ['settings: users cannot change settings (expect ERR)', `${as(A)} update app_settings set value='99' where key='async_max_participants'; reset role;`],
 ['invalid enum combo: live multi_day (expect ERR)', `${as(A)} insert into challenges(created_by,mode,kind,invite_expires_at,starts_at,ends_at) values ('${A}','live','total',now()+interval '1 hour',now(),now()+interval '7 days'); reset role;`],
 ['B deletes own battle set (expect 0 rows)', `${as(B)} with d as (delete from sets where user_id='${B}' and challenge_id is not null returning 1) select count(*) from d; reset role;`],
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
  'user_stats A': (r) => ok(r[0][0].challenges_won === 1 && r[0][0].total_sets === 2, 'bad stats'),
  'realtime: B can join battle channel, C cannot': (r) => ok(r[0][0].can_join_challenge_channel === true && r[1][0].can_join_challenge_channel === false, 'realtime auth'),
  'live battle: create, accept, ready x2 -> starts_at set': (r) => ok(r[0][0].status === 'active' && r[0][0]['?column?'] === true, 'live start'),
  'live timed: B set started on time is valid; timed window caps reps': (r) => ok(r[1][0].valid_reps === 37, 'timed cap ' + JSON.stringify(r[1])),
  'bad-trace cheat: reps not in trace flagged': (r) => ok(r[1][0].implausible_reason === 'not_in_trace' && r[1][0].count === 30, 'cheat not flagged'),
  'tempo_score is speed-independent': (r) => ok(r[0][0].fast_steady === r[0][0].slow_steady && Number(r[0][0].jittery) === 70 && r[0][0].too_few === null, 'tempo'),
  'async timed: equal good reps, tempo consistency breaks tie': (r) => ok(r[2][0].is_a === false && r[2][0].valid_reps === r[2][1].valid_reps && r[2][0].rank === 1 && r[2][1].rank === 2, 'tempo tiebreak'),
  'finalize locks timed result': (r) => ok(r[1][0].locked === true && r[1][0].is_winner === true && r[2][0].count === 2, 'lock'),
  'post-lock moderation flag: live calc changes, locked result does not': (r) => ok(r[0][0].live_b === 0 && r[0][0].locked_b === 20 && r[0][0].still_winner === true, 'lock changed'),
  'B sees locked result; C does not': (r) => ok(r[0][0].count === 2 && r[1][0].count === 0 && r[2][0].count === 0, 'results RLS'),
  'draw: identical sets -> no winner, stats count draw': (r) => ok(r[3].every((x) => x.rank === 1 && x.is_winner === false) && r[4][0].challenges_drawn === 1, 'draw'),
  'shallow reps never count (B async set had 11 shallow of 22)': (r) => ok(r[0][0].valid_reps === 11, 'shallow counted'),
  'settings: anon can read app settings': (r) => ok(r[0][0].value === 8, 'settings read'),
  'settings: battle copies form weights at creation; later change does not alter it': (r) => ok(r[0][0].depth === '0.6', 'weights not copied'),
  'settings: form score uses the battle weights': (r) => ok(Number(r[0][0].w602020) === 88 && Number(r[0][0].w503020) === 90, 'weights ' + JSON.stringify(r[0])),
  'settings: live battle cap comes from settings': (r) => ok(r[0][0].max_participants === 2, 'live cap'),
  'B deletes own battle set (expect 0 rows)': (r) => ok(r[0][0].count === 0, 'deleted battle set'),
};
steps.push(
  ['hardening: users cannot call finalize_challenges (expect ERR)', `${as(A)} select public.finalize_challenges(); reset role;`],
  ['hardening: helpers are not in the public schema', `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('are_friends','is_challenge_member','can_join_challenge_channel');`],
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
  ['identity: D creates a battle with E; E deletes account', `${as(D)} select send_friend_request('erin'); reset role; ${as(E)} select respond_friend_request('${D}', true); select submit_set(${q(rec('e-solo',4,1500,[0.15]))}); insert into challenges(id,created_by,mode,kind,metric,invite_expires_at,ends_at) values ('7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e','${E}','async','best_set','rep_count',now()+interval '1 day',now()+interval '1 day'); insert into challenge_participants(challenge_id,user_id,invited_by) values ('7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e','${D}','${E}'); reset role; ${as(D)} update challenge_participants set status='accepted' where challenge_id='7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e' and user_id='${D}'; reset role; select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q({...rec('del-e',10,1500,[0.14]),challengeId:'7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e',userId:E})}) is not null; select public.submit_set(${q({...rec('del-d',12,1500,[0.14]),challengeId:'7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e',userId:D})}) is not null; reset role; select finalize_challenges(); ${as(E)} select delete_my_account(); reset role; select (select count(*) from auth.users where id='${E}') users, (select count(*) from profiles where id='${E}') profiles, (select count(*) from devices where user_id='${E}') devices, (select count(*) from push_tokens) tokens, (select count(*) from friendships where '${E}' in (user_low,user_high)) friends, (select count(*) from challenge_participants where user_id='${E}') parts, (select count(*) from sets where user_id='${E}') e_sets, (select count(*) from challenges where id='7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e' and created_by is null) orphan_challenges, (select count(*) from challenge_results where challenge_id='7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e') results, (select count(*) from challenge_participants where challenge_id='7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e' and invited_by is null) uninvited;`],
  ['identity: delete_my_account requires sign-in (expect ERR)', `set role authenticated; select set_config('request.jwt.claim.sub','',false); select delete_my_account(); reset role;`],
  ['identity: anon cannot delete accounts (expect ERR)', `set role anon; select delete_my_account(); reset role;`],
  ['identity: D account and sets untouched', `select count(*) from sets where user_id='${D}';`],
  ['identity: users still cannot null invited_by directly (expect ERR)', `${as(B)} update challenge_participants set invited_by=null where user_id='${B}' and invited_by is not null; reset role;`],
  ['identity: results still locked for direct updates (expect ERR)', `set role service_role; update challenge_results set best_set_id=null where best_set_id is not null; reset role;`],
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
    ok(x.users === 0 && x.profiles === 0 && x.devices === 0 && x.tokens === 0 && x.friends === 0 && x.parts === 0 && x.e_sets === 0 && x.orphan_challenges === 1 && x.results === 1 && x.uninvited === 1, 'delete ' + JSON.stringify(x));
  },
  'identity: D account and sets untouched': (r) => ok(r[0][0].count === 3, 'D sets'),
});

// ---- Phase 3: friends, async challenges, invite links, notifications ----
const F='f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', G='a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', H='b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
// Generated ids (challenges, tokens) are kept in a scratch table between steps.
const ctx = (k) => `(select v from test_ctx where k='${k}')`;
const battleSet = (id, n, k, user, bottoms = [0.14]) =>
  `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q(rec(id, n, 1400, bottoms))} || jsonb_build_object('challengeId', ${ctx(k)}, 'userId', '${user}')) is not null; reset role;`;
const outbox = (kind, user, k) => `(select count(*) from private.notification_outbox where kind='${kind}' and user_id='${user}'${k ? ` and challenge_id=${ctx(k)}::uuid` : ''})`;
const create = (k, body, ids, tk) =>
  `with c as (select create_challenge(${q(body)} || jsonb_build_object('friendIds', jsonb_build_array(${ids.map((i) => `'${i}'`).join(',')}))) r) insert into test_ctx select '${k}', r->>'challengeId' from c${tk ? ` union all select '${tk}', r->>'inviteToken' from c` : ''} on conflict (k) do update set v = excluded.v;`;

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
  ['p3: friend_challenge_record needs friendship (expect ERR)', `${as(F)} select friend_challenge_record('${H}'); reset role;`],
  ['p3: create_challenge rejects live (expect ERR)', `${as(F)} select create_challenge(${q({ mode: 'live', kind: 'best_set', friendIds: [G] })}); reset role;`],
  ['p3: create_challenge rejects non-friends (expect ERR)', `${as(F)} select create_challenge(${q({ kind: 'best_set', friendIds: [H] })}); reset role;`],
  ['p3: create_challenge rejects a 45 s timed battle (expect ERR)', `${as(F)} select create_challenge(${q({ kind: 'best_set', durationS: 45, friendIds: [G] })}); reset role;`],
  ['p3: create_challenge rejects a deadline past the max (expect ERR)', `${as(F)} select create_challenge(${q({ kind: 'best_set', deadlineHours: 500, friendIds: [G] })}); reset role;`],
  ['p3: create_challenge needs someone to invite (expect ERR)', `${as(F)} select create_challenge(${q({ kind: 'best_set' })}); reset role;`],
  ['p3: F creates a max-reps battle with G + an invite link', `${as(F)} ${create('b1', { kind: 'best_set', inviteLink: true }, [G], 't1')} reset role; select status, max_participants, attempts_allowed, ends_at >= invite_expires_at and ends_at <= now() + interval '24 hours' deadline_ok, (select count(*) from challenge_participants p where p.challenge_id = b.id) parts from challenges b where id = ${ctx('b1')}::uuid; select ${outbox('challenge_invite', G, 'b1')} n;`],
  ['p3: anon previews the invite link', `set role anon; select invite_preview(${ctx('t1')}) p; select invite_preview('00000000000000000000000000000000') p; reset role;`],
  ['p3: anon cannot redeem (expect ERR)', `set role anon; select redeem_invite(${ctx('t1')}); reset role;`],
  ['p3: F plays first while pending', `${battleSet('p3-f', 20, 'b1', F)} select ${outbox('set_submitted', G, 'b1')} n;`],
  ['p3: users cannot claim notifications (expect ERR)', `${as(F)} select * from claim_notifications(10); reset role;`],
  ['p3: users cannot read the outbox (expect ERR)', `${as(F)} select count(*) from private.notification_outbox; reset role;`],
  ['p3: claim_notifications returns facts once', `set role service_role; select kind, user_id::text, facts from claim_notifications(100) order by id; select count(*) from claim_notifications(100); reset role;`],
  ['p3: G accepts -> active; creator notified', `${as(G)} update challenge_participants set status='accepted' where challenge_id=${ctx('b1')}::uuid and user_id='${G}'; reset role; select status from challenges where id=${ctx('b1')}::uuid; select ${outbox('invite_accepted', F, 'b1')} n;`],
  ['p3: G plays; battle stays open while the link is usable', `${battleSet('p3-g', 15, 'b1', G)} select finalize_challenges(); select status from challenges where id=${ctx('b1')}::uuid;`],
  ['p3: H redeems the link (becomes F friend), idempotent', `${as(H)} select redeem_invite(${ctx('t1')})::text = ${ctx('b1')} same; select redeem_invite(${ctx('t1')})::text = ${ctx('b1')} again; reset role; select status, invite_link_token is not null via_link, invited_by::text from challenge_participants where challenge_id=${ctx('b1')}::uuid and user_id='${H}'; select status from friendships where user_low=least('${F}'::uuid,'${H}'::uuid) and user_high=greatest('${F}'::uuid,'${H}'::uuid); select ${outbox('invite_accepted', F, 'b1')} n;`],
  ['p3: F revokes the link', `${as(F)} select revoke_invite_link(${ctx('t1')}); reset role; set role anon; select invite_preview(${ctx('t1')})->>'status' s; reset role;`],
  ['p3: C cannot redeem a revoked link (expect ERR)', `${as(C)} select redeem_invite(${ctx('t1')}); reset role;`],
  ['p3: H plays -> everyone done -> completed and locked', `${battleSet('p3-h', 25, 'b1', H)} select finalize_challenges(); select status from challenges where id=${ctx('b1')}::uuid; select user_id::text u, rank, is_winner, valid_reps from challenge_results where challenge_id=${ctx('b1')}::uuid order by rank; select ${outbox('challenge_result', F, 'b1')} + ${outbox('challenge_result', G, 'b1')} + ${outbox('challenge_result', H, 'b1')} n;`],
  ['p3: result facts', `set role service_role; select kind, user_id::text, facts from claim_notifications(100) where kind='challenge_result' order by user_id; reset role;`],
  ['p3: my_challenges detail for G', `${as(G)} select my_challenges(${ctx('b1')}::uuid) b; select jsonb_array_length(my_challenges()) n; reset role;`],
  ['p3: C does not see the battle', `${as(C)} select my_challenges(${ctx('b1')}::uuid) b; reset role;`],
  ['p3: friend_challenge_record (results only)', `${as(F)} select friend_challenge_record('${G}') r; reset role;`],
  ['p3: battle waits for open in-app invites', `${as(F)} ${create('b2', { kind: 'best_set', durationS: 60 }, [G, H])} reset role; ${battleSet('p3-f2', 10, 'b2', F)} ${as(G)} update challenge_participants set status='accepted' where challenge_id=${ctx('b2')}::uuid and user_id='${G}'; reset role; ${battleSet('p3-g2', 12, 'b2', G, [0.14, 0.25, 0.30])} select finalize_challenges(); select status from challenges where id=${ctx('b2')}::uuid; ${as(H)} update challenge_participants set status='declined' where challenge_id=${ctx('b2')}::uuid and user_id='${H}'; reset role; select finalize_challenges(); select status from challenges where id=${ctx('b2')}::uuid; select ${outbox('invite_declined', F, 'b2')} n;`],
  ['p3: challenges count Full AND Good reps, never Shallow (= set_metrics.good_or_better_reps)', `select m.full_reps, m.good_reps, m.shallow_reps, m.implausible_reps, m.good_or_better_reps, r.valid_reps from set_metrics m join sets s on s.id = m.set_id join challenge_results r on r.challenge_id = s.challenge_id and r.user_id = s.user_id where s.client_set_id = 'p3-g2'; select good_or_better_reps, full_reps, good_reps from set_metrics m join sets s on s.id = m.set_id where s.client_set_id = 'p3-h';`],
  ['p3: all invitees declined but a link is open -> stays pending', `${as(F)} ${create('b3', { kind: 'best_set', inviteLink: true }, [G], 't3')} reset role; ${as(G)} update challenge_participants set status='declined' where challenge_id=${ctx('b3')}::uuid and user_id='${G}'; reset role; select status from challenges where id=${ctx('b3')}::uuid;`],
  ['p3: creator cancels -> invitees notified', `${as(F)} select cancel_challenge(${ctx('b3')}::uuid); reset role; select status from challenges where id=${ctx('b3')}::uuid; set role anon; select invite_preview(${ctx('t3')})->>'status' s; reset role;`],
  ['p3: reminders 2 h before the deadline, once', `insert into challenges(id,created_by,mode,kind,metric,invite_expires_at,ends_at,created_at) values ('99999999-9999-4999-8999-999999999999','${F}','async','best_set','rep_count',now()+interval '1 hour',now()+interval '1 hour',now()-interval '23 hours'); insert into challenge_participants(challenge_id,user_id,invited_by) values ('99999999-9999-4999-8999-999999999999','${G}','${F}'); select finalize_challenges(); select finalize_challenges(); select count(*) from private.notification_outbox where kind='challenge_reminder' and challenge_id='99999999-9999-4999-8999-999999999999';`],
  ['p3: blocking declines open invites between the two', `${as(F)} ${create('b5', { kind: 'best_set' }, [G])} reset role; ${as(G)} select block_user('${F}'); reset role; select status from challenge_participants where challenge_id=${ctx('b5')}::uuid and user_id='${G}'; select status from challenges where id=${ctx('b5')}::uuid; ${as(F)} select count(*) from my_friends() where username='gina'; reset role;`],
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
    ok(p.status === 'ok' && p.creator.username === 'fred' && p.challenge.kind === 'best_set' && p.scores.length === 0, 'preview ' + JSON.stringify(p));
    ok(r[1][0].p.status === 'not_found', 'unknown token');
  },
  'p3: F plays first while pending': (r) => ok(r[r.length - 1][0].n === 1, 'set push to invitee'),
  'p3: claim_notifications returns facts once': (r) => {
    const rows = r[0];
    const kinds = rows.map((x) => x.kind).sort().join(',');
    ok(kinds === 'challenge_invite,friend_accepted,friend_request,set_submitted', 'kinds ' + kinds);
    const inv = rows.find((x) => x.kind === 'challenge_invite');
    ok(inv.user_id === G && inv.facts.actor.username === 'fred' && inv.facts.leader.validReps === 20 && inv.facts.timeZone === 'America/New_York', 'invite facts ' + JSON.stringify(inv.facts));
    const sub = rows.find((x) => x.kind === 'set_submitted');
    ok(sub.facts.actorScore.validReps === 20 && sub.facts.challenge.kind === 'best_set' && sub.facts.challenge.mySetDone === false, 'set facts ' + JSON.stringify(sub.facts));
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
  'p3: my_challenges detail for G': (r) => {
    const b = r[0][0].b[0];
    ok(b.locked === true && b.status === 'completed' && b.participants.length === 3, 'detail ' + JSON.stringify(b));
    const me = b.participants.find((p) => p.isMe);
    ok(me.username === 'gina' && me.rank === 3 && me.validReps === 15 && me.attemptsUsed === 1, 'me ' + JSON.stringify(me));
    ok(b.inviteLinks.length === 0, 'links hidden from non-creator');
    ok(r[1][0].n >= 1, 'list');
  },
  'p3: C does not see the battle': (r) => ok(r[0][0].b.length === 0, 'RLS leak'),
  'p3: friend_challenge_record (results only)': (r) => {
    const x = r[0][0].r;
    ok(x.played === 1 && x.lost === 1 && x.won === 0 && x.recent.length === 1 && x.recent[0].me.rank === 2 && x.recent[0].them.rank === 3, 'record ' + JSON.stringify(x));
  },
  'p3: battle waits for open in-app invites': (r) => {
    const n = r.length;
    ok(r[n - 4][0].status === 'active', 'finished while H still invited ' + JSON.stringify(r));
    ok(r[n - 2][0].status === 'completed', 'not completed after decline');
    ok(r[n - 1][0].n === 1, 'decline push');
  },
  'p3: challenges count Full AND Good reps, never Shallow (= set_metrics.good_or_better_reps)': (r) => {
    const x = r[0][0];
    ok(x.full_reps === 4 && x.good_reps === 4 && x.shallow_reps === 4 && x.implausible_reps === 0, 'buckets ' + JSON.stringify(x));
    ok(x.good_or_better_reps === 8 && x.valid_reps === 8, 'battle must count full + good ' + JSON.stringify(x));
    const y = r[1][0];
    ok(y.full_reps === 25 && y.good_reps === 0 && y.good_or_better_reps === 25, 'all-full set ' + JSON.stringify(y));
  },
  'p3: all invitees declined but a link is open -> stays pending': (r) => ok(r[0][0].status === 'pending', 'cancelled despite link'),
  'p3: creator cancels -> invitees notified': (r) => (r = r.slice(-2), ok(r[0][0].status === 'cancelled' && r[1][0].s === 'closed', 'cancel ' + JSON.stringify(r))),
  'p3: reminders 2 h before the deadline, once': (r) => ok(r[r.length - 1][0].count === 2, 'reminders ' + JSON.stringify(r[r.length - 1])),
  'p3: blocking declines open invites between the two': (r) => (r = r.slice(-3), ok(r[0][0].status === 'declined' && r[1][0].status === 'cancelled' && r[2][0].count === 0, 'block ' + JSON.stringify(r))),
  'p3: settings: async battle defaults readable by anon': (r) => ok(r[0][0].h === '24' && JSON.stringify(r[0][0].t) === '[60,120]' && r[1][0].r === '2', 'settings'),
  'p3: service role registers the notify url': (r) => ok(r[r.length - 1][0].value === 'https://example.supabase.co/functions/v1/notify', 'url'),
});

// Finished-set claims: a recent solo set becomes the creator's attempt.
const link = (id, n, k, user, opts = {}) =>
  `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q(rec(id, n, opts.period ?? 1500, opts.bottoms ?? [0.15], opts))} || jsonb_build_object('challengeId', ${ctx(k)}, 'userId', '${user}', 'linkFinishedSet', true)) is not null; reset role;`;
const solo = (id, n, user, opts = {}) =>
  `${as(user)} select public.submit_set(${q(rec(id, n, opts.period ?? 1500, opts.bottoms ?? [0.15], opts))}) is not null; reset role;`;

steps.push(
  ['claim: defaults include the recency window and multi-day options', `select value->>'claim_set_max_age_s' age, value->>'multi_day_window_days' w, value->>'deadline_hours' h from app_settings where key='async_battle_defaults';`],
  ['claim: A uploads the set he just finished', solo('claim-solo', 10, A)],
  ['claim: A opens a max-reps battle', `${as(A)} ${create('cmax', { kind: 'best_set', deadlineHours: 24 }, [B])} reset role;`],
  ['claim: resubmitting without linkFinishedSet does not attach it (expect ERR)', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(${q(rec('claim-solo', 10, 1500, [0.15]))} || jsonb_build_object('challengeId', ${ctx('cmax')}, 'userId', '${A}')); reset role;`],
  ['claim: the set is still solo', `select challenge_id is null solo from sets where client_set_id='claim-solo';`],
  ['claim: linking it counts as A attempt and tells B', `${link('claim-solo', 10, 'cmax', A)} select (challenge_id::text = ${ctx('cmax')}) as linked from sets where client_set_id='claim-solo'; select valid_reps, attempts_used from challenge_standings where challenge_id=${ctx('cmax')}::uuid and user_id='${A}'; select count(*) n from private.notification_outbox where kind='set_submitted' and challenge_id=${ctx('cmax')}::uuid and user_id='${B}';`],
  ['claim: linking again is idempotent', `${link('claim-solo', 10, 'cmax', A)} select count(*) n from sets where client_set_id='claim-solo';`],
  ['claim: a second recent set is uploaded', solo('claim-extra', 4, A)],
  ['claim: a second set exceeds attempts_allowed (expect ERR)', link('claim-extra', 4, 'cmax', A)],
  ['claim: another max-reps battle', `${as(A)} ${create('cmax2', { kind: 'best_set', deadlineHours: 24 }, [B])} reset role;`],
  ['claim: cannot move a set into another battle (expect ERR)', link('claim-solo', 10, 'cmax2', A)],
  ['claim: an old set is uploaded', `${solo('claim-old', 6, A, { start: Date.now() - 3 * 3600 * 1000 })} ${as(A)} ${create('cold', { kind: 'best_set', deadlineHours: 24 }, [B])} reset role;`],
  ['claim: an old set is refused (expect ERR)', link('claim-old', 6, 'cold', A, { start: Date.now() - 3 * 3600 * 1000 })],
  ['claim: the old set stayed solo', `select challenge_id is null solo from sets where client_set_id='claim-old';`],
  ['claim: a raw update of an old set is refused too (expect ERR)', `set role service_role; update sets set challenge_id=${ctx('cold')}::uuid where client_set_id='claim-old'; reset role;`],
  ['claim: A cannot link through the table or the RPC (expect ERR)', `${as(A)} update sets set challenge_id=${ctx('cold')}::uuid where client_set_id='claim-old'; reset role;`],
  ['claim: untimed set and a timed battle', `${solo('claim-untimed', 8, A)} ${as(A)} ${create('ctimed', { kind: 'best_set', durationS: 60, deadlineHours: 24 }, [B])} reset role;`],
  ['claim: untimed set cannot fill a timed battle (expect ERR)', link('claim-untimed', 8, 'ctimed', A)],
  ['claim: a 60 s set becomes the attempt only for a 60 s battle', `${solo('claim-t60', 10, A, { period: 8000, extra: { timerDurationS: 60 } })} ${as(A)} ${create('ct60', { kind: 'best_set', durationS: 60, deadlineHours: 24 }, [B])} reset role; ${link('claim-t60', 10, 'ct60', A, { period: 8000, extra: { timerDurationS: 60 } })} select timer_duration_s, (challenge_id::text = ${ctx('ct60')}) as linked from sets where client_set_id='claim-t60'; select valid_reps from challenge_standings where challenge_id=${ctx('ct60')}::uuid and user_id='${A}';`],
  ['claim: a 60 s set and a 120 s battle', `${as(A)} ${create('ct120', { kind: 'best_set', durationS: 120, deadlineHours: 24 }, [B])} reset role; ${solo('claim-t60b', 4, A, { extra: { timerDurationS: 60 } })}`],
  ['claim: that 60 s set does not fit a 120 s battle (expect ERR)', link('claim-t60b', 4, 'ct120', A, { extra: { timerDurationS: 60 } })],
  ['claim: streak and team are rejected (expect ERR)', `${as(A)} select create_challenge(${q({ kind: 'streak', friendIds: [B] })}); reset role;`],
  ['claim: a total counts solo sets in the window and does not link them', `${as(A)} ${create('cmd', { kind: 'total', window: 'week' }, [B])} reset role; select kind::text kind, window_unit::text window_unit, attempts_allowed is null no_cap, metric is null no_metric, starts_at is not null started from challenges where id=${ctx('cmd')}::uuid; ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('cmd')}::uuid and user_id='${B}'; reset role; select coalesce(valid_reps,0) before_reps, coalesce(attempts_used,0) before_attempts from challenge_standings where challenge_id=${ctx('cmd')}::uuid and user_id='${A}'; ${solo('claim-md1', 10, A)} ${solo('claim-md2', 10, A)} select valid_reps, attempts_used, metric_value from challenge_standings where challenge_id=${ctx('cmd')}::uuid and user_id='${A}'; select challenge_id is null solo from sets where client_set_id='claim-md1'; ${as(B)} select count(*) n from sets where client_set_id='claim-md1'; reset role;`],
  ['claim: shallow reps still do not count', `${as(A)} ${create('cshallow', { kind: 'best_set', deadlineHours: 24 }, [B])} reset role; ${solo('claim-shallow', 4, A, { bottoms: [0.15, 0.30] })} ${link('claim-shallow', 4, 'cshallow', A, { bottoms: [0.15, 0.30] })} select valid_reps from challenge_standings where challenge_id=${ctx('cshallow')}::uuid and user_id='${A}';`],
  ['claim: a legacy set is uploaded', `${as(A)} select public.submit_set(${q({ id: 'claim-legacy', startedAt: Date.now() - 60000, endedAt: Date.now() - 1000, reps: [{ index: 1, timestamp: Date.now() - 30000, quality: 'good', source: 'proximity', bottomDistance: null, topDistance: null, faceLostAtBottom: false }], calibratedTopDistance: null, depthTracking: false })}) is not null; reset role; ${as(A)} ${create('cleg', { kind: 'best_set', deadlineHours: 24 }, [B])} reset role;`],
  ['claim: a legacy set cannot be scored (expect ERR)', `select set_config('request.jwt.claim.sub','',false); set role service_role; select public.submit_set(jsonb_build_object('id','claim-legacy','challengeId', ${ctx('cleg')}, 'userId','${A}','linkFinishedSet', true)); reset role;`],
  ['claim: a live battle and a recent solo set', `insert into challenges(id,created_by,mode,kind,metric,invite_expires_at) values ('88888888-8888-4888-8888-888888888888','${A}','live','best_set','rep_count',now()+interval '10 minutes'); insert into test_ctx(k,v) values ('clive','88888888-8888-4888-8888-888888888888') on conflict (k) do update set v=excluded.v; ${solo('claim-live', 4, A)}`],
  ['claim: live challenges cannot use a finished set (expect ERR)', link('claim-live', 4, 'clive', A)],
  ['claim: a set not yet uploaded is inserted under the same rules', `${as(A)} ${create('cfresh', { kind: 'best_set', deadlineHours: 24 }, [B])} reset role; ${link('claim-fresh', 5, 'cfresh', A)} select (challenge_id::text = ${ctx('cfresh')}) as linked from sets where client_set_id='claim-fresh'; select valid_reps from challenge_standings where challenge_id=${ctx('cfresh')}::uuid and user_id='${A}';`],
  ['claim: a battle for an old fresh set', `${as(A)} ${create('cfresh-old', { kind: 'best_set', deadlineHours: 24 }, [B])} reset role;`],
  ['claim: fresh insert of an old set is refused (expect ERR)', link('claim-fresh-old', 4, 'cfresh-old', A, { start: Date.now() - 3 * 3600 * 1000 })],
  ['claim: the refused fresh set was not stored', `select count(*) n from sets where client_set_id='claim-fresh-old';`],
  ['claim: shortening the window is what the server enforces', `update app_settings set value = jsonb_set(value, '{claim_set_max_age_s}', '60') where key='async_battle_defaults';`],
  ['claim: a set from a few minutes ago', `${solo('claim-age', 4, A, { start: Date.now() - 3 * 60 * 1000 })} ${as(A)} ${create('cage', { kind: 'best_set', deadlineHours: 24 }, [B])} reset role;`],
  ['claim: a set from a few minutes ago is now too old (expect ERR)', link('claim-age', 4, 'cage', A, { start: Date.now() - 3 * 60 * 1000 })],
  ['claim: restore the default window', `update app_settings set value = jsonb_set(value, '{claim_set_max_age_s}', '1800') where key='async_battle_defaults'; select value->>'claim_set_max_age_s' age from app_settings where key='async_battle_defaults';`],
);
Object.assign(checks, {
  'claim: defaults include the recency window and multi-day options': (r) => ok(r[0][0].age === '1800' && r[0][0].w === '7' && r[0][0].h === '24', 'defaults ' + JSON.stringify(r[0])),
  'claim: the set is still solo': (r) => ok(r[0][0].solo === true, 'linked without the flag'),
  'claim: linking it counts as A attempt and tells B': (r) => {
    const linked = r.find((x) => x[0] && 'linked' in x[0])[0];
    const score = r.find((x) => x[0] && 'valid_reps' in x[0])[0];
    const note = r.find((x) => x[0] && 'n' in x[0])[0];
    ok(linked.linked === true, 'not linked ' + JSON.stringify(r));
    ok(Number(score.valid_reps) === 10 && Number(score.attempts_used) === 1, 'score ' + JSON.stringify(score));
    ok(Number(note.n) === 1, 'notify ' + JSON.stringify(note));
  },
  'claim: linking again is idempotent': (r) => ok(Number(r[r.length - 1][0].n) === 1, 'duplicated'),
  'claim: the old set stayed solo': (r) => ok(r[0][0].solo === true, 'old set linked'),
  'claim: a 60 s set becomes the attempt only for a 60 s battle': (r) => {
    const row = r[r.length - 2][0];
    ok(Number(row.timer_duration_s) === 60 && row.linked === true, 'timer ' + JSON.stringify(row));
    ok(Number(r[r.length - 1][0].valid_reps) === 7, 'timed window ' + JSON.stringify(r[r.length - 1]));
  },
  'claim: a total counts solo sets in the window and does not link them': (r) => {
    const meta = r.find((x) => x[0] && 'kind' in x[0] && 'window_unit' in x[0])[0];
    ok(meta.kind === 'total' && meta.window_unit === 'week' && meta.no_cap === true && meta.no_metric === true && meta.started === true, 'window ' + JSON.stringify(meta));
    const before = r.find((x) => x[0] && 'before_reps' in x[0])[0];
    const score = r.find((x) => x[0] && 'metric_value' in x[0])[0];
    ok(Number(score.valid_reps) - Number(before.before_reps) === 20 && Number(score.attempts_used) - Number(before.before_attempts) === 2 && Number(score.metric_value) === Number(score.valid_reps), 'total ' + JSON.stringify({ before, score }));
    const soloRow = r.find((x) => x[0] && 'solo' in x[0])[0];
    ok(soloRow.solo === true, 'linked ' + JSON.stringify(soloRow));
    const leak = r[r.length - 1][0];
    ok(Number(leak.n) === 0, 'solo sets visible ' + JSON.stringify(leak));
  },
  'claim: shallow reps still do not count': (r) => ok(Number(r[r.length - 1][0].valid_reps) === 2, 'shallow ' + JSON.stringify(r[r.length - 1])),
  'claim: a set not yet uploaded is inserted under the same rules': (r) => {
    ok(r[r.length - 2][0].linked === true, 'fresh not linked');
    ok(Number(r[r.length - 1][0].valid_reps) === 5, 'fresh score ' + JSON.stringify(r[r.length - 1]));
  },
  'claim: the refused fresh set was not stored': (r) => ok(Number(r[0][0].n) === 0, 'old fresh stored'),
  'claim: restore the default window': (r) => ok(r[r.length - 1][0].age === '1800', 'age not restored'),
});

// ---- Slice 3: zone, goals, my_progress. Battle views stay; user_stats is gone. ----
const P = 'abababab-abab-4aba-8aba-abababababab';
const Q = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
const isoDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const progressDoc = (r) => {
  const row = r.map((set) => set[0]).reverse().find((x) => x && x.my_progress != null);
  const raw = row.my_progress;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
};
steps.push(
  ['progress: programs are readable by anon', `set role anon; select count(*)::int as n from programs; select count(*)::int as n from program_segments; reset role;`],
  ['progress: anon cannot insert a program (expect ERR)', `set role anon; insert into programs (id, name, summary, completion_rule, maintains_after, sort_order) values ('nope','x','x','finish_schedule',false,9); reset role;`],
  ['progress: seed matches the three ramps', `select id, completion_rule, completion_set_reps, maintains_after, (select jsonb_agg(jsonb_build_object('from', day_from, 'to', day_to, 'target', daily_target, 'rest', rest_weekday, 'marker', set_marker) order by segment_index) from program_segments s where s.program_id = p.id) as segs from programs p where active order by sort_order;`],
  ['progress: an omitted zone is the profile zone, and the set stays on that date', `${as(D)} select submit_set(${q(rec('zone-ny', 3, 1500, [0.15], { start: Date.parse('2026-11-01T22:00:00.000Z') }))}) is not null; reset role; select recorded_time_zone as zone, (started_at at time zone recorded_time_zone)::date as local_date from sets where client_set_id='zone-ny';`],
  ['progress: an explicit zone is stored', `${as(D)} select submit_set(${q({ ...rec('zone-tokyo', 2, 1500, [0.15]), timeZone: 'Asia/Tokyo' })}) is not null; reset role; select recorded_time_zone as zone from sets where client_set_id='zone-tokyo';`],
  ['progress: an unknown zone is rejected (expect ERR)', `${as(D)} select submit_set(${q({ ...rec('zone-bad', 2, 1500, [0.15]), timeZone: 'Not/AZone' })}); reset role;`],
  ['progress: a client cannot write an enrollment (expect ERR)', `${as(D)} insert into goal_enrollments (user_id, custom_daily_reps, started_on, recorded_time_zone) values ('${D}', 30, current_date, 'UTC'); reset role;`],
  ['progress: switching today rewrites the open row', `${as(D)} select enroll_goal('{"customDailyReps":30}')->>'customDailyReps' as custom; select enroll_goal('{"programId":"first_20"}')->>'programId' as program; select count(*)::int as n from goal_enrollments where user_id='${D}'; reset role;`],
  ['progress: a custom goal outside the settings is rejected (expect ERR)', `${as(D)} select enroll_goal('{"customDailyReps":4}'); reset role;`],
  ['progress: switching on a later day closes yesterday', `update goal_enrollments set started_on = (now() at time zone 'America/New_York')::date - 1 where user_id='${D}' and ended_on is null; ${as(D)} select enroll_goal('{"programId":"fifty_a_day"}')->>'programId' as program; select count(*)::int as n, (select ended_on from goal_enrollments where user_id='${D}' and program_id='first_20') as closed from goal_enrollments where user_id='${D}'; reset role;`],
  ['progress: someone else cannot read the goal', `${as(B)} select count(*)::int as n from goal_enrollments; reset role;`],
  ['progress: anon cannot call my_progress (expect ERR)', `set role anon; select my_progress(); reset role;`],
  ['progress: setup P', `insert into auth.users values ('${P}'); ${as(P)} insert into profiles(id, username, time_zone) values ('${P}', 'pat', 'UTC'); select enroll_goal('{"customDailyReps":10}')->>'customDailyReps' as custom; reset role; update goal_enrollments set started_on = (now() at time zone 'UTC')::date - 80 where user_id='${P}' and ended_on is null;`],
  ['progress: a late set counts in the total and not the streak', `${as(P)} select submit_set(${q(rec('p-late', 40, 1500, [0.15], { start: Date.now() - 70 * 86400000 }))}) is not null; select my_progress() as my_progress; reset role;`],
  ['progress: today on a second call is the same ring', `${as(P)} select submit_set(${q(rec('p-today', 10, 1500, [0.15]))}) is not null; select my_progress() as my_progress; reset role;`],
  ['progress: another user does not see those totals', `${as(B)} select count(*)::int as n from daily_totals where user_id='${P}'; reset role;`],
  ['progress: twenty counted reps completes First 20', `insert into auth.users values ('${Q}'); ${as(Q)} insert into profiles(id, username, time_zone) values ('${Q}', 'quinn', 'UTC'); select submit_set(${q(rec('q-twenty', 20, 1500, [0.15]))}) is not null; select enroll_goal('{"programId":"first_20"}')->>'programId' as program; select my_progress() as my_progress; reset role;`],
);
Object.assign(checks, {
  'progress: programs are readable by anon': (r) => ok(Number(r[0][0].n) === 3 && Number(r[1][0].n) === 12, 'seed counts ' + JSON.stringify(r)),
  'progress: seed matches the three ramps': (r) => {
    const rows = r[0].map((row) => ({ ...row, segs: typeof row.segs === 'string' ? JSON.parse(row.segs) : row.segs }));
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    const seg = (row) => row.segs.map((s) => ({ from: Number(s.from), to: Number(s.to), target: Number(s.target), rest: s.rest == null ? null : Number(s.rest), marker: s.marker == null ? null : Number(s.marker) }));
    ok(byId.first_20.completion_rule === 'single_set' && Number(byId.first_20.completion_set_reps) === 20 && byId.first_20.maintains_after === true, 'first 20');
    ok(JSON.stringify(seg(byId.first_20)) === JSON.stringify([
      { from: 1, to: 7, target: 10, rest: 7, marker: 5 },
      { from: 8, to: 14, target: 15, rest: 7, marker: 10 },
      { from: 15, to: 21, target: 20, rest: 7, marker: 15 },
      { from: 22, to: 28, target: 25, rest: 7, marker: 20 },
    ]), 'first 20 ramp ' + JSON.stringify(seg(byId.first_20)));
    ok(byId.fifty_a_day.completion_rule === 'finish_schedule' && byId.fifty_a_day.maintains_after === true, 'fifty');
    ok(JSON.stringify(seg(byId.fifty_a_day)) === JSON.stringify([
      { from: 1, to: 7, target: 20, rest: null, marker: null },
      { from: 8, to: 14, target: 30, rest: null, marker: null },
      { from: 15, to: 21, target: 40, rest: null, marker: null },
      { from: 22, to: 28, target: 50, rest: null, marker: null },
    ]), 'fifty ramp');
    ok(byId.hundred_in_30.completion_rule === 'finish_schedule', 'hundred');
    ok(JSON.stringify(seg(byId.hundred_in_30)) === JSON.stringify([
      { from: 1, to: 7, target: 40, rest: null, marker: null },
      { from: 8, to: 14, target: 55, rest: null, marker: null },
      { from: 15, to: 21, target: 70, rest: null, marker: null },
      { from: 22, to: 30, target: 100, rest: null, marker: null },
    ]), 'hundred ramp');
  },
  'progress: an omitted zone is the profile zone, and the set stays on that date': (r) => {
    const row = r[r.length - 1][0];
    ok(row.zone === 'Europe/Paris' && isoDate(row.local_date) === '2026-11-01', 'zone ' + JSON.stringify(row));
  },
  'progress: an explicit zone is stored': (r) => ok(r[r.length - 1][0].zone === 'Asia/Tokyo', 'tokyo'),
  'progress: switching today rewrites the open row': (r) => {
    ok(Number(r[0][0].custom) === 30 && r[1][0].program === 'first_20' && Number(r[2][0].n) === 1, 'switch ' + JSON.stringify(r));
  },
  'progress: switching on a later day closes yesterday': (r) => {
    const row = r[r.length - 1][0];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    ok(r[0][0].program === 'fifty_a_day' && Number(row.n) === 2 && isoDate(row.closed) === today, 'close ' + JSON.stringify(r));
  },
  'progress: someone else cannot read the goal': (r) => ok(Number(r[0][0].n) === 0, 'goal leak'),
  'progress: a late set counts in the total and not the streak': (r) => {
    const d = progressDoc(r);
    ok(Number(d.lifetimeReps) === 40 && Number(d.longestStreak) === 0 && Number(d.currentStreak) === 0, 'late ' + JSON.stringify({ life: d.lifetimeReps, longest: d.longestStreak, current: d.currentStreak }));
    ok(Number(d.records.bestSet.reps) === 40 && Number(d.badges[0].remaining) === 960, 'records ' + JSON.stringify(d.records.bestSet));
  },
  'progress: today on a second call is the same ring': (r) => {
    const d = progressDoc(r);
    ok(Number(d.todayReps) === 10 && d.goalMet === true && Number(d.target) === 10 && d.rest === false, 'ring ' + JSON.stringify({ reps: d.todayReps, met: d.goalMet, target: d.target }));
    ok(Number(d.currentStreak) === 1 && Number(d.longestStreak) === 1 && Number(d.lifetimeReps) === 50, 'streak ' + JSON.stringify({ current: d.currentStreak, longest: d.longestStreak, life: d.lifetimeReps }));
    ok(d.charts.day.length === 14 && d.charts.week.length === 12 && d.charts.month.length === 12, 'charts');
    ok(Number(d.charts.day[13].reps) === 10 && d.program.detail === '10 a day', 'today bar ' + d.program.detail);
    ok(Number(d.badges[0].remaining) === 950 && d.badges[0].earnedOn == null, 'badge');
    ok(d.sets.length === 2, 'sets for the other phone');
  },
  'progress: another user does not see those totals': (r) => ok(Number(r[0][0].n) === 0, 'totals leak'),
  'progress: twenty counted reps completes First 20': (r) => {
    const d = progressDoc(r);
    ok(d.program.status === 'complete' && d.program.detail === 'Complete' && d.program.name === 'First 20 in a row', 'complete ' + JSON.stringify(d.program));
  },
});

// ---- Slice 4: the weekly league. Aggregates are computed at call time. Crowns are last week. ----
const LA = 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1';
const LB = 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2';
const LC = 'd3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3';
const LX = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';

function utcStamp(weeksAgo, isoWeekday) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0));
  const iso = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  const t = new Date(today);
  t.setUTCDate(today.getUTCDate() - (iso - 1) - weeksAgo * 7 + (isoWeekday - 1));
  return t.getTime();
}
function todayIso() {
  const day = new Date().getUTCDay();
  return day === 0 ? 7 : day;
}
function leagueSet(user, id, n, weeksAgo, isoWeekday, bottoms = [0.15], offsetMs = 0) {
  const payload = { ...rec(id, n, 1500, bottoms, { start: utcStamp(weeksAgo, isoWeekday) + offsetMs }), timeZone: 'UTC' };
  return `${as(user)} select submit_set(${q(payload)}) is not null; reset role;`;
}
const leagueDoc = (r) => {
  const row = r.map((set) => set[0]).reverse().find((x) => x && x.my_league != null);
  const raw = row.my_league;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
};
const leagueName = (rows, username) => rows.find((row) => row.username === username);
const monday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;

steps.push(
  ['league: settings publish the grace, the weights, and the visibility value', `select key, value from app_settings where key in ('upload_grace_s', 'league_improvement_weights', 'friends_visibility') order by key;`],
  ['league: anon cannot call my_league (expect ERR)', `set role anon; select my_league(); reset role;`],
  ['league: a user without a username cannot call it (expect ERR)', `insert into auth.users values ('${LX}'); ${as(LX)} select my_league(); reset role;`],
  ['league: one person has no crown', `insert into auth.users values ('${LA}'),('${LB}'),('${LC}'); ${as(LA)} insert into profiles(id, username, time_zone) values ('${LA}', 'leaguea', 'UTC'); select my_league() as my_league; reset role;`],
  ['league: a zero tie shares the crown and a pending friend stays off', `${as(LB)} insert into profiles(id, username, time_zone) values ('${LB}', 'leagueb', 'UTC'); reset role; ${as(LC)} insert into profiles(id, username, time_zone) values ('${LC}', 'leaguec', 'UTC'); reset role; ${as(LA)} select send_friend_request('leagueb'); reset role; ${as(LB)} select respond_friend_request('${LA}', true); reset role; ${as(LA)} select send_friend_request('leaguec'); reset role; ${as(LB)} select count(*)::int as n from sets where user_id='${LA}' and challenge_id is null; reset role; ${as(LA)} select my_league() as my_league; reset role;`],
  ['league: total and improvement crown different people', `
    insert into goal_enrollments (user_id, custom_daily_reps, started_on, recorded_time_zone)
    values ('${LA}', 10, (now() at time zone 'UTC')::date - 100, 'UTC');
    insert into goal_enrollments (user_id, program_id, started_on, recorded_time_zone)
    values ('${LB}', 'first_20', (now() at time zone 'UTC')::date - 100, 'UTC');
    ${leagueSet(LA, 'lg-a-w3', 10, 3, 1)}
    ${leagueSet(LA, 'lg-a-w2', 20, 2, 1)}
    ${leagueSet(LA, 'lg-a-w1a', 100, 1, 1)}
    ${leagueSet(LA, 'lg-a-w1b', 100, 1, 1, [0.15], 200000)}
    ${leagueSet(LA, 'lg-a-now', 50, 0, todayIso())}
    ${leagueSet(LA, 'lg-a-late', 10, 0, todayIso(), [0.15], 200000)}
    ${leagueSet(LA, 'lg-a-shallow', 5, 0, todayIso(), [0.4], 400000)}
    ${leagueSet(LB, 'lg-b-w3', 80, 3, 1)}
    ${leagueSet(LB, 'lg-b-w2', 80, 2, 1)}
    ${[1, 2, 3, 4, 5].map((day) => leagueSet(LB, `lg-b-w1-${day}`, 25, 1, day)).join('\n')}
    ${leagueSet(LB, 'lg-b-now', 80, 0, todayIso())}
    update sets set received_at = started_at + interval '1 minute'
     where client_set_id like 'lg-%' and client_set_id <> 'lg-a-late';
    update sets set received_at = (
      (((started_at at time zone recorded_time_zone)::date
        - (extract(isodow from (started_at at time zone recorded_time_zone)::date)::int - 1) + 7)::timestamp
        at time zone recorded_time_zone) + interval '1 hour')
     where client_set_id = 'lg-a-late';
    ${as(LA)} select (my_progress()->>'lifetimeReps')::int as life, my_league() as my_league; reset role;
  `],
  ['league: removing a friend drops them and the crown', `${as(LA)} select remove_friend('${LB}'); select my_league() as my_league; reset role;`],
);

Object.assign(checks, {
  'league: settings publish the grace, the weights, and the visibility value': (r) => {
    const decode = (value) => {
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); } catch { return value; }
    };
    const rows = Object.fromEntries(r[0].map((row) => [row.key, decode(row.value)]));
    ok(rows.friends_visibility === 'league_and_challenge_results', 'visibility ' + JSON.stringify(rows.friends_visibility));
    ok(Number(rows.upload_grace_s) === 900, 'grace ' + JSON.stringify(rows.upload_grace_s));
    ok(Number(rows.league_improvement_weights.per_goal_day) === 20 && Number(rows.league_improvement_weights.baseline_min_weeks) === 3, 'weights');
  },
  'league: one person has no crown': (r) => {
    const doc = leagueDoc(r);
    ok(monday(doc.weekStart) && doc.timeZone === 'UTC', 'week ' + JSON.stringify({ start: doc.weekStart, zone: doc.timeZone }));
    const end = new Date(`${doc.weekStart}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    ok(doc.weekEnd === end.toISOString().slice(0, 10), 'end ' + doc.weekEnd);
    ok(doc.total.length === 1 && doc.improvement.length === 1, 'rows');
    ok(doc.total[0].crownedLastWeek === false && doc.improvement[0].crownedLastWeek === false, 'crown');
    ok(doc.improvement[0].baselineWeeks === 0 && doc.improvement[0].usual == null, 'baseline ' + JSON.stringify(doc.improvement[0]));
    ok(!JSON.stringify(doc).includes('clientSetId'), 'set leak');
  },
  'league: a zero tie shares the crown and a pending friend stays off': (r) => {
    const leak = r.map((set) => set[0]).find((row) => row && Object.prototype.hasOwnProperty.call(row, 'n'));
    ok(leak && Number(leak.n) === 0, 'solo sets leaked ' + JSON.stringify(leak));
    const doc = leagueDoc(r);
    ok(doc.total.length === 2 && doc.improvement.length === 2, 'board ' + doc.total.length);
    ok(doc.total.every((row) => row.crownedLastWeek && row.reps === 0), 'total crown ' + JSON.stringify(doc.total));
    ok(doc.improvement.every((row) => row.crownedLastWeek && row.points === 0), 'imp crown');
    ok(!JSON.stringify(doc).includes('leaguec'), 'pending ' + JSON.stringify(doc.total));
  },
  'league: total and improvement crown different people': (r) => {
    const row = r.map((set) => set[0]).reverse().find((x) => x && x.my_league != null);
    ok(Number(row.life) === 290, 'history kept the late set ' + row.life);
    const doc = leagueDoc(r);
    const totalA = leagueName(doc.total, 'leaguea');
    const totalB = leagueName(doc.total, 'leagueb');
    const impA = leagueName(doc.improvement, 'leaguea');
    const impB = leagueName(doc.improvement, 'leagueb');
    const sunday = new Date().getUTCDay() === 0;
    const hitB = sunday ? 0 : 1;
    ok(Number(totalA.reps) === 50 && Number(totalB.reps) === 80, 'reps ' + JSON.stringify({ a: totalA.reps, b: totalB.reps }));
    ok(Number(totalB.rank) === 1 && Number(totalA.rank) === 2, 'total rank');
    ok(totalA.crownedLastWeek === true && totalB.crownedLastWeek === false, 'total crown follows last week');
    ok(Number(impA.goalDaysScheduled) === 7 && Number(impB.goalDaysScheduled) === 6, 'scheduled ' + JSON.stringify({ a: impA.goalDaysScheduled, b: impB.goalDaysScheduled }));
    ok(Number(impA.goalDaysHit) === 1 && Number(impB.goalDaysHit) === hitB, 'hit ' + JSON.stringify({ a: impA.goalDaysHit, b: impB.goalDaysHit, sunday }));
    ok(Number(impA.usual) === 20 && Number(impB.usual) === 80, 'usual ' + JSON.stringify({ a: impA.usual, b: impB.usual }));
    ok(Number(impA.baselineWeeks) === 3 && Number(impB.baselineWeeks) === 3, 'baseline');
    ok(Number(impA.points) === 50 && Number(impB.points) === hitB * 20, 'points ' + JSON.stringify({ a: impA.points, b: impB.points }));
    ok(Number(impA.rank) === 1 && Number(impB.rank) === 2, 'imp rank');
    ok(impB.crownedLastWeek === true && impA.crownedLastWeek === false, 'imp crown follows last week');
    ok(!JSON.stringify(doc).includes('lg-'), 'no set ids');
  },
  'league: removing a friend drops them and the crown': (r) => {
    const doc = leagueDoc(r);
    ok(doc.total.length === 1 && doc.total[0].username === 'leaguea', 'left ' + JSON.stringify(doc.total));
    ok(doc.total[0].crownedLastWeek === false && doc.improvement[0].crownedLastWeek === false, 'crown gone');
    ok(!JSON.stringify(doc).includes('leagueb'), 'still listed');
  },
});

steps.push(
  ['slice5: linking a set onto a total is rejected (expect ERR)', link('claim-md1', 10, 'cmd', A)],
  ['slice5: a short custom window is rejected (expect ERR)', `${as(A)} select create_challenge(${q({ kind: 'total', window: 'custom', customStartsAt: new Date(Date.now() - 60000).toISOString(), customEndsAt: new Date(Date.now() + 20 * 60000).toISOString(), friendIds: [B] })}); reset role;`],
  ['slice5: accepting later pulls earlier sets in; a set outside the window does not', `${as(A)} ${create('cday', { kind: 'total', window: 'custom', customStartsAt: new Date(Date.now() - 3600 * 1000).toISOString(), customEndsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() }, [B])} reset role; update challenges set starts_at = now() - interval '10 days', ends_at = now() - interval '9 days' where id=${ctx('cday')}::uuid; ${solo('before-accept', 6, B)} update sets set started_at = (select starts_at + interval '1 hour' from challenges where id=${ctx('cday')}::uuid), ended_at = (select starts_at + interval '1 hour 2 minutes' from challenges where id=${ctx('cday')}::uuid), received_at = (select starts_at + interval '2 hours' from challenges where id=${ctx('cday')}::uuid) where client_set_id='before-accept'; select coalesce((select valid_reps from challenge_standings where challenge_id=${ctx('cday')}::uuid and user_id='${B}'), 0) before; ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('cday')}::uuid and user_id='${B}'; reset role; select valid_reps after from challenge_standings where challenge_id=${ctx('cday')}::uuid and user_id='${B}'; ${solo('outside-day', 9, A, { start: Date.now() - 3 * 24 * 3600 * 1000 })} ${solo('inside-day', 4, A)} update sets set started_at = (select starts_at + interval '3 hours' from challenges where id=${ctx('cday')}::uuid), ended_at = (select starts_at + interval '3 hours 2 minutes' from challenges where id=${ctx('cday')}::uuid), received_at = (select starts_at + interval '4 hours' from challenges where id=${ctx('cday')}::uuid) where client_set_id='inside-day'; select valid_reps mine from challenge_standings where challenge_id=${ctx('cday')}::uuid and user_id='${A}';`],
  ['slice5: a forfeited later set stays out and the higher total wins', `${as(A)} ${create('cdraw', { kind: 'total', window: 'custom', customStartsAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), customEndsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() }, [B])} reset role; ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('cdraw')}::uuid and user_id='${B}'; reset role; ${solo('draw-a', 10, A)} ${solo('draw-b', 4, B)} ${as(B)} update challenge_participants set status='forfeited' where challenge_id=${ctx('cdraw')}::uuid and user_id='${B}'; reset role; ${solo('draw-b2', 20, B)} update sets set started_at = now() - interval '40 minutes', received_at = now() - interval '30 minutes' where client_set_id in ('draw-a','draw-b'); update challenges set ends_at = now() - interval '16 minutes' where id=${ctx('cdraw')}::uuid; select valid_reps, user_id::text = '${A}' me from challenge_standings where challenge_id=${ctx('cdraw')}::uuid order by user_id; select finalize_challenges(); select status, (select count(*) from challenge_results r where r.challenge_id=${ctx('cdraw')}::uuid and r.is_winner) winners from challenges where id=${ctx('cdraw')}::uuid;`],
);
Object.assign(checks, {
  'slice5: accepting later pulls earlier sets in; a set outside the window does not': (r) => {
    const before = r.find((x) => x[0] && 'before' in x[0])[0];
    const after = r.find((x) => x[0] && 'after' in x[0])[0];
    const mine = r.find((x) => x[0] && 'mine' in x[0])[0];
    ok(Number(before.before) === 0, 'counted before accept ' + JSON.stringify(before));
    ok(Number(after.after) === 6, 'accept did not pull the set ' + JSON.stringify(after));
    ok(Number(mine.mine) === 4, 'outside set counted ' + JSON.stringify(mine));
  },
  'slice5: a forfeited later set stays out and the higher total wins': (r) => {
    const rows = r.find((x) => x[0] && 'me' in x[0]);
    const a = rows.find((x) => x.me === true);
    const b = rows.find((x) => x.me === false);
    ok(Number(a.valid_reps) === 10 && Number(b.valid_reps) === 4, 'reps ' + JSON.stringify(rows));
    const done = r[r.length - 1][0];
    ok(done.status === 'completed' && Number(done.winners) === 1, 'lock ' + JSON.stringify(done));
  },
});

const placeSet = (id, k, offsetSql) =>
  `update sets s set started_at = c.starts_at + ${offsetSql}, ended_at = c.starts_at + ${offsetSql} + interval '2 minutes', received_at = c.starts_at + ${offsetSql} + interval '30 minutes' from challenges c where s.client_set_id='${id}' and c.id=${ctx(k)}::uuid;`;

steps.push(
  ['slice6: a streak without a goal is rejected (expect ERR)', `${as(A)} select create_challenge(${q({ kind: 'streak', streakDays: 7, friendIds: [B] })}); reset role;`],
  ['slice6: an invitee without a goal cannot accept (expect ERR)', `${as(A)} select enroll_goal(${q({ customDailyReps: 10 })}); reset role; ${as(A)} ${create('snogoal', { kind: 'streak', streakDays: 7 }, [B])} reset role; ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('snogoal')}::uuid and user_id='${B}'; reset role;`],
  ['slice6: the last person still hitting wins before the window ends', `
    ${as(A)} select enroll_goal(${q({ customDailyReps: 10 })}); reset role;
    ${as(B)} select enroll_goal(${q({ customDailyReps: 20 })}); reset role;
    ${as(A)} ${create('stk', { kind: 'streak', streakDays: 7 }, [B])} reset role;
    select streak_floor_reps as a_floor, joined_time_zone as a_zone from challenge_participants where challenge_id=${ctx('stk')}::uuid and user_id='${A}';
    ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('stk')}::uuid and user_id='${B}'; reset role;
    select streak_floor_reps as b_floor from challenge_participants where challenge_id=${ctx('stk')}::uuid and user_id='${B}';
    select set_config('request.jwt.claim.sub','',false);
    update challenges set
      starts_at = ((date_trunc('day', now() at time zone 'UTC') - interval '2 days') at time zone 'UTC'),
      ends_at = ((date_trunc('day', now() at time zone 'UTC') - interval '2 days') at time zone 'UTC') + interval '7 days'
      where id=${ctx('stk')}::uuid;
    update challenge_participants set
      responded_at = (select starts_at + interval '1 hour' from challenges where id=${ctx('stk')}::uuid),
      joined_time_zone = 'UTC'
      where challenge_id=${ctx('stk')}::uuid and status='accepted';
    ${solo('st-b-0', 24, B)}
    ${solo('st-b-1', 24, B)}
    ${placeSet('st-b-0', 'stk', "interval '2 hours'")}
    ${placeSet('st-b-1', 'stk', "interval '1 day 2 hours'")}
    select user_id::text = '${A}' as me, days_survived, (eliminated_on is not null) as out
      from challenge_standings where challenge_id=${ctx('stk')}::uuid order by user_id;
    select (ends_at > now()) as still_open from challenges where id=${ctx('stk')}::uuid;
    ${as(A)} select p->>'streakFloorReps' as mine_floor
      from jsonb_array_elements(my_challenges(${ctx('stk')}::uuid)->0->'participants') p
      where (p->>'isMe')::boolean; reset role;
    select finalize_challenges();
    select status, (ends_at > finished_at) as ended_early,
      (select is_winner from challenge_results where challenge_id=${ctx('stk')}::uuid and user_id='${A}') as a_win,
      (select is_winner from challenge_results where challenge_id=${ctx('stk')}::uuid and user_id='${B}') as b_win,
      (select days_survived from challenge_results where challenge_id=${ctx('stk')}::uuid and user_id='${B}') as b_days
      from challenges where id=${ctx('stk')}::uuid;
  `],
  ['slice6: changing the goal does not lower the frozen bar', `
    select streak_floor_reps as before from challenge_participants where challenge_id=${ctx('stk')}::uuid and user_id='${A}';
    ${as(A)} select enroll_goal(${q({ programId: 'first_20' })}); reset role;
    select streak_floor_reps as after from challenge_participants where challenge_id=${ctx('stk')}::uuid and user_id='${A}';
    ${as(A)} ${create('sprog', { kind: 'streak', streakDays: 7 }, [B])} reset role;
    select streak_floor_reps as program_floor from challenge_participants where challenge_id=${ctx('sprog')}::uuid and user_id='${A}';
  `],
  ['slice6: a team locks when the total hits, and a miss has no winner', `
    ${as(A)} ${create('thit', { kind: 'team', window: 'week', targetReps: 10 }, [B])} reset role;
    ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('thit')}::uuid and user_id='${B}'; reset role;
    select (ends_at > now()) as open, coalesce((select max(team_total) from challenge_standings where challenge_id=${ctx('thit')}::uuid), 0) as total
      from challenges where id=${ctx('thit')}::uuid;
    select finalize_challenges();
    select c.status, (c.ends_at > c.finished_at) as early,
      (select count(*) from challenge_results r where r.challenge_id=c.id and r.is_winner) as winners
      from challenges c where c.id=${ctx('thit')}::uuid;
    ${as(A)} ${create('tzero', { kind: 'team', targetReps: 10, window: 'custom', customStartsAt: new Date(Date.now() - 3600 * 1000).toISOString(), customEndsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() }, [B])} reset role;
    ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('tzero')}::uuid and user_id='${B}'; reset role;
    ${solo('team-zero-a', 12, A)}
    update challenges set starts_at = now() - interval '20 days', ends_at = now() - interval '20 days' + interval '2 hours' where id=${ctx('tzero')}::uuid;
    ${placeSet('team-zero-a', 'tzero', "interval '20 minutes'")}
    select finalize_challenges();
    select user_id::text = '${B}' as b, valid_reps, is_winner, team_total from challenge_results where challenge_id=${ctx('tzero')}::uuid order by user_id;
    ${as(A)} ${create('tmiss', { kind: 'team', targetReps: 500, window: 'custom', customStartsAt: new Date(Date.now() - 3600 * 1000).toISOString(), customEndsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() }, [B])} reset role;
    ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('tmiss')}::uuid and user_id='${B}'; reset role;
    update challenges set starts_at = now() - interval '25 days', ends_at = now() - interval '25 days' + interval '2 hours' where id=${ctx('tmiss')}::uuid;
    select finalize_challenges();
    select status, (select coalesce(max(team_total), 0) from challenge_results where challenge_id=${ctx('tmiss')}::uuid) as total,
      (select count(*) from challenge_results where challenge_id=${ctx('tmiss')}::uuid and is_winner) as winners
      from challenges where id=${ctx('tmiss')}::uuid;
  `],
  ['slice6: a forfeited teammate cannot win and later reps stay out', `
    ${as(A)} ${create('tfor', { kind: 'team', targetReps: 15, window: 'custom', customStartsAt: new Date(Date.now() - 3600 * 1000).toISOString(), customEndsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() }, [B])} reset role;
    ${as(B)} update challenge_participants set status='accepted' where challenge_id=${ctx('tfor')}::uuid and user_id='${B}'; reset role;
    ${solo('team-for-a', 12, A)}
    ${solo('team-for-b', 6, B)}
    ${as(B)} update challenge_participants set status='forfeited' where challenge_id=${ctx('tfor')}::uuid and user_id='${B}'; reset role;
    ${solo('team-for-b2', 30, B)}
    update challenges set starts_at = now() - interval '22 days', ends_at = now() - interval '22 days' + interval '2 hours' where id=${ctx('tfor')}::uuid;
    ${placeSet('team-for-a', 'tfor', "interval '15 minutes'")}
    ${placeSet('team-for-b', 'tfor', "interval '40 minutes'")}
    select finalize_challenges();
    select user_id::text = '${A}' as a, valid_reps, is_winner, team_total from challenge_results where challenge_id=${ctx('tfor')}::uuid order by user_id;
    ${as(B)} select count(*)::int as seen from sets where client_set_id='team-for-a'; reset role;
  `],
  ['slice6: a short streak is rejected (expect ERR)', `${as(A)} select create_challenge(${q({ kind: 'streak', streakDays: 2, friendIds: [B] })}); reset role;`],
  ['slice6: a tiny team target is rejected (expect ERR)', `${as(A)} select create_challenge(${q({ kind: 'team', window: 'week', targetReps: 5, friendIds: [B] })}); reset role;`],
  ['slice6: the frozen bar cannot be edited (expect ERR)', `${as(B)} update challenge_participants set streak_floor_reps=1 where challenge_id=${ctx('stk')}::uuid and user_id='${B}'; reset role;`],
);

Object.assign(checks, {
  'slice6: the last person still hitting wins before the window ends': (r) => {
    const a = r.find((set) => set[0] && 'a_floor' in set[0])[0];
    const b = r.find((set) => set[0] && 'b_floor' in set[0])[0];
    ok(Number(a.a_floor) === 10 && a.a_zone === 'UTC', 'A floor ' + JSON.stringify(a));
    ok(Number(b.b_floor) === 20, 'B floor ' + JSON.stringify(b));
    const stand = r.find((set) => set[0] && 'out' in set[0]);
    const aRow = stand.find((row) => row.me === true);
    const bRow = stand.find((row) => row.me === false);
    ok(aRow.out === true && Number(aRow.days_survived) === 0, 'A survived ' + JSON.stringify(aRow));
    ok(bRow.out === false && Number(bRow.days_survived) >= 1, 'B survived ' + JSON.stringify(bRow));
    const open = r.find((set) => set[0] && 'still_open' in set[0])[0];
    ok(open.still_open === true, 'window already closed');
    const mine = r.find((set) => set[0] && 'mine_floor' in set[0])[0];
    ok(Number(mine.mine_floor) === 10, 'document ' + JSON.stringify(mine));
    const done = r.find((set) => set[0] && 'a_win' in set[0])[0];
    ok(done.status === 'completed' && done.ended_early === true && done.a_win === false && done.b_win === true && Number(done.b_days) >= 1, 'lock ' + JSON.stringify(done));
  },
  'slice6: changing the goal does not lower the frozen bar': (r) => {
    const before = r.find((set) => set[0] && 'before' in set[0])[0];
    const after = r.find((set) => set[0] && 'after' in set[0])[0];
    const program = r.find((set) => set[0] && 'program_floor' in set[0])[0];
    ok(Number(before.before) === 10 && Number(after.after) === 10, 'frozen ' + JSON.stringify({ before, after }));
    ok(Number(program.program_floor) === 10, 'sunday floor ' + JSON.stringify(program));
  },
  'slice6: a team locks when the total hits, and a miss has no winner': (r) => {
    const open = r.find((set) => set[0] && 'open' in set[0])[0];
    ok(open.open === true && Number(open.total) >= 1, 'not already over ' + JSON.stringify(open));
    const hit = r.find((set) => set[0] && 'early' in set[0])[0];
    ok(hit.status === 'completed' && hit.early === true && Number(hit.winners) === 2, 'early ' + JSON.stringify(hit));
    const zero = r.find((set) => set[0] && 'b' in set[0]);
    const b = zero.find((row) => row.b === true);
    const a = zero.find((row) => row.b === false);
    ok(b.is_winner === true && Number(b.valid_reps) === 0, 'zero still wins ' + JSON.stringify(b));
    ok(a.is_winner === true && Number(a.valid_reps) === 12 && Number(a.team_total) === 12, 'contribution ' + JSON.stringify(a));
    const miss = r[r.length - 1][0];
    ok(miss.status === 'completed' && Number(miss.total) === 0 && Number(miss.winners) === 0, 'miss ' + JSON.stringify(miss));
  },
  'slice6: a forfeited teammate cannot win and later reps stay out': (r) => {
    const rows = r.find((set) => set[0] && 'a' in set[0]);
    const a = rows.find((row) => row.a === true);
    const b = rows.find((row) => row.a === false);
    ok(Number(a.valid_reps) === 12 && a.is_winner === true && Number(a.team_total) === 18, 'A ' + JSON.stringify(a));
    ok(Number(b.valid_reps) === 6 && b.is_winner === false, 'B ' + JSON.stringify(b));
    const seen = r.find((set) => set[0] && 'seen' in set[0])[0];
    ok(Number(seen.seen) === 0, 'raw set leaked ' + JSON.stringify(seen));
  },
});
