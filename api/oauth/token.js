const {
  clientId,
  redirectUri,
  tokenEndpoint,
} = require("../../oauth-config");
const { getSessionKey, sealSession, sessionCookie } = require("../../lib/session");

const allowedLocalOrigins = new Set([
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

function sendJson(response, statusCode, body) {
  response.setHeader("Cache-Control", "no-store");
  if (typeof response.status === "function") {
    response.status(statusCode).json(body);
    return;
  }

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function createTokenHandler({
  fetchImpl = fetch,
  expectedClientId = clientId,
  expectedRedirectUri = redirectUri,
  tokenUrl = tokenEndpoint,
  sessionKey,
  secureCookies = process.env.NODE_ENV === "production",
} = {}) {
  const allowedOrigins = new Set([new URL(expectedRedirectUri).origin]);
  if (process.env.NODE_ENV !== "production") {
    for (const origin of allowedLocalOrigins) allowedOrigins.add(origin);
  }

  return async function tokenHandler(request, response) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Request origin is not allowed." });
      return;
    }

    const body =
      typeof request.body === "string"
        ? (() => {
            try {
              return JSON.parse(request.body);
            } catch {
              return null;
            }
          })()
        : request.body;

    const code = body && body.code;
    const verifier = body && body.code_verifier;
    if (
      typeof code !== "string" ||
      code.length === 0 ||
      code.length > 4096 ||
      typeof verifier !== "string" ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
    ) {
      sendJson(response, 400, { error: "Invalid authorization response." });
      return;
    }

    let encryptionKey;
    try {
      encryptionKey = getSessionKey(sessionKey);
    } catch {
      sendJson(response, 503, {
        error: "Secure sign-in is not configured on this site yet. Please try again later.",
      });
      return;
    }

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: expectedClientId,
      code,
      code_verifier: verifier,
      redirect_uri: expectedRedirectUri,
    });

    try {
      const upstream = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(10000),
      });

      if (!upstream.ok) {
        sendJson(response, 502, { error: "Deriv could not complete sign-in." });
        return;
      }

      const tokenResponse = await upstream.json();
      if (
        !tokenResponse ||
        typeof tokenResponse.access_token !== "string" ||
        tokenResponse.access_token.length === 0
      ) {
        sendJson(response, 502, { error: "Deriv returned an invalid token response." });
        return;
      }

      const expiresIn =
        tokenResponse.expires_in === undefined ? 3600 : Number(tokenResponse.expires_in);
      if (!Number.isFinite(expiresIn) || expiresIn < 60) {
        sendJson(response, 502, { error: "Deriv returned an invalid token expiry." });
        return;
      }

      try {
        const session = sealSession(
          tokenResponse.access_token,
          Math.min(expiresIn, 3600),
          encryptionKey,
        );
        response.setHeader(
          "Set-Cookie",
          sessionCookie(session.value, session.maxAge, secureCookies),
        );
      } catch {
        sendJson(response, 502, {
          error: "A secure sign-in session could not be created. Please try again.",
        });
        return;
      }

      sendJson(response, 200, {
        authenticated: true,
        message: "Deriv is connected. Your access token is encrypted in a short-lived, HttpOnly session.",
      });
    } catch {
      sendJson(response, 502, { error: "Deriv sign-in is temporarily unavailable." });
    }
  };
}

const handler = createTokenHandler();
module.exports = handler;
module.exports.createTokenHandler = createTokenHandler;
