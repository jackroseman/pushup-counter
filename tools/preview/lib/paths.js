/* global __dirname */
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const PREVIEW = path.resolve(__dirname, '..');
const OUT = process.env.PREVIEW_OUT ? path.resolve(process.env.PREVIEW_OUT) : path.join(PREVIEW, 'out');

module.exports = {
  ROOT,
  PREVIEW,
  OUT,
  WEB: path.join(OUT, 'web'),
  /** Fake Supabase project baked into the preview build. Every request to it is answered by mock/backend.js. */
  SUPABASE_URL: 'https://rr-preview.supabase.co',
  SUPABASE_ANON_KEY: 'preview-anon-key',
  /** supabase-js stores the session under sb-<project ref>-auth-token. */
  AUTH_STORAGE_KEY: 'sb-rr-preview-auth-token',
};
