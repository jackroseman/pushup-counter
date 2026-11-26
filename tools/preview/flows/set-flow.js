// The core loop: Today -> Start a set -> lay the phone flat -> 3-2-1 -> 7 push-ups -> End set ->
// summary -> back to Today. Fails if the app does not count exactly 7 reps.
module.exports = {
  order: 2,
  description: 'Start a set, lay flat, countdown, 7 simulated reps (checked), summary, back to Today',
  options: { user: 'regular' },
  run: async ({ shot, tap, waitFor, pause, sim, doReps }) => {
    await pause(1500); // Today: ring fills, count settles
    await shot('today');
    await sim.lean(); // a few degrees off flat: the level step waits
    await tap(/^(Start a set|Start another set)$/, { wait: 1800 });
    await shot('lay-flat');
    await sim.flat(); // level locks, then the 3-2-1 starts
    await pause(1200);
    await shot('level-locked');
    await waitFor(/Ready/, 30000);
    await pause(1200);
    await shot('countdown');
    await waitFor('End set', 15000);
    await pause(600);
    await shot('counting-start');
    await doReps(7, 1100);
    await shot('counted-7');
    await tap('End set', { wait: 3000 });
    await shot('summary');
    await tap('Done', { wait: 3000 });
    await shot('today-after');
  },
};
