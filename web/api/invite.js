// GET /i/<code> (rewritten here by vercel.json). Server-rendered so link previews in Messages get
// the person's name in og:title.
const config = require('../config');
const { fetchPreview } = require('../lib/preview');
const { renderInvitePage } = require('../lib/render');

module.exports = async function handler(req, res) {
  const raw = String((req.query && req.query.code) || '').trim().toLowerCase();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'reproyale.vercel.app';
  const origin = `https://${host}`;
  const preview = config.CODE.test(raw) ? await fetchPreview(raw) : { status: 'invalid', inviter: null };
  const { status, html } = await renderInvitePage({ code: raw, origin, userAgent: req.headers['user-agent'] || '', preview });
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  // Short CDN cache: a reset link should stop showing the name soon. Vary by device type.
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('vary', 'user-agent');
  res.end(html);
};
