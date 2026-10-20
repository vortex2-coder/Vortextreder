const { redirectUri } = require("../oauth-config");
const {
  clearedSessionCookie,
  getSessionKey,
  readSession,
} = require("../lib/session");

const accountsEndpoint = "https://api.derivws.com/trading/v1/options/accounts";
const localOrigins = new Set([
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
  response.end(JSON.stringify(body));
}

function normalizeAccounts(body) {
  const accounts = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.data?.accounts)
      ? body.data.accounts
      : Array.isArray(body?.accounts)
        ? body.accounts
        : null;
  if (!accounts) return null;

  const normalized = [];
  for (const account of accounts) {
    const id = account?.account_id ?? account?.id;
    const type = String(account?.account_type ?? account?.type ?? "").toLowerCase();
    const currency = account?.currency;
    const status = String(account?.status ?? "").toLowerCase();
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 128 ||
      !["demo", "real"].includes(type) ||
      typeof currency !== "string" ||
      currency.length === 0 ||
      !["active", "inactive"].includes(status)
    ) {
      return null;
    }

    const result = { id, type, currency, status };
    const balance = account.balance?.balance ?? account.balance;
    if (typeof balance === "number" && Number.isFinite(balance)) {
      result.balance = balance;
    }
    normalized.push(result);
  }
  return normalized;
}

function createAccountHandler({
  fetchImpl = fetch,
  expectedRedirectUri = redirectUri,
  sessionKey,
  accountsUrl = accountsEndpoint,
  secureCookies = process.env.NODE_ENV === "production",
} = {}) {
  const allowedOrigins = new Set([new URL(expectedRedirectUri).origin]);
  if (process.env.NODE_ENV !== "production") {
    for (const origin of localOrigins) allowedOrigins.add(origin);
  }

  async function getAccounts(accessToken) {
    const upstream = await fetchImpl(accountsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) throw new Error("Deriv could not load the linked accounts.");
    const body = await upstream.json();
    const accounts = normalizeAccounts(body);
    if (!accounts) throw new Error("Deriv returned an invalid account list.");
    return accounts;
  }

  return async function accountHandler(request, response) {
    if (!["GET", "POST", "DELETE"].includes(request.method)) {
      response.setHeader("Allow", "GET, POST, DELETE");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const origin = request.headers.origin;
    if (
      (request.method !== "GET" && (!origin || !allowedOrigins.has(origin))) ||
      (origin && !allowedOrigins.has(origin))
    ) {
      sendJson(response, 403, { error: "Request origin is not allowed." });
      return;
    }

    let encryptionKey;
    try {
      encryptionKey = getSessionKey(sessionKey);
    } catch {
      sendJson(response, 503, {
        error: "Secure account access is not configured on this site yet.",
      });
      return;
    }

    if (request.method === "DELETE") {
      response.setHeader("Set-Cookie", clearedSessionCookie(secureCookies));
      sendJson(response, 200, { signedOut: true });
      return;
    }

    const session = readSession(request, encryptionKey);
    if (!session) {
      sendJson(response, 401, { error: "Please connect your Deriv account." });
      return;
    }

    try {
      if (request.method === "GET") {
        const accounts = await getAccounts(session.accessToken);
        sendJson(response, 200, { authenticated: true, accounts });
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
      const accountId = body?.account_id;
      if (typeof accountId !== "string" || accountId.length === 0 || accountId.length > 128) {
        sendJson(response, 400, { error: "Select a valid Deriv account." });
        return;
      }

      const accounts = await getAccounts(session.accessToken);
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        sendJson(response, 403, { error: "That account is not linked to this Deriv session." });
        return;
      }

      const otpEndpoint = `${accountsUrl}/${encodeURIComponent(account.id)}/otp`;
      const upstream = await fetchImpl(otpEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok) {
        sendJson(response, 502, { error: "Deriv could not open a trading connection." });
        return;
      }

      const otpResponse = await upstream.json();
      const websocketUrl = otpResponse?.data?.url ?? otpResponse?.url;
      let parsedUrl;
      try {
        parsedUrl = new URL(websocketUrl);
      } catch {
        parsedUrl = null;
      }
      if (
        !parsedUrl ||
        parsedUrl.protocol !== "wss:" ||
        parsedUrl.hostname !== "api.derivws.com" ||
        !/^\/trading\/v1\/options\/ws\/(demo|real)$/.test(parsedUrl.pathname)
      ) {
        sendJson(response, 502, { error: "Deriv returned an invalid trading connection." });
        return;
      }

      sendJson(response, 200, {
        websocket_url: parsedUrl.toString(),
        account: { id: account.id, type: account.type, currency: account.currency },
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        sendJson(response, 504, { error: "Deriv did not respond in time. Please try again." });
        return;
      }
      sendJson(response, 502, {
        error:
          error instanceof Error && error.message === "Deriv could not load the linked accounts."
            ? error.message
            : "Deriv account access is temporarily unavailable.",
      });
    }
  };
}

module.exports = createAccountHandler();
module.exports.createAccountHandler = createAccountHandler;
module.exports.normalizeAccounts = normalizeAccounts;
