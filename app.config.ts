import { ConfigContext, ExpoConfig } from 'expo/config';

import inviteLinks from './src/invites/inviteLinks.json';

/**
 * App variants, picked with the APP_VARIANT env var. It is set in each EAS environment
 * (development / production), which builds, fingerprints and `eas update --environment`
 * all read, so they agree:
 *   development -> "Pushup Dev", com.jackroseman.pushupcounter.dev (dev client, installs side by side)
 *   anything else (production / unset) -> the app.json values, unchanged
 *
 * Runtime version (which builds an OTA update may reach):
 *   production  -> appVersion (app.json `version`). A native change needs a version bump;
 *                  scripts/eas-ship.sh refuses to publish an OTA whose fingerprint no store
 *                  build of that version has.
 *   development -> fingerprint. Dev builds are rebuilt for native changes without a version
 *                  bump, so the runtime follows the native fingerprint and an old dev build
 *                  never receives an update it cannot run.
 *
 * Universal links: both variants claim https://<webHost>/i/* (friend invite links). The
 * web/ apple-app-site-association lists both app ids. The Associated Domains capability must
 * be enabled on both App IDs in the Apple Developer portal (EAS can't sync capabilities in a
 * non-interactive build); build-dev.yml refreshes the ad hoc profile so it picks it up.
 */
const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base: ExpoConfig = {
    ...(config as ExpoConfig),
    ios: { ...config.ios, associatedDomains: [`applinks:${inviteLinks.webHost}`] },
  };
  if (!IS_DEV) return base;
  return {
    ...base,
    name: 'Pushup Dev',
    runtimeVersion: { policy: 'fingerprint' },
    ios: { ...base.ios, bundleIdentifier: 'com.jackroseman.pushupcounter.dev' },
    android: { ...base.android, package: 'com.jackroseman.pushupcounter.dev' },
  };
};
