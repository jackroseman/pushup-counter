// Picking the phone up mid-set ends the set ("phone moved").
module.exports = {
  order: 3,
  description: 'Mid-set the phone is picked up: the set ends on its own',
  options: { user: 'regular' },
  run: async ({ shot, tap, waitFor, pause, sim }) => {
    await tap(/^(Start a set|Start another set)$/, { wait: 500 });
    await waitFor('End set', 30000);
    await sim.startReps(1100); // keeps going until the phone moves
    await pause(1100 * 3 + 300);
    await shot('counting');
    await sim.tilt();
    await pause(3200);
    await shot('phone-moved');
  },
};
