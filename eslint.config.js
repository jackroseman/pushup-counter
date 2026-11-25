// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions is Deno code (URL / npm: imports), checked by the Supabase deploy.
    ignores: ['dist/*', 'supabase/functions/**', 'modules/*/build/**'],
  },
  {
    rules: {
      // A web (HTML) rule: React Native <Text> renders quotes and apostrophes literally.
      'react/no-unescaped-entities': 'off',
      // React Compiler diagnostics. The app does not use the React Compiler, so these are
      // shown as warnings (things to clean up) rather than failing CI. Make them errors
      // again before turning the compiler on (expo.experiments.reactCompiler).
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]);
