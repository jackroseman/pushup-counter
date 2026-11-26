// node scripts/render.js [outDir]
// Writes public/index.html from lib/render.js, and (with outDir) every invite page variant as HTML
// for previews: iPhone with a name, without a name, not on iPhone, link doesn't work, App Store.
/* global __dirname */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { renderInvitePage, renderHome } = require('../lib/render');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const SUNNY = { status: 'ok', inviter: { username: 'sunny', displayName: 'Sunny' } };
const ORIGIN = 'https://reproyale.vercel.app';

const VARIANTS = [
  { id: 'landing', userAgent: IPHONE, preview: SUNNY },
  { id: 'landing-no-name', userAgent: IPHONE, preview: { status: 'unknown', inviter: null } },
  { id: 'invalid', userAgent: IPHONE, preview: { status: 'invalid', inviter: null } },
  { id: 'not-iphone', userAgent: DESKTOP, preview: SUNNY },
  { id: 'landing-appstore', userAgent: IPHONE, preview: SUNNY, cfg: { ...config, APP_STORE_URL: 'https://apps.apple.com/app/id6829467517' } },
];

async function renderAll() {
  const out = [];
  for (const v of VARIANTS) {
    const r = await renderInvitePage({ code: 'k7m2qx9p', origin: ORIGIN, userAgent: v.userAgent, preview: v.preview, cfg: v.cfg });
    out.push({ ...v, ...r });
  }
  return out;
}

if (require.main === module) {
  (async () => {
    const root = path.join(__dirname, '..');
    fs.writeFileSync(path.join(root, 'public', 'index.html'), renderHome());
    const dir = process.argv[2];
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      for (const v of await renderAll()) fs.writeFileSync(path.join(dir, `${v.id}.html`), v.html);
      console.log(`wrote ${VARIANTS.length} pages to ${dir}`);
    }
  })();
}

module.exports = { renderAll, VARIANTS, IPHONE, DESKTOP };
