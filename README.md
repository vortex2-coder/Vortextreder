# Northstar Markets

A local starter website for a Deriv-powered trading app.

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

The callback route is only a placeholder at this stage. It does not exchange
authorization codes, store tokens, connect a Deriv account, or place trades.
Implement the OAuth Authorization Code flow with PKCE and server-side token
exchange before enabling sign-in. Keep credentials and tokens out of source
control and browser logs.

The app registration form's trade markup is separate from partner/referral
commissions. Confirm the applicable Deriv terms and earnings model before
choosing a markup or requesting account scopes. This local URL is for
development; production OAuth requires a deployed HTTPS site and its exact
callback URL registered with Deriv.
