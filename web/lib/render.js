// The invite page's HTML. Pure (no network): api/invite.js fetches who the invite is from and
// calls renderInvitePage; scripts/render.js uses the same function for previews and checks.
const QRCode = require('qrcode');
const config = require('../config');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const name = (inviter) => (inviter ? inviter.displayName || inviter.username : null);

/** iPhone (and iPad, which runs iPhone apps); everything else gets the "on iPhone" page. */
function isIOS(userAgent = '') {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && /Mobile\//.test(userAgent));
}

const ICON = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="Rep Royale"><rect width="120" height="120" rx="27" fill="#000"/><rect x=".75" y=".75" width="118.5" height="118.5" rx="26.5" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/><path d="M33 42l13 8 14-15 14 15 13-8" stroke="#fff" stroke-width="3.2" fill="none" stroke-linejoin="round" stroke-linecap="round"/><text x="60" y="86" text-anchor="middle" font-family="-apple-system,Inter,system-ui,sans-serif" font-weight="800" font-size="36" letter-spacing="-1.5" fill="#fff">RR</text></svg>`;
const COPY = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="3" stroke="#fff" stroke-width="2.2" fill="none"/><path d="M16 5.5A2.5 2.5 0 0 0 13.5 3H6a3 3 0 0 0-3 3v7.5A2.5 2.5 0 0 0 5.5 16" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`;
const APPLE = `<svg width="17" height="20" viewBox="0 0 17 21" aria-hidden="true"><path d="M14.1 11.1c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9C3.5 5.3 1.9 6.3 1 7.9c-1.9 3.2-.5 8 1.3 10.6.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.4zM11.5 3.3c.7-.9 1.2-2 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z" fill="#000"/></svg>`;

