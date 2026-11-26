// node scripts/check.js — run by CI (checks job) and as the Vercel build command.
// Validates apple-app-site-association, that public/index.html is up to date, and the invite
// page variants (titles, links, escaping).
/* global __dirname */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { renderHome, renderInvitePage } = require('../lib/render');
const { fetchPreview } = require('../lib/preview');
const { renderAll, IPHONE } = require('./render');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

(async () => {
  // AASA: same JSON at both paths, both app ids, /i/* only.
  const a = read('public/.well-known/apple-app-site-association');
  assert.equal(read('public/apple-app-site-association'), a, 'AASA copies differ');
  const aasa = JSON.parse(a);
  const ids = config.BUNDLE_IDS.map((b) => `${config.APPLE_TEAM_ID}.${b}`);
  assert.deepEqual(aasa.applinks.details[0].appIDs, ids, 'appIDs');
  assert.ok(aasa.applinks.details[0].components.some((c) => c['/'] === '/i/*'), 'components /i/*');
  for (const d of aasa.applinks.details) assert.ok(!d.appID || ids.includes(d.appID), 'legacy appID');
  assert.ok(/^[A-Z0-9]{10}$/.test(config.APPLE_TEAM_ID), 'team id');

  const vercel = JSON.parse(read('vercel.json'));
  const aasaHeaders = vercel.headers.filter((h) => /apple-app-site-association$/.test(h.source));
  assert.equal(aasaHeaders.length, 2, 'AASA headers');
  for (const h of aasaHeaders) assert.ok(h.headers.some((x) => x.key === 'Content-Type' && x.value === 'application/json'), 'AASA content type');
  assert.ok(!vercel.redirects, 'no redirects (AASA must be served without one)');

  assert.equal(read('public/index.html'), renderHome(), 'public/index.html is stale: run npm --prefix web run render');
  for (const f of ['public/icon-512.png', 'public/apple-touch-icon.png']) assert.ok(fs.statSync(path.join(root, f)).size > 1000, f);

  // Links used by the page.
  assert.match(config.TESTFLIGHT_JOIN_URL, /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+$/);
  assert.match(config.TESTFLIGHT_APP_URL, /^https:\/\/apps\.apple\.com\/app\/testflight\/id\d+$/);

  const pages = Object.fromEntries((await renderAll()).map((p) => [p.id, p]));
  const L = pages.landing.html;
  assert.equal(pages.landing.status, 200);
  assert.match(L, /<meta property="og:title" content="Sunny invited you to Rep Royale">/);
  assert.ok(L.includes(`href="${config.TESTFLIGHT_APP_URL}"`) && L.includes(`href="${config.TESTFLIGHT_JOIN_URL}"`), 'TestFlight links');
  assert.ok(L.includes('href="pushupcounter://i/k7m2qx9p"'), 'Open Rep Royale');
  assert.deepEqual([...L.matchAll(/<div class="sn">(\d)<\/div><div class="st"><b>([^<]+)<\/b>/g)].map((m) => `${m[1]} ${m[2]}`), [
    '1 Get TestFlight',
    '2 Join the beta',
    '3 Open this invite link again',
  ]);
  assert.match(L, /@sunny/);
  assert.match(pages['landing-no-name'].html, /You&#39;re invited to Rep Royale/);
  assert.equal(pages.invalid.status, 404);
  assert.match(pages.invalid.html, /doesn't work/);
  assert.ok(!pages.invalid.html.includes('pushupcounter://'), 'invalid page has no open link');
  assert.match(pages['not-iphone'].html, /Rep Royale is on iPhone/);
  assert.match(pages['not-iphone'].html, /<svg[^>]*viewBox/);
  assert.ok(pages['landing-appstore'].html.includes('apps.apple.com/app/id') && !pages['landing-appstore'].html.includes('testflight.apple.com/join'));

  // Names are escaped.
  const evil = await renderInvitePage({ code: 'k7m2qx9p', origin: 'https://x', userAgent: IPHONE, preview: { status: 'ok', inviter: { username: 'a', displayName: '<img onerror=x>"' } } });
  assert.ok(!evil.html.includes('<img onerror'), 'escaping');

  // No Supabase env: the page still renders without a name.
  assert.deepEqual(await fetchPreview('k7m2qx9p', {}), { status: 'unknown', inviter: null });
  const fake = async () => ({ ok: true, json: async () => ({ status: 'invalid' }) });
  assert.deepEqual(await fetchPreview('k7m2qx9p', { SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'k' }, fake), { status: 'invalid', inviter: null });

  console.log('web checks passed');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
