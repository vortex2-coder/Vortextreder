const test = require("node:test");
const assert = require("node:assert/strict");
const { createAccountHandler } = require("../api/account");
const { getSessionKey, sealSession, sessionCookie } = require("../lib/session");

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
}

const keyValue = Buffer.alloc(32, 3).toString("base64");
const key = getSessionKey(keyValue);
const accountList = {
  data: [
    { account_id: "VRTC123456", account_type: "demo", currency: "USD", status: "active", balance: 10000 },
    { account_id: "CR123456", account_type: "real", currency: "USD", status: "active", balance: 20 },
  ],
};
const accountsUrl = "https://api.example/options/accounts";
const config = {
  expectedRedirectUri: "https://app.example/callback",
  sessionKey: keyValue,
  accountsUrl,
};

function request({ method = "GET", origin = "https://app.example", accountId, cookie } = {}) {
  return {
    method,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    body: accountId ? { account_id: accountId } : undefined,
  };
}

function sessionCookieHeader() {
  const session = sealSession("encrypted-user-token", 3600, key);
  return sessionCookie(session.value, session.maxAge, false).split(";")[0];
}

test("returns only the authenticated user's own demo and real accounts", async () => {
  let authorization;
  const handler = createAccountHandler({
    ...config,
    fetchImpl: async (url, options) => {
      authorization = options.headers.Authorization;
      return { ok: true, json: async () => accountList };
    },
  });
  const response = createResponse();

  await handler(request({ cookie: sessionCookieHeader() }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(authorization, "Bearer encrypted-user-token");
  assert.deepEqual(response.body, {
    authenticated: true,
    accounts: [
      { id: "VRTC123456", type: "demo", currency: "USD", status: "active", balance: 10000 },
      { id: "CR123456", type: "real", currency: "USD", status: "active", balance: 20 },
    ],
  });
  assert.equal(JSON.stringify(response.body).includes("encrypted-user-token"), false);
});

test("refuses trading OTPs for account IDs not owned by the signed-in user", async () => {
  let otpRequested = false;
  const handler = createAccountHandler({
    ...config,
    fetchImpl: async (url) => {
      if (url.endsWith("/otp")) otpRequested = true;
      return { ok: true, json: async () => accountList };
    },
  });
  const response = createResponse();

  await handler(
    request({ method: "POST", accountId: "SOMEONE_ELSE", cookie: sessionCookieHeader() }),
    response,
  );

  assert.equal(response.statusCode, 403);
  assert.equal(otpRequested, false);
});

test("returns a validated, single-use Deriv WebSocket URL without exposing the access token", async () => {
  const calls = [];
  const handler = createAccountHandler({
    ...config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === accountsUrl) return { ok: true, json: async () => accountList };
      return {
        ok: true,
        json: async () => ({
          data: {
            url: "wss://api.derivws.com/trading/v1/options/ws/demo?otp=single-use",
          },
        }),
      };
    },
  });
  const response = createResponse();

  await handler(
    request({ method: "POST", accountId: "VRTC123456", cookie: sessionCookieHeader() }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    websocket_url: "wss://api.derivws.com/trading/v1/options/ws/demo?otp=single-use",
    account: { id: "VRTC123456", type: "demo", currency: "USD" },
  });
  assert.equal(calls[1].url, `${accountsUrl}/VRTC123456/otp`);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.Authorization, "Bearer encrypted-user-token");
});

test("rejects a trading request without a same-origin browser request", async () => {
  const handler = createAccountHandler({ ...config });
  const response = createResponse();

  await handler(
    request({ method: "POST", origin: "https://attacker.example", accountId: "VRTC123456" }),
    response,
  );

  assert.equal(response.statusCode, 403);
});

test("rejects malformed Deriv account data instead of returning a partial profile", async () => {
  const handler = createAccountHandler({
    ...config,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            account_id: "bad",
            account_type: "unknown",
            currency: "USD",
            status: "active",
            balance: 12,
          },
        ],
      }),
    }),
  });
  const response = createResponse();

  await handler(request({ cookie: sessionCookieHeader() }), response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error, "Deriv account access is temporarily unavailable.");
});
