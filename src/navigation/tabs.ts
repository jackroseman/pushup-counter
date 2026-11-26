import { Platform } from 'react-native';

/**
 * Native iOS tab bar (react-native-screens Tabs via @react-navigation/bottom-tabs/unstable, already in the
 * dev build) vs the JS tab bar. Flipping it is a JS-only change (OTA, no build). Web and Android always
 * use the JS tab bar: the native navigator throws off iOS.
 */
export const NATIVE_TABS = false;

export const nativeTabBar = NATIVE_TABS && Platform.OS === 'ios';
