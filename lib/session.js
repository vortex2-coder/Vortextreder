const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto");

const cookieName = "vortextreder_session";
const cookieValueLimit = 3500;

function getSessionKey(value = process.env.SESSION_ENCRYPTION_KEY) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("SESSION_ENCRYPTION_KEY is not configured.");
  }

  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error("SESSION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function sealSession(accessToken, expiresIn, key, now = Date.now()) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const expiresAt = now + expiresIn * 1000;
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ accessToken, expiresAt }), "utf8"),
    cipher.final(),
  ]);
  const value = [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
  if (value.length > cookieValueLimit) {
    throw new Error("The encrypted Deriv session is too large to store safely.");
  }

  const maxAge = Math.min(expiresIn, 3300);
  return {
    value,
    maxAge,
    expiresAt: now + maxAge * 1000,
  };
}

function readSession(request, key, now = Date.now()) {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== "string") return null;

  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!raw || raw.length > cookieValueLimit) return null;

  const [version, nonceValue, tagValue, ciphertextValue, extra] = raw.split(".");
  if (version !== "v1" || !nonceValue || !tagValue || !ciphertextValue || extra) return null;

  try {
    const nonce = Buffer.from(nonceValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) return null;

    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const session = JSON.parse(plaintext.toString("utf8"));
    if (
      typeof session.accessToken !== "string" ||
      !session.accessToken ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= now
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge, secure) {
  return [
    `${cookieName}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clearedSessionCookie(secure) {
  return [
    `${cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

module.exports = {
  clearedSessionCookie,
  cookieName,
  getSessionKey,
  readSession,
  sealSession,
  sessionCookie,
};
