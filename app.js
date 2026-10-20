const callbackMessage = document.querySelector("#callback-message");
const connectButton = document.querySelector("#connect-deriv");
const authorizationEndpoint = "https://auth.deriv.com/oauth2/auth";
const clientId = "34ITCNI7twSLSA4jMqPRF";
const redirectUri = "https://vortextreder.vercel.app/callback";

const dashboard = document.querySelector("#account-dashboard");
const accountSelect = document.querySelector("#account-select");
const accountNote = document.querySelector("#account-note");
const currencyLabel = document.querySelector("#currency-label");
const marketSelect = document.querySelector("#market-select");
const marketStatus = document.querySelector("#market-status");
const quoteCard = document.querySelector("#quote-card");
const quoteButton = document.querySelector("#quote-button");
const buyButton = document.querySelector("#buy-button");
const tradeMessage = document.querySelector("#trade-message");
const realAccountWarning = document.querySelector("#real-account-warning");
const uncertainOrderWarning = document.querySelector("#uncertain-order-warning");
const resolveUncertainOrderButton = document.querySelector("#resolve-uncertain-order");

let accounts = [];
let activeSocket;
let activeAccountId;
let socketConnection;
let requestId = 0;
let currentQuote;
let quoteTimer;
let analysisSocket;
let observedTicks = [];
const pendingRequests = new Map();
let uncertainAccounts = new Set();
try {
  const storedUncertainAccounts = JSON.parse(
    window.sessionStorage.getItem("deriv.uncertain-order-accounts") || "[]",
  );
  if (Array.isArray(storedUncertainAccounts)) {
    uncertainAccounts = new Set(storedUncertainAccounts.filter((id) => typeof id === "string"));
  }
} catch {
  showMessage("This browser could not restore the pending-order safety state.", true);
}

function showMessage(message, isError = false) {
  callbackMessage.hidden = false;
  callbackMessage.textContent = message;
  callbackMessage.classList.toggle("is-error", isError);
}

function showTradeMessage(message, isError = false) {
  tradeMessage.hidden = false;
  tradeMessage.textContent = message;
  tradeMessage.classList.toggle("is-error", isError);
}

async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not contact the Vortextreder service. Please try again.");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The Vortextreder service returned an invalid response.");
  }

  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
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
    scope: "trade account_manage",
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
  if (!code && !returnedState && !providerError) return;

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
    const result = await requestJson("/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: codeVerifier }),
    });
    if (result.authenticated !== true) {
      showMessage("Deriv sign-in could not be verified. Please try again.", true);
      return;
    }
    showMessage(result.message);
    await loadAccounts();
  } catch (error) {
    showMessage(error.message, true);
  }
}

function selectedAccount() {
  return accounts.find((account) => account.id === accountSelect.value);
}

function resetQuote() {
  clearInterval(quoteTimer);
  quoteTimer = undefined;
  currentQuote = null;
  quoteCard.hidden = true;
  buyButton.disabled = true;
}

function setAccountDetails() {
  const account = selectedAccount();
  resetQuote();
  if (!account) {
    accountNote.textContent = "Choose an account to request quotes.";
    currencyLabel.textContent = "account currency";
    realAccountWarning.hidden = true;
    uncertainOrderWarning.hidden = true;
    quoteButton.disabled = true;
    return;
  }

  currencyLabel.textContent = account.currency;
  const typeLabel = account.type === "demo" ? "Demo account" : "Real account";
  const balanceText =
    typeof account.balance === "number"
      ? ` · Balance ${formatCurrency(account.balance, account.currency)}`
      : "";
  accountNote.textContent = `${typeLabel} · ${account.currency} · ${account.id}${balanceText}`;
  document.querySelector("#builder-currency").textContent = account.currency;
  document.querySelectorAll(".risk-currency").forEach((element) => {
    element.textContent = account.currency;
  });
  realAccountWarning.hidden = account.type !== "real";
  const accountIsLocked = uncertainAccounts.has(account.id);
  uncertainOrderWarning.hidden = !accountIsLocked;
  quoteButton.disabled = marketSelect.disabled || accountIsLocked;
  if (accountIsLocked) {
    buyButton.disabled = true;
    showTradeMessage(
      "An order on this account has an unknown outcome. Reconcile it in Deriv before unlocking further orders.",
      true,
    );
  }

  if (activeAccountId !== account.id) closeActiveSocket();
}

