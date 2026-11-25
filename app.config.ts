import { ConfigContext, ExpoConfig } from 'expo/config';

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
 */
const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (!IS_DEV) return base;
  return {
    ...base,
    name: 'Pushup Dev',
    runtimeVersion: { policy: 'fingerprint' },
    ios: { ...base.ios, bundleIdentifier: 'com.jackroseman.pushupcounter.dev' },
    android: { ...base.android, package: 'com.jackroseman.pushupcounter.dev' },
  };
};
