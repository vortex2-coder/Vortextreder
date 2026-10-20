# Vortextreder

A starter website for a Deriv-powered trading app.

## Run locally

From this folder, run:

```powershell
node server.js
```

Open `http://localhost:4173` to view the site. Register this exact OAuth redirect
URL in the Deriv API dashboard:

```text
http://localhost:4173/callback
```

The OAuth callback validates state and PKCE, then exchanges the short-lived
authorization code from a Vercel function. The current prototype deliberately
discards the returned tokens; it does not persist credentials, maintain a
signed-in session, or place trades.

The app registration form's trade markup is separate from partner/referral
commissions. Confirm the applicable Deriv terms and earnings model before
choosing a markup or requesting account scopes. The localhost URL is for
development only.

## Deploy to Vercel

Import `https://github.com/vortex2-coder/Vortextreder` in Vercel. This is a
static site; use the repository root as the project root and leave the build
command and output directory empty. `vercel.json` rewrites `/callback` to the
site entry page and adds security headers.

After the first successful deployment, use the assigned HTTPS deployment URL to
form the callback URL:

```text
https://YOUR-VERCEL-DOMAIN/callback
```

Register that exact URL with Deriv. The current deployment is configured for
`https://vortextreder.vercel.app/callback`. Do not expose tokens or authorization
codes in source control or browser logs.

## OAuth test

The site uses Deriv's OAuth Authorization Code flow with PKCE. The client ID is
public; no client secret is stored in the repository. The callback sends the
authorization code and PKCE verifier to `/api/oauth/token`, which exchanges
them with Deriv and returns only a success result. Access and refresh tokens
are intentionally discarded. This validates sign-in only and does not enable
trading; real account features need a secure session and token lifecycle design.

Run the local server with `node server.js`, then run the focused checks with:

```powershell
node --test test/oauth-token.test.js
```

Local tests mock Deriv's token endpoint. A real OAuth approval test must use the
deployed HTTPS site and the registered callback URL.
