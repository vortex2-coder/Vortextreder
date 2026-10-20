const test = require("node:test");
const assert = require("node:assert/strict");
const { createTokenHandler } = require("../api/oauth/token");
const { getSessionKey, readSession } = require("../lib/session");

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

function createRequest({ method = "POST", origin = "https://app.example", body } = {}) {
  return { method, headers: { origin }, body };
}

const config = {
  expectedClientId: "test-client",
  expectedRedirectUri: "https://app.example/callback",
  tokenUrl: "https://auth.example/oauth2/token",
  sessionKey: Buffer.alloc(32, 7).toString("base64"),
};
const validBody = {
  code: "one-time-code",
  code_verifier: "a".repeat(43),
};

test("rejects requests from a different or missing origin", async () => {
  const handler = createTokenHandler(config);
  const response = createResponse();

  await handler(createRequest({ origin: "https://attacker.example", body: validBody }), response);

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "Request origin is not allowed.");
});

test("rejects missing, malformed, or non-POST requests", async () => {
  const handler = createTokenHandler(config);
  const getResponse = createResponse();
  await handler(createRequest({ method: "GET" }), getResponse);
  assert.equal(getResponse.statusCode, 405);
  assert.equal(getResponse.headers.Allow, "POST");

  const invalidResponse = createResponse();
  await handler(createRequest({ body: { code: "x", code_verifier: "short" } }), invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
});

test("exchanges the code and stores tokens only in an encrypted HttpOnly cookie", async () => {
  let upstreamRequest;
  const handler = createTokenHandler({
    ...config,
    fetchImpl: async (url, options) => {
      upstreamRequest = { url, options };
      return {
        ok: true,
        json: async () => ({
          access_token: "sensitive-access-token",
          refresh_token: "sensitive-refresh-token",
        }),
      };
    },
  });
  const response = createResponse();

  await handler(createRequest({ body: validBody }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    authenticated: true,
    message:
      "Deriv is connected. Your access token is encrypted in a short-lived, HttpOnly session.",
  });
  assert.equal(JSON.stringify(response.body).includes("sensitive"), false);
  assert.match(response.headers["Set-Cookie"], /HttpOnly/);
  assert.match(response.headers["Set-Cookie"], /SameSite=Lax/);
  assert.equal(response.headers["Set-Cookie"].includes("sensitive-access-token"), false);
  const cookie = response.headers["Set-Cookie"].split(";")[0];
  assert.equal(
    readSession({ headers: { cookie } }, getSessionKey(config.sessionKey)).accessToken,
    "sensitive-access-token",
  );
  assert.equal(upstreamRequest.url, config.tokenUrl);
  assert.equal(upstreamRequest.options.method, "POST");
  assert.equal(
    upstreamRequest.options.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  assert.deepEqual(Object.fromEntries(upstreamRequest.options.body), {
    grant_type: "authorization_code",
    client_id: config.expectedClientId,
    code: validBody.code,
    code_verifier: validBody.code_verifier,
    redirect_uri: config.expectedRedirectUri,
  });
});

test("returns a safe error when Deriv rejects the exchange", async () => {
  const handler = createTokenHandler({
    ...config,
    fetchImpl: async () => ({ ok: false, json: async () => ({ error: "private provider detail" }) }),
  });
  const response = createResponse();

  await handler(createRequest({ body: validBody }), response);

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, { error: "Deriv could not complete sign-in." });
});

test("rejects a successful but malformed token response", async () => {
  const handler = createTokenHandler({
    ...config,
    fetchImpl: async () => ({ ok: true, json: async () => ({ token_type: "Bearer" }) }),
  });
  const response = createResponse();

  await handler(createRequest({ body: validBody }), response);

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, { error: "Deriv returned an invalid token response." });
});

test("does not consume an OAuth code if secure session configuration is missing", async () => {
  let exchanged = false;
  const handler = createTokenHandler({
    ...config,
    sessionKey: "",
    fetchImpl: async () => {
      exchanged = true;
      throw new Error("Should not exchange");
    },
  });
  const response = createResponse();

  await handler(createRequest({ body: validBody }), response);

  assert.equal(response.statusCode, 503);
  assert.equal(exchanged, false);
});
