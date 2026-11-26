# web/ — invite page and apple-app-site-association

Serves `https://reproyale.vercel.app`:

- `/i/<code>` — the friend invite page (server-rendered by `api/invite.js`, so Messages link
  previews show the inviter's name). On iPhone it shows three numbered steps (get TestFlight,
  join the beta, open the invite link again), an **Open Rep Royale** button
  (`pushupcounter://i/<code>`) and the `@username` fallback. Elsewhere it shows a QR code.
- `/.well-known/apple-app-site-association` and `/apple-app-site-association` — universal
  links for `/i/*`, for both the production and the dev app ids. Served as JSON, no redirect.
- `/` — a small home page (`public/index.html`, generated).

Not part of the app bundle or the EAS fingerprint. CI's `should-ship` ignores `web/**`, so a
web-only merge never publishes an OTA or starts a build.

## Config

All links live in `config.js` (TestFlight join link, TestFlight app, App Store link once
live, team and bundle ids). When `APP_STORE_URL` is set, the page switches to the App Store
variant.

Vercel environment variables (Project → Settings → Environment Variables):

| Name | Preview | Production |
| --- | --- | --- |
| `SUPABASE_URL` | staging URL | production URL |
| `SUPABASE_ANON_KEY` | staging anon key | production anon key |

Without them the page still works; it just leaves out the inviter's name. Only the
`friend_invite_preview` RPC is called (granted to `anon`).

## Commands

```sh
npm --prefix web ci
npm --prefix web run check    # AASA, HTML variants, links; CI and the Vercel build run this
npm --prefix web run render   # regenerate public/index.html after changing lib/render.js
npm --prefix tools/preview run capture:web   # screenshots into tools/preview/out/captures/web-invite/
```

## Vercel project

Root Directory `web`, framework "Other". `vercel.json` sets the build (`node scripts/check.js`),
the `/i/:code` rewrite, the AASA headers and an `ignoreCommand` that skips deploys when
nothing under `web/` changed. Pull requests get preview deployments; `main` deploys to
production (reproyale.vercel.app).
