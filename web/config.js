// Everything the invite page links to, in one place. Change a value here, not in the HTML.
module.exports = {
  /** Production origin (same host as src/invites/inviteLinks.json in the app). Used for absolute og:image URLs. */
  ORIGIN: 'https://reproyale.vercel.app',
  /** Public TestFlight link (group "Family & Friends"). It serves the newest build that passed beta review. */
  TESTFLIGHT_JOIN_URL: 'https://testflight.apple.com/join/BgusSC4Z',
  /** Apple's TestFlight app on the App Store. */
  TESTFLIGHT_APP_URL: 'https://apps.apple.com/app/testflight/id899247664',
  /** Set to the App Store listing once it is live; the page then shows the App Store variant. */
  APP_STORE_URL: null,
  /** The app's URL scheme: "Open Rep Royale" opens pushupcounter://i/<code>. */
  APP_SCHEME: 'pushupcounter',
  /** Apple team and bundle ids for apple-app-site-association (production and the dev client). */
  APPLE_TEAM_ID: 'S8KKL73JCN',
  BUNDLE_IDS: ['com.jackroseman.pushupcounter', 'com.jackroseman.pushupcounter.dev'],
  /** 8 characters, no 0/o/1/i/l (matches the database). */
  CODE: /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/,
};
