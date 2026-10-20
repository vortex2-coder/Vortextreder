const callbackMessage = document.querySelector("#callback-message");
const connectButton = document.querySelector("#connect-deriv");
const authorizationEndpoint = "https://auth.deriv.com/oauth2/auth";
const clientId = "34ITCNI7twSLSA4jMqPRF";
const redirectUri = "https://vortextreder.vercel.app/callback";

function showMessage(message, isError = false) {
  callbackMessage.hidden = false;
  callbackMessage.textContent = message;
  callbackMessage.classList.toggle("is-error", isError);
}

async function startDerivAuthorization() {
  if (window.location.origin !== new URL(redirectUri).origin) {
    showMessage("Please open the deployed Vortextreder site to connect Deriv.", true);
    return;
  }

  if (!window.crypto || !window.crypto.subtle) {
    showMessage("This browser does not support secure OAuth sign-in.", true);
    return;
  }

  const randomBytes = new Uint8Array(32);
  window.crypto.getRandomValues(randomBytes);
  const codeVerifier = toBase64Url(randomBytes);
  const stateBytes = new Uint8Array(32);
  window.crypto.getRandomValues(stateBytes);
  const state = toBase64Url(stateBytes);
  const challengeDigest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = toBase64Url(new Uint8Array(challengeDigest));

  window.sessionStorage.setItem("deriv.oauth.state", state);
  window.sessionStorage.setItem("deriv.oauth.verifier", codeVerifier);

  const authorizationUrl = new URL(authorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "trade",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();

  window.location.assign(authorizationUrl);
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function handleDerivCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  const providerError = params.get("error");

  if (!code && !returnedState && !providerError) {
    showMessage("Callback route is ready. Start with “Connect Deriv” to test sign-in.");
    return;
  }

  window.history.replaceState(null, "", "/callback");
  const expectedState = window.sessionStorage.getItem("deriv.oauth.state");
  const codeVerifier = window.sessionStorage.getItem("deriv.oauth.verifier");
  window.sessionStorage.removeItem("deriv.oauth.state");
  window.sessionStorage.removeItem("deriv.oauth.verifier");

  if (providerError) {
    showMessage("Deriv sign-in was not completed. You can try again.", true);
    return;
  }

  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !codeVerifier) {
    showMessage("The Deriv sign-in response could not be verified. Please try again.", true);
    return;
  }

  try {
    const response = await fetch("/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: codeVerifier }),
      credentials: "same-origin",
      cache: "no-store",
    });
    const result = await response.json();

    if (!response.ok || result.authenticated !== true) {
      showMessage(result.error || "Deriv sign-in failed. Please try again.", true);
      return;
    }

    showMessage(result.message);
  } catch {
    showMessage("Could not contact the sign-in service. Please try again.", true);
  }
}

if (connectButton) {
  connectButton.addEventListener("click", () => {
    startDerivAuthorization().catch(() => {
      showMessage("Could not start Deriv sign-in. Please try again.", true);
    });
  });
}

if (window.location.pathname === "/callback") {
  handleDerivCallback();
}
