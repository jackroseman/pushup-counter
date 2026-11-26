/**
 * PREVIEW BUILD ONLY. expo-apple-authentication has no web implementation, so the preview shows
 * a stand-in for Apple's white Sign in with Apple button, and signing in hands the mock backend
 * a fake token (it answers every auth call with the preview session).
 */
import React from 'react';
import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export enum AppleAuthenticationScope {
  FULL_NAME = 0,
  EMAIL = 1,
}
export enum AppleAuthenticationButtonType {
  SIGN_IN = 0,
  CONTINUE = 1,
  SIGN_UP = 2,
}
export enum AppleAuthenticationButtonStyle {
  WHITE = 0,
  WHITE_OUTLINE = 1,
  BLACK = 2,
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export async function signInAsync(): Promise<{ identityToken: string; fullName: null; user: string }> {
  return { identityToken: 'preview', fullName: null, user: 'preview' };
}

export function AppleAuthenticationButton({
  onPress,
  style,
  cornerRadius = 28,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  cornerRadius?: number;
  buttonType?: AppleAuthenticationButtonType;
  buttonStyle?: AppleAuthenticationButtonStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Sign in with Apple"
      style={[{ backgroundColor: '#FFFFFF', borderRadius: cornerRadius, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, style]}
    >
      <Svg width={17} height={20} viewBox="0 0 17 21">
        <Path
          d="M14.1 11.1c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9C3.5 5.3 1.9 6.3 1 7.9c-1.9 3.2-.5 8 1.3 10.6.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.4zM11.5 3.3c.7-.9 1.2-2 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z"
          fill="#000000"
        />
      </Svg>
      <Text style={{ color: '#000000', fontSize: 19, fontWeight: '600' }}>Sign in with Apple</Text>
    </Pressable>
  );
}