const avatar = (n, size) =>
  `<div class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px" aria-hidden="true">${esc(n.trim().charAt(0).toUpperCase() || '?')}</div>`;

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
html{background:#000;color:#fff;-webkit-text-size-adjust:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;font-size:17px;line-height:22px;min-height:100vh}
main{max-width:430px;margin:0 auto;padding:0 24px 40px}
.hero{display:flex;justify-content:center;margin-top:66px}
.pair{position:relative;width:166px;height:84px}.pair .ic{position:absolute;left:0;top:0}.pair .who{position:absolute;right:0;top:0;border:4px solid #000;border-radius:50%}
.solo{display:flex;justify-content:center;margin-top:120px}
.av{border-radius:50%;background:#2C2C2E;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600}
h1{font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.025em;text-align:center;margin-top:18px}
.lead{font-size:16px;line-height:22px;color:rgba(235,235,245,.6);text-align:center;margin-top:6px}
.steps{list-style:none;margin-top:20px;background:#111113;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:4px 0}
.step{display:flex;gap:14px;align-items:flex-start;padding:12px 16px}.step+.step{border-top:1px solid rgba(255,255,255,.1)}
.sn{width:26px;height:26px;border-radius:13px;background:#2C2C2E;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex:none;margin-top:1px}
.st{flex:1;min-width:0}.st b{display:block;font-size:16px;line-height:21px;font-weight:600}.st span{display:block;font-size:13px;line-height:18px;color:rgba(235,235,245,.6);margin-top:2px}
.sb{display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 16px;border-radius:999px;font-size:15px;font-weight:600;margin-top:10px;text-decoration:none;color:#fff;background:#2C2C2E}
.sb.primary{background:#fff;color:#000}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;height:56px;border-radius:999px;font-size:17px;font-weight:600;text-decoration:none;width:100%;margin-top:16px;border:0}
.btn.primary{background:#fff;color:#000}.btn.gray{background:#1C1C1E;color:#fff}
.card{display:flex;align-items:center;gap:12px;margin-top:10px;padding:10px 16px;background:#111113;border:1px solid rgba(255,255,255,.1);border-radius:16px}
.card .grow{flex:1;min-width:0}.card small{display:block;font-size:13px;line-height:18px;color:rgba(235,235,245,.6)}.card strong{font-size:17px;font-weight:600}
.card button{background:none;border:0;padding:8px;margin:-8px;cursor:pointer;display:flex}
.note{font-size:12px;line-height:16px;color:rgba(235,235,245,.6);text-align:center;margin-top:12px}
.qr{margin:28px auto 0;width:200px;height:200px;border-radius:24px;background:#fff;display:flex;align-items:center;justify-content:center}.qr svg{width:164px;height:164px}
.handle{font-size:17px;font-weight:600;text-align:center;margin-top:18px}
.copied{color:#30D158;font-size:13px;font-weight:600}`;

function page({ title, description, url, body, noindex = true }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Rep Royale">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${url ? `<meta property="og:url" content="${esc(url)}">\n` : ''}<meta property="og:image" content="/icon-512.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta name="twitter:card" content="summary">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" href="/icon-512.png">
<style>${CSS}</style>
</head>
<body><main>${body}</main></body>
</html>
`;
}

const copyScript = `<script>
document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b)return;
navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){var l=document.getElementById('copy-label');if(l){l.textContent='Copied';l.className='copied';}});});
</script>`;

const fallbackCard = (inviter) =>
  inviter
    ? `<div class="card"><div class="grow"><small>Or search for ${esc(name(inviter))} in the app</small><strong>@${esc(inviter.username)}</strong> <span id="copy-label"></span></div><button type="button" data-copy="${esc(inviter.username)}" aria-label="Copy username">${COPY}</button></div>`
    : '';

/**
 * @param {{ code: string, origin: string, userAgent?: string, preview: { status: 'ok'|'invalid'|'unknown', inviter: {username:string, displayName:string|null}|null } }} p
 * @returns {Promise<{ status: number, html: string }>}
 */
async function renderInvitePage({ code, origin, userAgent = '', preview, cfg = config }) {
  const url = `${origin}/i/${code}`;
  const inviter = preview.status === 'ok' ? preview.inviter : null;
  const who = name(inviter);

  if (preview.status === 'invalid') {
    const body = `<div class="solo">${ICON(84)}</div>
<h1 style="margin-top:24px">This invite link<br>doesn't work</h1>
<p class="lead" style="margin-top:10px">Ask your friend for a new link. You can still get Rep Royale and find them by username.</p>
${installSteps(cfg, null)}`;
    return { status: 404, html: page({ title: 'Rep Royale', description: 'Push-ups every day. Your phone counts every rep.', body }) };
  }

  const title = who ? `${who} invited you to Rep Royale` : "You're invited to Rep Royale";
  const description = 'Push-ups every day. Your phone counts every rep.';
  const hero = who
    ? `<div class="hero"><div class="pair"><div class="ic">${ICON(84)}</div><div class="who">${avatar(who, 76)}</div></div></div>`
    : `<div class="hero">${ICON(84)}</div>`;
  const heading = who ? `${esc(who)} invited you<br>to Rep Royale` : `You're invited<br>to Rep Royale`;

  if (!isIOS(userAgent)) {
    const qr = await QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#000000', light: '#ffffff' } });
    const body = `${hero}
<h1 style="margin-top:22px">Rep Royale is on iPhone</h1>
<p class="lead" style="margin-top:10px">${who ? `${esc(who)} invited you. ` : ''}Open this link on an iPhone to join, or scan the code.</p>
<div class="qr" role="img" aria-label="QR code of this invite link">${qr}</div>
${inviter ? `<p class="handle">@${esc(inviter.username)}</p>` : ''}`;
    return { status: 200, html: page({ title, description, url, body }) };
  }

  const body = `${hero}
<h1>${heading}</h1>
<p class="lead">${description}</p>
${installSteps(cfg, who, code)}
${fallbackCard(inviter)}
<p class="note">Needs an iPhone with Face ID and iOS 26 or later.</p>
${inviter ? copyScript : ''}`;
  return { status: 200, html: page({ title, description, url, body }) };
}

/** The numbered steps. TestFlight while the app is in beta; the App Store once APP_STORE_URL is set. */
function installSteps(cfg, who, code) {
  const open = code ? `${cfg.APP_SCHEME}://i/${code}` : null;
  const add = who ? `to add ${esc(who)}` : 'to add your friend';
  if (cfg.APP_STORE_URL) {
    return `<ol class="steps">
<li class="step"><div class="sn">1</div><div class="st"><b>Get Rep Royale</b><span>Free on the App Store.</span><a class="sb primary" href="${esc(cfg.APP_STORE_URL)}">${APPLE}&nbsp;App Store</a></div></li>
${open ? `<li class="step"><div class="sn">2</div><div class="st"><b>Open this invite link again</b><span>Tap it again in Messages, or tap Open Rep Royale, ${add}.</span></div></li>` : ''}
</ol>${open ? `\n<a class="btn gray" href="${esc(open)}">Open Rep Royale</a>` : ''}`;
  }
  return `<ol class="steps">
<li class="step"><div class="sn">1</div><div class="st"><b>Get TestFlight</b><span>Apple's free app for trying apps before they're in the App Store.</span><a class="sb" href="${esc(cfg.TESTFLIGHT_APP_URL)}">Get TestFlight</a></div></li>
<li class="step"><div class="sn">2</div><div class="st"><b>Join the beta</b><span>Then tap Accept and Install in TestFlight.</span><a class="sb primary" href="${esc(cfg.TESTFLIGHT_JOIN_URL)}">Join the beta</a></div></li>
${open ? `<li class="step"><div class="sn">3</div><div class="st"><b>Open this invite link again</b><span>Tap it again in Messages, or tap Open Rep Royale, ${add}.</span></div></li>` : ''}
</ol>${open ? `\n<a class="btn gray" href="${esc(open)}">Open Rep Royale</a>` : ''}`;
}

function renderHome() {
  const body = `<div class="solo">${ICON(96)}</div>
<h1 style="margin-top:24px">Rep Royale</h1>
<p class="lead">Push-ups every day. Your phone counts every rep.</p>
${installSteps(config, null)}`;
  return page({ title: 'Rep Royale', description: 'Push-ups every day. Your phone counts every rep.', body, noindex: false });
}

module.exports = { renderInvitePage, renderHome, isIOS, esc };