function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function setTerminalView(view) {
  const allowedViews = new Set(["trade", "analytics", "strategies", "builder", "speed", "risk", "learn"]);
  if (!allowedViews.has(view)) return;
  document.querySelectorAll(".terminal-tab").forEach((button) => {
    const isActive = button.dataset.view === view;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== view;
  });
  if (view === "analytics" || view === "speed") renderMarketAnalysis();
  if (view === "risk") renderRiskPlan();
  if (view === "builder") renderSavedStrategies();
}

function renderSavedStrategies() {
  const container = document.querySelector("#saved-strategies");
  container.replaceChildren();
  let saved;
  try {
    saved = JSON.parse(window.localStorage.getItem("vortextreder.saved-strategies") || "[]");
  } catch {
    document.querySelector("#builder-feedback").textContent =
      "Saved strategies could not be read from this browser.";
    return;
  }
  if (!Array.isArray(saved)) {
    document.querySelector("#builder-feedback").textContent =
      "Saved strategy data is invalid. Save a new strategy to replace it.";
    return;
  }
  if (saved.length === 0) {
    container.textContent = "No saved strategies yet.";
    return;
  }
  const validStrategies = saved.slice(-20).filter(
    (strategy) =>
      strategy &&
      typeof strategy.name === "string" &&
      ["CALL", "PUT"].includes(strategy.contract) &&
      Number.isInteger(strategy.duration) &&
      Number.isFinite(strategy.stake),
  );
  if (validStrategies.length !== saved.slice(-20).length) {
    document.querySelector("#builder-feedback").textContent =
      "Some saved entries were invalid and have been omitted.";
  }
  for (const strategy of validStrategies) {
    const card = document.createElement("article");
    card.className = "saved-strategy";
    const name = document.createElement("strong");
    name.textContent = strategy.name;
    const detail = document.createElement("span");
    detail.textContent =
      `${strategy.contract === "CALL" ? "Rise" : "Fall"} · ${strategy.duration} ticks · ${formatCurrency(strategy.stake, selectedAccount()?.currency || "USD")}`;
    const load = document.createElement("button");
    load.className = "secondary-button";
    load.type = "button";
    load.dataset.savedStrategy = strategy.name;
    load.textContent = "Load settings";
    card.append(name, detail, load);
    container.append(card);
  }
}

