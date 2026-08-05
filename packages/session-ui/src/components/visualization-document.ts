import {
  FOLLOW_UP_INIT_TIMEOUT_MS,
  FOLLOW_UP_RESPONSE_TIMEOUT_MS,
  MAX_ERROR_CODE_POINTS,
  MAX_PROMPT_CODE_POINTS,
  MAX_THEME_VALUE_CODE_POINTS,
  MAX_TITLE_CODE_POINTS,
  MAX_TOKEN_CODE_POINTS,
  VISUALIZATION_FOLLOW_UP_STATUSES,
  VISUALIZATION_THEME_VARIABLES,
  VISUALIZATION_VERSION,
} from "./visualization-schema"

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none';"

const HOST_CANVAS_STYLE = String.raw`:root {
  color-scheme: light dark;
  background: transparent !important;
  --background: var(--v2-background-bg-base, transparent);
  --foreground: var(--v2-text-text-base, currentColor);
  --card: var(--v2-background-bg-layer-01, transparent);
  --card-foreground: var(--foreground);
  --muted-foreground: var(--v2-text-text-muted, var(--foreground));
  --border: var(--v2-border-border-base, transparent);
  --primary: var(--v2-text-text-accent, var(--foreground));
  --font-sans: var(--font-family-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  --font-mono: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}

* {
  box-sizing: border-box;
}

html,
html > body {
  width: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
}

html > body {
  color: var(--foreground);
  font-family: var(--font-sans);
  overflow: visible;
}

#widget {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  background: transparent !important;
}

#widget > :not(.card) {
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

svg,
canvas,
img {
  max-width: 100%;
}`

