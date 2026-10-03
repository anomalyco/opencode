// Ported from packages/gui-extensions/src/browser/errors.ts. Hints differ where the extension's
// situation differs: pages load on the user's own network in their real browser.
import type { Browser } from "@opencode/plugin-browser/rpc"

export function protocolError(method: string, error: unknown) {
  const detail = message(error)
  const recovery =
    method === "Runtime.callFunctionOn" && /not evaluate to a function/i.test(detail)
      ? "With ref, browser.evaluate needs a function that receives the element, for example (element) => element.textContent."
      : /(?:node|object).*(?:not found|not exist)|(?:find|resolve).*(?:node|object)|detached/i.test(detail)
        ? "The element may have detached. Call browser.snapshot({tabID}) and use a fresh ref from that tab."
        : /context.*(?:destroyed|not found)|find.*context|session.*not found/i.test(detail)
          ? "The document or frame changed. Call browser.frames({tabID}) and browser.snapshot({tabID}); use current frame IDs and refs."
          : /cannot access|cannot attach|chrome:\/\/|chrome-extension:\/\//i.test(detail)
            ? "The browser does not allow extensions to control this page (browser settings, the web store, or another extension). Navigate to an http(s) page or ask the user to share another tab."
            : /wasn't found|method not found|not implemented|not allowed/i.test(detail)
              ? "This browser does not support or allow the operation. Report it; do not retry unchanged or disable browser security."
              : "Inspect browser.tabs.list({}) and the target tab before deciding to retry; a partially completed action is not automatically safe to repeat."
  return new Error(`${recovery} Chromium command ${method} failed: ${detail}`, { cause: error })
}

export function browserFailure(action: Browser.Action, error: unknown): Extract<Browser.Outcome, { type: "failure" }> {
  const detail = message(error, 1_700)
  const navigation = ["tabs.open", "navigate", "back", "forward", "reload"].includes(action.type)
  const network = navigation ? detail.match(/\bERR_[A-Z_]+\b/)?.[0] : undefined
  const hint =
    network === "ERR_CONNECTION_REFUSED"
      ? "The browser could not connect to the site. Check its hostname/port. localhost means the user's computer, where the browser runs."
      : network === "ERR_NAME_NOT_RESOLVED"
        ? "The hostname could not be resolved. Check the URL spelling and the user's network connection."
        : network?.startsWith("ERR_CERT_") || network?.startsWith("ERR_SSL_")
          ? "The browser rejected the site's TLS connection. Ask the user to fix the certificate or trust configuration; do not bypass certificate checks."
          : network === "ERR_ABORTED"
            ? "Navigation was interrupted or became a download. Inspect browser.tabs.list({}) before deciding to navigate again."
            : network
              ? "The site failed to load. Check its URL and the network before retrying; inspect the current tab first."
              : undefined
  return {
    type: "failure",
    code: network ? "navigation_failed" : "operation_failed",
    message: `browser.${action.type} failed. ${hint ? `${hint} Details: ${detail.slice(0, 400)}` : detail}`.slice(
      0,
      2_048,
    ),
  }
}

export function unsupported(action: Browser.Action): Extract<Browser.Outcome, { type: "failure" }> {
  return {
    type: "failure",
    code: "unsupported",
    message: `browser.${action.type} is not available in OpenCode Browser yet. Use another browser operation, or ask the user to run it from the opencode desktop app.`,
  }
}

function message(error: unknown, limit = 400) {
  return (error instanceof Error ? error.message : String(error)).slice(0, limit)
}