function renderMarketAnalysis() {
  if (!window.VortextrederAnalytics) return;
  const threshold = Number(document.querySelector("#digit-threshold").value);
  const market = marketSelect.options[marketSelect.selectedIndex]?.textContent || "selected market";
  const analysis = window.VortextrederAnalytics.analyzeTicks(observedTicks, 2, threshold);
  document.querySelector("#analysis-status").textContent =
    observedTicks.length ? `Live · ${market}` : `Waiting for ticks · ${market}`;
  document.querySelector("#analysis-tick-count").textContent = String(analysis.total);
  document.querySelector("#replay-tick-count").textContent = String(analysis.total);
  document.querySelector("#analysis-price").textContent = analysis.prices.length
    ? analysis.prices.at(-1).toFixed(analysis.pipSize)
    : "—";
  document.querySelector("#analysis-current-digit").textContent =
    analysis.currentDigit === null ? "—" : String(analysis.currentDigit);
  document.querySelector("#run-replay").disabled = analysis.total < 3;

  const bars = document.querySelector("#digit-bars");
  bars.replaceChildren();
  analysis.percentages.forEach((percentage, digit) => {
    const item = document.createElement("div");
    item.className = "digit-bar-row";
    const label = document.createElement("span");
    label.textContent = String(digit);
    const track = document.createElement("span");
    track.className = "digit-bar-track";
    const fill = document.createElement("span");
    fill.className = digit === analysis.currentDigit ? "digit-bar-fill is-current" : "digit-bar-fill";
    fill.style.width = `${percentage}%`;
    track.append(fill);
    const value = document.createElement("span");
    value.textContent = `${percentage.toFixed(1)}%`;
    item.setAttribute("aria-label", `Digit ${digit}: ${percentage.toFixed(1)} percent`);
    item.append(label, track, value);
    bars.append(item);
  });
  document.querySelector("#digit-extremes").textContent = analysis.total
    ? `Most frequent: ${analysis.highest.digit} (${analysis.percentages[analysis.highest.digit].toFixed(1)}%) · Least frequent: ${analysis.lowest.digit} (${analysis.percentages[analysis.lowest.digit].toFixed(1)}%)`
    : "Waiting for live market data.";
  document.querySelector("#even-percent").textContent = analysis.total
    ? `${((analysis.even / analysis.total) * 100).toFixed(1)}%`
    : "—";
  document.querySelector("#odd-percent").textContent = analysis.total
    ? `${((analysis.odd / analysis.total) * 100).toFixed(1)}%`
    : "—";
  document.querySelector("#over-percent").textContent = analysis.total
    ? `${((analysis.over / analysis.total) * 100).toFixed(1)}%`
    : "—";
  document.querySelector("#under-percent").textContent = analysis.total
    ? `${((analysis.under / analysis.total) * 100).toFixed(1)}%`
    : "—";
  document.querySelector("#over-label").textContent = `Over ${threshold}`;
  document.querySelector("#under-label").textContent = `${threshold} or under`;

  const stream = document.querySelector("#digit-stream");
  stream.replaceChildren();
  for (const digit of analysis.last) {
    const item = document.createElement("span");
    item.className = digit % 2 === 0 ? "stream-digit is-even" : "stream-digit is-odd";
    item.textContent = String(digit);
    stream.append(item);
  }

  const chart = document.querySelector("#live-chart");
  chart.replaceChildren();
  if (analysis.prices.length > 1) {
    const min = Math.min(...analysis.prices);
    const max = Math.max(...analysis.prices);
    const range = max - min || 1;
    const points = analysis.prices
      .map((price, index) => {
        const x = (index / (analysis.prices.length - 1)) * 620 + 10;
        const y = 165 - ((price - min) / range) * 145;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#49c58b");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    chart.append(line);
  }
}

function startMarketStream() {
  if (!marketSelect.value) return;
  if (analysisSocket) {
    analysisSocket.onmessage = null;
    analysisSocket.onerror = null;
    analysisSocket.onclose = null;
    analysisSocket.close();
  }
  observedTicks = [];
  renderMarketAnalysis();
  const socket = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
  analysisSocket = socket;
  socket.onopen = () => {
    socket.send(JSON.stringify({ ticks: marketSelect.value, subscribe: 1, req_id: 902 }));
  };
  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      document.querySelector("#analysis-status").textContent = "Deriv returned unreadable market data.";
      return;
    }
    if (message.error) {
      document.querySelector("#analysis-status").textContent =
        message.error.message || "Deriv could not stream market data.";
      return;
    }
    if (message.msg_type !== "tick" || !Number.isFinite(Number(message.tick?.quote))) return;
    const tick = {
      quote: Number(message.tick.quote),
      pip_size: Number.isInteger(message.tick.pip_size) ? message.tick.pip_size : 2,
    };
    observedTicks.push(tick);
    if (observedTicks.length > 1000) observedTicks.shift();
    renderMarketAnalysis();
  };
  socket.onerror = () => {
    if (analysisSocket === socket) {
      document.querySelector("#analysis-status").textContent = "Live market stream is unavailable.";
    }
  };
}

