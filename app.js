const callbackMessage = document.querySelector("#callback-message");

if (window.location.pathname === "/callback") {
  const params = new URLSearchParams(window.location.search);
  const hasAuthorizationResponse =
    params.has("code") || params.has("error") || params.has("state");

  callbackMessage.hidden = false;
  callbackMessage.textContent = hasAuthorizationResponse
    ? "Deriv returned to this callback URL. OAuth token handling is not configured yet; no account was connected."
    : "Callback route is ready. After registering your app, Deriv can redirect back here.";

  if (hasAuthorizationResponse) {
    window.history.replaceState(null, "", "/callback");
  }
}
