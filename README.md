# Vortextreder

A Deriv OAuth-connected Options trading site with per-user account selection,
live quotes, and explicit order confirmation.

## Run locally

From this folder, run:

```powershell
node server.js
```

Open `http://localhost:4173` to view the site. The local server creates a
temporary in-memory session-encryption key at startup. Restarting the server
invalidates local sessions. Real OAuth uses the deployed HTTPS callback:

```text
https://vortextreder.vercel.app/callback
```

The OAuth callback validates state and PKCE, exchanges the short-lived code
server-side, and stores the access token only in an encrypted, short-lived
HttpOnly cookie. The site requests `trade account_manage`; account data is
restricted to the consenting user's own Deriv Options accounts. The app owner
cannot view or manage other users' accounts.

For Vercel, configure `SESSION_ENCRYPTION_KEY` in Project Settings → Environment
Variables before users sign in. Generate a unique 32-byte key locally with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Add the output as a Production environment variable in Vercel, then redeploy.
Do not put the generated value in source control, a URL, or a support message.
Sessions expire within 55 minutes; users can sign in again after expiry. The
site does not retain refresh tokens or use a persistent user database.

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

## Account access and trading

Each user starts from Vortextreder and chooses **Connect my Deriv account**.
Deriv handles that user's sign-in and authorization, then redirects back to the
registered callback. Signing in to Deriv directly does not start this redirect
flow. After authorization, users can select their own demo or real Options
account; demo is selected by default when available. The account ID is shown
with the selected account so users can verify it before requesting a quote.

If Deriv is already signed in to the wrong profile in the same browser, sign
out of Vortextreder and Deriv, then start the connection again from
Vortextreder. Each browser session is associated with the Deriv profile that
authorized it; the app does not choose or switch Deriv identities on a user's
behalf.

The site requests a single-use OTP from Deriv and opens the returned
authenticated WebSocket directly, without sending the user's access token to
browser code.

## Trading terminal tools

After connecting, the terminal provides:

- **Digit lab:** live tick stream, rolling last-digit frequencies, parity and
  threshold summaries, recent digit stream, and a price trace. These summarize
  observed data and are not forecasts.
- **Strategy library and builder:** manual Rise/Fall templates and locally
  saved ticket settings. Loading a template only fills the manual ticket; it
  never runs or submits an order.
- **Replay lab:** a simple adjacent-tick direction comparison using ticks
  observed in the current browser session. It is not an Options contract
  backtest and does not estimate payouts or profit.
- **Risk planner:** estimates a stake ladder and session limits from values the
  user enters. The selected account balance can be copied into the form, but
  the estimates do not prevent losses.
- **Guides:** account connection, market statistics, manual quotes, and risk
  notes.

Market tools use a public Deriv tick stream. They are not connected to an
unattended order engine. The only order path remains the existing manual quote
and explicit confirmation flow. Vortextreder does not accept customer API
tokens for copy trading or mirror trades between customer accounts.

The trade panel currently offers Rise/Fall (`CALL`/`PUT`) quotes in ticks for
live, open markets. It displays Deriv's quote and maximum purchase price before
an order is possible. Every order requires a separate click; real-account orders
also show a clear real-money confirmation. The registered 3% markup is
configured in the Deriv app and is disclosed in the quote/order flow. No trades
are placed by automated tests.

The session cookie is encrypted using AES-256-GCM, is HttpOnly, SameSite=Lax,
and Secure in production. Mutating API requests require the site's Origin.
Signing out clears the Vortextreder session; users can revoke the app's OAuth
access from their Deriv account settings. This first version does not include
automatic token refresh, contract closing, or app-owner access to customer
accounts.

The client ID is public; no client secret is stored in the repository. A real
OAuth test requires the deployed HTTPS site, the registered redirect URL, and
the Vercel environment variable above.

Run the local server with `node server.js`, then run the focused checks with:

```powershell
node --test test
```

Tests mock Deriv's OAuth and account endpoints. They do not require a Deriv
login and never place a trade.