function renderRiskPlan() {
  if (!window.VortextrederAnalytics) return;
  const showRiskError = (message) => {
    for (const selector of ["#risk-starting-stake", "#risk-stop-loss", "#risk-take-profit"]) {
      document.querySelector(selector).textContent = "—";
    }
    document.querySelector("#risk-ladder").textContent = message;
  };
  const form = document.querySelector("#risk-form");
  if (!form.checkValidity()) {
    showRiskError("Enter valid values within the limits shown.");
    return;
  }
  const balance = Number(document.querySelector("#risk-balance").value);
  const riskPercent = Number(document.querySelector("#risk-percent").value);
  const lossCount = Number(document.querySelector("#risk-loss-count").value);
  const martingale = Number(document.querySelector("#risk-martingale").value);
  const takeProfitPercent = Number(document.querySelector("#risk-take-profit-percent").value);
  if (
    ![balance, riskPercent, lossCount, martingale, takeProfitPercent].every(Number.isFinite) ||
    balance <= 0 ||
    riskPercent < 1 ||
    riskPercent > 50 ||
    lossCount < 1 ||
    lossCount > 10 ||
    martingale < 1 ||
    martingale > 2 ||
    takeProfitPercent < 1 ||
    takeProfitPercent > 100
  ) {
    showRiskError("Enter values within the displayed limits.");
    return;
  }
  const account = selectedAccount();
  const currency = account?.currency || "USD";
  let plan;
  try {
    plan = window.VortextrederAnalytics.calculateRiskPlan({
      balance,
      riskPercent,
      martingale,
      lossCount,
      takeProfitPercent,
    });
  } catch (error) {
    showRiskError(
      error instanceof RangeError
        ? error.message
        : "Could not calculate this risk plan from the supplied values.",
    );
    return;
  }
  document.querySelector("#risk-starting-stake").textContent =
    formatCurrency(plan.startingStake, currency);
  document.querySelector("#risk-stop-loss").textContent = formatCurrency(plan.stopLoss, currency);
  document.querySelector("#risk-take-profit").textContent =
    formatCurrency(plan.takeProfit, currency);
  const ladder = document.querySelector("#risk-ladder");
  ladder.replaceChildren();
  for (const row of plan.stakes) {
    const item = document.createElement("div");
    const step = document.createElement("span");
    step.textContent = `#${row.loss}`;
    const stake = document.createElement("span");
    stake.textContent = formatCurrency(row.stake, currency);
    const cumulative = document.createElement("span");
    cumulative.textContent = `${formatCurrency(row.cumulative, currency)} total`;
    item.append(step, stake, cumulative);
    ladder.append(item);
  }
}

function displayAccounts(list) {
  if (!Array.isArray(list)) {
    showMessage("Deriv returned an invalid account list.", true);
    return;
  }
  accounts = list;
  accountSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select an account";
  accountSelect.append(placeholder);
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = `${account.type === "demo" ? "Demo" : "Real"} · ${account.currency} · ${account.id}${account.status === "active" ? "" : " · inactive"}`;
    option.disabled = account.status !== "active";
    accountSelect.append(option);
  }

  dashboard.hidden = false;
  connectButton.closest(".connect-panel").hidden = true;
  accountSelect.value =
    accounts.find((account) => account.type === "demo" && account.status === "active")?.id ||
    "";
  if (accounts.length === 0) {
    accountNote.textContent =
      "No Deriv Options accounts were returned. Create or enable one in your Deriv account, then refresh.";
  } else if (!accounts.some((account) => account.status === "active")) {
    accountNote.textContent =
      "No active Options accounts are available. Check your Deriv account before trading.";
  } else {
    setAccountDetails();
    if (selectedAccount()?.balance > 0) {
      document.querySelector("#risk-balance").value = String(selectedAccount().balance);
    }
  }
}

async function loadAccounts() {
  const result = await requestJson("/api/account");
  if (result.authenticated !== true || !Array.isArray(result.accounts)) {
    throw new Error("Deriv account access could not be verified.");
  }
  displayAccounts(result.accounts);
}

async function checkExistingSession() {
  try {
    await loadAccounts();
  } catch (error) {
    if (error.status === 401) return;
    showMessage(error.message, true);
    if (error.status === 503) connectButton.disabled = true;
  }
}

function closeActiveSocket() {
  if (activeSocket) {
    activeSocket.onclose = null;
    activeSocket.close();
  }
  activeSocket = undefined;
  activeAccountId = undefined;
  socketConnection = undefined;
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("The Deriv account connection was closed."));
    pendingRequests.delete(id);
  }
}

function handleSocketMessage(event) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    showTradeMessage("Deriv returned an unreadable trading response.", true);
    return;
  }

  const pending = pendingRequests.get(message.req_id);
  if (message.msg_type === "balance" && typeof message.balance?.balance === "number") {
    const account = selectedAccount();
    if (account && account.id === activeAccountId) {
      account.balance = message.balance.balance;
      setAccountDetails();
    }
  }
  if (pending) {
    clearTimeout(pending.timeout);
    pendingRequests.delete(message.req_id);
    if (message.error) {
      const error = new Error(message.error.message || "Deriv rejected the request.");
      error.derivRejected = true;
      pending.reject(error);
    } else {
      pending.resolve(message);
    }
    return;
  }

}