const BRIDGE_BOOTSTRAP = String.raw`(() => {
  "use strict";
  const config = {
    version: ${VISUALIZATION_VERSION},
    themeVariables: ${JSON.stringify(VISUALIZATION_THEME_VARIABLES)},
    statuses: ${JSON.stringify(VISUALIZATION_FOLLOW_UP_STATUSES)},
    tokenLimit: ${MAX_TOKEN_CODE_POINTS},
    themeValueLimit: ${MAX_THEME_VALUE_CODE_POINTS},
    titleLimit: ${MAX_TITLE_CODE_POINTS},
    promptLimit: ${MAX_PROMPT_CODE_POINTS},
    errorLimit: ${MAX_ERROR_CODE_POINTS},
    initTimeout: ${FOLLOW_UP_INIT_TIMEOUT_MS},
    responseTimeout: ${FOLLOW_UP_RESPONSE_TIMEOUT_MS}
  };
  let token;
  let settleInitialized;
  let initializationSettled = false;
  const initialized = new Promise((resolve) => { settleInitialized = resolve; });
  let requestSequence = 0;
  let followUpActive = false;
  let pendingFollowUp;
  let resizeFrame = 0;
  let lastReportedHeight;
  let deferredError;
  let disposed = false;

  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const bounded = (value, maximum) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || Array.from(trimmed).length > maximum) return;
    return trimmed;
  };
  const applyTheme = (theme) => {
    if (!record(theme)) return;
    for (const name of config.themeVariables) {
      const value = theme[name];
      if (value === undefined) continue;
      if (typeof value !== "string") continue;
      if (!(Array.from(value).length <= config.themeValueLimit)) continue;
      document.documentElement.style.setProperty(name, value);
    }
  };
  const post = (message) => {
    if (!token || disposed) return false;
    parent.postMessage({ version: config.version, token, ...message }, "*");
    return true;
  };
  const cleanError = (value) => {
    const text = typeof value === "string" ? value : "Visualization error";
    const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
    return Array.from(cleaned).slice(0, config.errorLimit).join("") || "Visualization error";
  };
  const reportError = (value) => {
    if (disposed) return;
    const message = cleanError(value);
    if (!token) {
      deferredError = message;
      return;
    }
    post({ type: "error", message });
  };
  const reportResize = () => {
    resizeFrame = 0;
    const bodyHeight = document.body ? document.body.scrollHeight : 0;
    const height = Math.max(document.documentElement.scrollHeight, bodyHeight);
    if (!Number.isFinite(height) || height === lastReportedHeight) return;
    if (post({ type: "resize", height })) lastReportedHeight = height;
  };
  const scheduleResize = () => {
    if (disposed) return;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(reportResize);
  };
  const settleInitialization = (value) => {
    if (initializationSettled) return;
    initializationSettled = true;
    settleInitialized(value);
  };
  const waitForInitialization = () => new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), config.initTimeout);
    initialized.then(finish);
  });
  const waitForFollowUp = (requestID) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pendingFollowUp || pendingFollowUp.requestID !== requestID) return;
      pendingFollowUp = undefined;
      resolve({ status: "rejected" });
    }, config.responseTimeout);
    pendingFollowUp = { requestID, resolve, timer };
  });
  const sendFollowUp = async (input) => {
    if (!record(input)) throw new TypeError("Follow-up input must be an object");
    const prompt = bounded(input.prompt, config.promptLimit);
    if (!prompt) throw new TypeError("Follow-up prompt is invalid");
    const title = input.title === undefined ? undefined : bounded(input.title, config.titleLimit);
    if (input.title !== undefined && !title) throw new TypeError("Follow-up title is invalid");
    if (followUpActive || disposed) return { status: "rejected" };
    followUpActive = true;
    try {
      const ready = await waitForInitialization();
      if (!ready || !token || disposed) return { status: "rejected" };
      const requestID = String(++requestSequence);
      const result = waitForFollowUp(requestID);
      post({ type: "followup", requestID, ...(title ? { title } : {}), prompt });
      return await result;
    } finally {
      if (pendingFollowUp) clearTimeout(pendingFollowUp.timer);
      pendingFollowUp = undefined;
      followUpActive = false;
    }
  };

  window.opencode = { visualization: {} };
  window.opencode.visualization.sendFollowUp = sendFollowUp;
  Object.freeze(window.opencode.visualization);
  Object.freeze(window.opencode);

  addEventListener("message", (event) => {
    if (event.source !== parent || disposed) return;
    const message = event.data;
    if (!record(message) || message.version !== config.version) return;
    if (message.type === "init") {
      if (token) return;
      const nextToken = bounded(message.token, config.tokenLimit);
      if (!nextToken) return;
      token = nextToken;
      applyTheme(message.theme);
      settleInitialization(true);
      post({ type: "ready" });
      if (deferredError) {
        post({ type: "error", message: deferredError });
        deferredError = undefined;
      }
      scheduleResize();
      return;
    }
    if (!token || message.token !== token) return;
    if (message.type === "theme") {
      applyTheme(message.theme);
      scheduleResize();
      return;
    }
    if (message.type === "followup-result") {
      if (!pendingFollowUp || message.requestID !== pendingFollowUp.requestID) return;
      const status = message.status;
      if (!(status === "sent" || status === "cancelled" || status === "rejected")) return;
      if (!config.statuses.includes(status)) return;
      const current = pendingFollowUp;
      pendingFollowUp = undefined;
      clearTimeout(current.timer);
      current.resolve({ status });
    }
  });
  addEventListener("error", (event) => reportError(event.message));
  addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportError(reason && typeof reason.message === "string" ? reason.message : reason);
  });

  const resizeObserver = new ResizeObserver(scheduleResize);
  resizeObserver.observe(document.documentElement);
  if (document.body) resizeObserver.observe(document.body);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    settleInitialization(false);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeObserver.disconnect();
    if (!pendingFollowUp) return;
    const current = pendingFollowUp;
    pendingFollowUp = undefined;
    clearTimeout(current.timer);
    current.resolve({ status: "rejected" });
  };
  addEventListener("DOMContentLoaded", scheduleResize, { once: true });
  addEventListener("pagehide", dispose, { once: true });
  addEventListener("beforeunload", dispose, { once: true });
})();`

export function createVisualizationDocument(html: string) {
  return `<!doctype html><html style="background: transparent !important"><head><meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}"><style>${HOST_CANVAS_STYLE}</style></head><body style="margin: 0; background: transparent !important"><script>${BRIDGE_BOOTSTRAP}</script><div id="widget">${html}</div></body></html>`
}
