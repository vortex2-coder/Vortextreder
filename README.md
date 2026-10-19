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

The local callback route is only a placeholder. It does not exchange
authorization codes, store tokens, connect a Deriv account, or place trades.
Implement the OAuth Authorization Code flow with PKCE and server-side token
exchange before enabling sign-in. Keep credentials and tokens out of source
control and browser logs.

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

Register that exact URL with Deriv. The callback is currently a placeholder: it
does not exchange authorization codes, store tokens, connect accounts, or place
trades. A Vercel serverless function will be needed for server-side token
exchange; never expose client secrets or tokens in source control or browser
logs.