async function openAccountSocket(account) {
  if (
    activeSocket &&
    activeAccountId === account.id &&
    activeSocket.readyState === WebSocket.OPEN
  ) {
    return activeSocket;
  }
  if (socketConnection && activeAccountId === account.id) return socketConnection;
  closeActiveSocket();
  activeAccountId = account.id;
  marketStatus.textContent = `Connecting to ${account.type} account…`;

  socketConnection = (async () => {
    const result = await requestJson("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: account.id }),
    });
    const websocketUrl = new URL(result.websocket_url);
    if (
      websocketUrl.protocol !== "wss:" ||
      websocketUrl.hostname !== "api.derivws.com" ||
      !websocketUrl.pathname.startsWith("/trading/v1/options/ws/")
    ) {
      throw new Error("Deriv returned an invalid trading connection.");
    }

    const socket = new WebSocket(websocketUrl);
    activeSocket = socket;
    socket.onmessage = handleSocketMessage;
    socket.onclose = () => {
      if (activeSocket === socket) {
        activeSocket = undefined;
        activeAccountId = undefined;
        socketConnection = undefined;
        marketStatus.textContent = "Account connection closed. Request a new quote to reconnect.";
        for (const [id, pending] of pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("The Deriv account connection was closed."));
          pendingRequests.delete(id);
        }
      }
    };
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Deriv did not open the trading connection in time."));
      }, 12000);
      socket.onopen = () => {
        clearTimeout(timeout);
        marketStatus.textContent = `Connected · ${account.type.toUpperCase()} · ${account.currency}`;
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Could not connect to Deriv's trading service."));
      };
    });
    requestOnSocket({ balance: 1 }).catch(() => {
      showTradeMessage("Connected to Deriv. Balance details are temporarily unavailable.");
    });
    return socket;
  })();

  try {
    return await socketConnection;
  } catch (error) {
    closeActiveSocket();
    marketStatus.textContent = "Account connection unavailable.";
    throw error;
  }
}

function requestOnSocket(payload) {
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Connect a Deriv account before requesting a quote."));
  }
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Deriv did not confirm the request in time."));
    }, 15000);
    pendingRequests.set(id, { resolve, reject, timeout });
    activeSocket.send(JSON.stringify({ ...payload, req_id: id }));
  });
}

async function loadMarkets() {
  marketStatus.textContent = "Loading live markets…";
  const socket = new WebSocket("wss://api.derivws.com/trading/v1/options/ws/public");
  try {
    const markets = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Deriv's live market list timed out."));
      }, 12000);
      socket.onopen = () => socket.send(JSON.stringify({ active_symbols: "brief", req_id: 1 }));
      socket.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          clearTimeout(timeout);
          reject(new Error("Deriv returned an unreadable market list."));
          return;
        }
        if (message.error) {
          clearTimeout(timeout);
          reject(new Error(message.error.message || "Deriv could not load live markets."));
        } else if (message.req_id === 1) {
          clearTimeout(timeout);
          resolve(message.active_symbols);
        }
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Could not connect to Deriv's live market service."));
      };
    });

    if (!Array.isArray(markets)) throw new Error("Deriv returned an invalid market list.");
    const available = markets
      .filter((market) => market.exchange_is_open && !market.is_trading_suspended)
      .filter(
        (market) =>
          typeof market.underlying_symbol === "string" &&
          typeof market.underlying_symbol_name === "string",
      )
      .sort((left, right) =>
        left.underlying_symbol_name.localeCompare(right.underlying_symbol_name),
      );
    marketSelect.replaceChildren();
    for (const market of available) {
      const option = document.createElement("option");
      option.value = market.underlying_symbol;
      option.textContent = `${market.underlying_symbol_name} (${market.underlying_symbol})`;
      marketSelect.append(option);
    }
    if (available.length === 0) throw new Error("No live Options markets are currently available.");
    marketSelect.value = available.find((market) => market.underlying_symbol === "1HZ100V")
      ?.underlying_symbol || available[0].underlying_symbol;
    marketSelect.disabled = false;
    marketStatus.textContent = "Live markets loaded";
    quoteButton.disabled = !selectedAccount();
    startMarketStream();
  } catch (error) {
    marketStatus.textContent = error.message;
    showMessage(error.message, true);
  } finally {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

async function requestQuote() {
  resetQuote();
  const account = selectedAccount();
  if (!account) {
    showTradeMessage("Select a Deriv account first.", true);
    return;
  }
  if (uncertainAccounts.has(account.id)) {
    showTradeMessage(
      "Check this account's contract history in Deriv before unlocking further orders.",
      true,
    );
    return;
  }
  const stake = Number(document.querySelector("#stake-input").value);
  const duration = Number(document.querySelector("#duration-input").value);
  if (!document.querySelector("#stake-input").reportValidity()) return;
  if (!document.querySelector("#duration-input").reportValidity()) return;

  quoteButton.disabled = true;
  showTradeMessage("Requesting a live quote from Deriv…");
  try {
    await openAccountSocket(account);
    const response = await requestOnSocket({
      proposal: 1,
      amount: stake,
      basis: "stake",
      contract_type: document.querySelector("#contract-select").value,
      currency: account.currency,
      duration,
      duration_unit: "t",
      underlying_symbol: marketSelect.value,
    });
    const proposal = response.proposal;
    if (
      !proposal ||
      typeof proposal.id !== "string" ||
      typeof proposal.ask_price !== "number" ||
      typeof proposal.payout !== "number"
    ) {
      throw new Error("Deriv returned an incomplete quote. Please request a new one.");
    }

    currentQuote = {
      id: proposal.id,
      askPrice: proposal.ask_price,
      payout: proposal.payout,
      accountId: account.id,
      accountType: account.type,
      currency: account.currency,
      longcode: proposal.longcode || "Options contract",
      expiresAt: Date.now() + 20000,
    };
    document.querySelector("#quote-description").textContent = currentQuote.longcode;
    document.querySelector("#quote-price").textContent =
      formatCurrency(currentQuote.askPrice, account.currency);
    document.querySelector("#quote-payout").textContent =
      formatCurrency(currentQuote.payout, account.currency);
    document.querySelector("#quote-expiry").textContent = "20 seconds";
    quoteCard.hidden = false;
    buyButton.textContent = account.type === "real" ? "Place real-money order" : "Place demo order";
    buyButton.disabled = false;
    quoteTimer = setInterval(updateQuoteExpiry, 1000);
    updateQuoteExpiry();
    showTradeMessage("Review the quoted price and payout, then decide whether to place this order.");
  } catch (error) {
    showTradeMessage(error.message, true);
  } finally {
    quoteButton.disabled = !selectedAccount() || marketSelect.disabled;
  }
}

function updateQuoteExpiry() {
  if (!currentQuote) return;
  const remaining = Math.max(0, Math.ceil((currentQuote.expiresAt - Date.now()) / 1000));
  document.querySelector("#quote-expiry").textContent =
    remaining > 0 ? `${remaining} seconds` : "Expired";
  if (remaining === 0) {
    resetQuote();
    showTradeMessage("This quote expired. Request a fresh quote before placing an order.", true);
  }
}

async function placeOrder() {
  const quote = currentQuote;
  const account = selectedAccount();
  if (!quote || !account || quote.accountId !== account.id) {
    showTradeMessage("Request a fresh quote for the selected account before placing an order.", true);
    return;
  }
  if (Date.now() >= quote.expiresAt) {
    resetQuote();
    showTradeMessage("This quote expired. Request a fresh quote before placing an order.", true);
    return;
  }

  const confirmation =
    quote.accountType === "real"
      ? `Place this REAL-MONEY order on ${quote.accountId}?\n\nMaximum price: ${formatCurrency(quote.askPrice, quote.currency)}\nPotential payout: ${formatCurrency(quote.payout, quote.currency)}\n\nYour stake can be lost. The configured 3% app markup may reduce a winning payout.`
      : `Place this DEMO order on ${quote.accountId}?\n\nMaximum price: ${formatCurrency(quote.askPrice, quote.currency)}\nPotential payout: ${formatCurrency(quote.payout, quote.currency)}`;
  if (!window.confirm(confirmation)) return;

  buyButton.disabled = true;
  quoteButton.disabled = true;
  showTradeMessage("Sending this order to Deriv. Do not retry if the response times out; check your Deriv account first.");
  try {
    const response = await requestOnSocket({
      buy: quote.id,
      price: quote.askPrice,
    });
    const order = response.buy;
    if (!order || typeof order.contract_id !== "number") {
      throw new Error(
        "Deriv's order response was incomplete. Check your Deriv account before trying again.",
      );
    }
    const balance = Number.isFinite(order.balance_after)
      ? ` · Balance ${formatCurrency(order.balance_after, quote.currency)}`
      : "";
    showTradeMessage(
      `Order confirmed by Deriv · Contract ${order.contract_id} · Paid ${formatCurrency(order.buy_price, quote.currency)}${balance}`,
    );
    if (Number.isFinite(order.balance_after)) {
      account.balance = order.balance_after;
      setAccountDetails();
    }
    resetQuote();
  } catch (error) {
    if (!error.derivRejected) {
      uncertainAccounts.add(account.id);
      window.sessionStorage.setItem(
        "deriv.uncertain-order-accounts",
        JSON.stringify([...uncertainAccounts]),
      );
      uncertainOrderWarning.hidden = false;
      quoteButton.disabled = true;
    }
    showTradeMessage(
      error.derivRejected
        ? `Deriv rejected the order: ${error.message}`
        : `${error.message} This account is locked for new orders until you check Deriv's contract history.`,
      true,
    );
  } finally {
    quoteButton.disabled = !selectedAccount() || marketSelect.disabled;
  }
}

function resolveUncertainOrder() {
  const account = selectedAccount();
  if (!account || !uncertainAccounts.has(account.id)) return;
  const confirmed = window.confirm(
    `Have you checked Deriv's contract history for ${account.id} and reconciled the earlier order before unlocking this account?`,
  );
  if (!confirmed) return;
  uncertainAccounts.delete(account.id);
  window.sessionStorage.setItem(
    "deriv.uncertain-order-accounts",
    JSON.stringify([...uncertainAccounts]),
  );
  setAccountDetails();
  showTradeMessage("This account is unlocked. Request a new quote before placing any order.");
}

async function signOut() {
  try {
    await requestJson("/api/account", { method: "DELETE" });
    closeActiveSocket();
    if (analysisSocket) {
      analysisSocket.onmessage = null;
      analysisSocket.onerror = null;
      analysisSocket.onclose = null;
      analysisSocket.close();
      analysisSocket = undefined;
    }
    accounts = [];
    dashboard.hidden = true;
    connectButton.closest(".connect-panel").hidden = false;
    connectButton.disabled = false;
    accountSelect.replaceChildren();
    resetQuote();
    setTerminalView("trade");
    showMessage(
      "You have signed out of Vortextreder. To connect a different Deriv profile, also sign out of Deriv in this browser, then connect again. To revoke this app's access entirely, remove it from your Deriv account settings.",
    );
  } catch (error) {
    showMessage(error.message, true);
  }
}

connectButton.addEventListener("click", () => {
  startDerivAuthorization().catch(() => {
    showMessage("Could not start Deriv sign-in. Please try again.", true);
  });
});
document.querySelector("#disconnect-deriv").addEventListener("click", signOut);
accountSelect.addEventListener("change", setAccountDetails);
document.querySelectorAll(".terminal-tab").forEach((button) => {
  button.addEventListener("click", () => setTerminalView(button.dataset.view));
});
document.querySelectorAll("[data-open-view]").forEach((button) => {
  button.addEventListener("click", () => setTerminalView(button.dataset.openView));
});
document.querySelectorAll(".strategy-load").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#contract-select").value = button.dataset.contract;
    document.querySelector("#duration-input").value = button.dataset.duration;
    document.querySelector("#stake-input").value = "1";
    resetQuote();
    setTerminalView("trade");
    document.querySelector("#trading-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
marketSelect.addEventListener("change", startMarketStream);
document.querySelector("#digit-threshold").addEventListener("change", renderMarketAnalysis);
document.querySelector("#risk-form").addEventListener("input", renderRiskPlan);
document.querySelector("#use-account-balance").addEventListener("click", () => {
  const account = selectedAccount();
  if (!account || !Number.isFinite(account.balance) || account.balance <= 0) {
    document.querySelector("#risk-ladder").textContent =
      "A current balance is not available. Enter your balance manually.";
    return;
  }
  document.querySelector("#risk-balance").value = String(account.balance);
  renderRiskPlan();
});
document.querySelector("#run-replay").addEventListener("click", () => {
  const result = window.VortextrederAnalytics.replayDirection(observedTicks);
  document.querySelector("#replay-wins").textContent = String(result.wins);
  document.querySelector("#replay-losses").textContent = String(result.losses);
  document.querySelector("#replay-rate").textContent = `${result.winRate.toFixed(1)}%`;
  document.querySelector("#replay-feedback").textContent =
    `${result.total} adjacent-tick direction comparisons. This is a historical descriptive statistic, not a prediction or profitability estimate.`;
});
document.querySelector("#strategy-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const settings = {
    name: document.querySelector("#strategy-name").value.trim(),
    contract: document.querySelector("#builder-contract").value,
    duration: Number(document.querySelector("#builder-duration").value),
    stake: Number(document.querySelector("#builder-stake").value),
    demoOnly: document.querySelector("#builder-demo-only").checked,
  };
  if (
    !settings.name ||
    !Number.isInteger(settings.duration) ||
    settings.duration < 5 ||
    settings.duration > 1000 ||
    !Number.isFinite(settings.stake) ||
    settings.stake < 0.01 ||
    settings.stake > 10000
  ) {
    document.querySelector("#builder-feedback").textContent =
      "Check the strategy name, duration, and stake values.";
    return;
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem("vortextreder.saved-strategies") || "[]");
    if (!Array.isArray(saved)) throw new Error("Saved strategies are not in the expected format.");
    const next = [...saved.filter((item) => item?.name !== settings.name), settings].slice(-20);
    window.localStorage.setItem("vortextreder.saved-strategies", JSON.stringify(next));
    document.querySelector("#builder-feedback").textContent =
      `Saved “${settings.name}” on this device. Settings are not sent to Deriv until you manually request a quote.`;
    renderSavedStrategies();
  } catch {
    document.querySelector("#builder-feedback").textContent =
      "Could not save strategy settings in this browser.";
  }
});
document.querySelector("#saved-strategies").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-saved-strategy]");
  if (!button) return;
  let saved;
  try {
    saved = JSON.parse(window.localStorage.getItem("vortextreder.saved-strategies") || "[]");
  } catch {
    document.querySelector("#builder-feedback").textContent =
      "Saved settings could not be read from this browser.";
    return;
  }
  const strategy = Array.isArray(saved)
    ? saved.find((item) => item?.name === button.dataset.savedStrategy)
    : null;
  if (!strategy) {
    document.querySelector("#builder-feedback").textContent =
      "That saved strategy is no longer available.";
    renderSavedStrategies();
    return;
  }
  if (strategy.demoOnly && selectedAccount()?.type !== "demo") {
    const demo = accounts.find((account) => account.type === "demo" && account.status === "active");
    if (!demo) {
      document.querySelector("#builder-feedback").textContent =
        "This strategy is marked for demo practice, but no active demo account is connected.";
      return;
    }
    accountSelect.value = demo.id;
    setAccountDetails();
  }
  document.querySelector("#strategy-name").value = strategy.name;
  document.querySelector("#builder-contract").value = strategy.contract;
  document.querySelector("#builder-duration").value = String(strategy.duration);
  document.querySelector("#builder-stake").value = String(strategy.stake);
  document.querySelector("#builder-demo-only").checked = Boolean(strategy.demoOnly);
  document.querySelector("#builder-feedback").textContent =
    "Settings loaded into the builder. Review them before using the manual ticket.";
});
quoteButton.addEventListener("click", requestQuote);
buyButton.addEventListener("click", placeOrder);
resolveUncertainOrderButton.addEventListener("click", resolveUncertainOrder);
for (const selector of ["#market-select", "#contract-select", "#duration-input", "#stake-input"]) {
  document.querySelector(selector).addEventListener("input", resetQuote);
  document.querySelector(selector).addEventListener("change", resetQuote);
}

document.querySelectorAll(".risk-currency").forEach((element) => {
  element.textContent = selectedAccount()?.currency || "USD";
});
if (window.location.pathname === "/callback") {
  handleDerivCallback().catch((error) => showMessage(error.message, true));
}
checkExistingSession();
loadMarkets();
