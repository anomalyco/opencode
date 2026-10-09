import type { Browser } from "@opencode/plugin-browser/rpc"

/** A failure with its own code, so the agent can tell a missing element from a broken tab. */
export class BrowserError extends Error {
  constructor(
    readonly code: "not_found" | "not_actionable" | "tab_hidden" | "timeout" | "invalid",
    message: string,
  ) {
    super(message)
    this.name = "BrowserError"
  }
}

export function protocolError(method: string, cause: unknown) {
  const detail = message(cause)

  const recovery =
    method === "DOM.setFileInputFiles" && /not.*file input/i.test(detail)
      ? "Target is not a file input. Pass a locator for an input[type=file] to browser.upload, or use browser.drop for a drop area."
      : method === "Runtime.callFunctionOn" && /not evaluate to a function/i.test(detail)
        ? "With target, browser.evaluate needs a function that receives the element, for example (element) => element.textContent."
        : /(?:node|object).*(?:not found|not exist)|(?:find|resolve).*(?:node|object)|detached/i.test(detail)
          ? "The element left the page. Use a locator (text=, role=, CSS) instead of an old ref, or call browser.find again."
          : /context.*(?:destroyed|not found)|find.*context|session.*not found/i.test(detail)
            ? "The document or frame changed. Call browser.frames({tabID}) and use current frame IDs."
            : /wasn't found|method not found|not implemented|not allowed/i.test(detail)
              ? "This Chromium target does not support or allow the operation. Check desktop/plugin compatibility and report it; do not retry unchanged or disable browser security."
              : "Inspect browser.tabs.list({}) and the target tab before deciding to retry; a partially completed action is not automatically safe to repeat."

  return new Error(`${recovery} Chromium command ${method} failed: ${detail}`, { cause })
}

const hidden =
  "The tab could not render a frame because it is one of the user's own tabs and is not on screen. Open the page in your own tab with browser.tabs.open({url}) (agent tabs render in the background), or ask the user to show this tab."

export function browserFailure(action: Browser.Action, cause: unknown): Extract<Browser.Outcome, { type: "failure" }> {
  const detail = message(cause, 1_700)
  const navigation = ["tabs.open", "navigate", "back", "forward", "reload"].includes(action.type)
  const network = navigation ? detail.match(/\bERR_[A-Z_]+\b/)?.[0] : undefined
  const viz = /UnknownVizError|display surface not available|capture.*(?:failed|unavailable)/i.test(detail)

  const hint =
    network === "ERR_CONNECTION_REFUSED"
      ? "The browser could not connect to the site. Check its hostname/port on the connected server. localhost means that server, not the desktop."
      : network === "ERR_NAME_NOT_RESOLVED"
        ? "The connected server could not resolve the hostname. Check the URL spelling and the server's DNS/network connection."
        : network?.startsWith("ERR_CERT_") || network?.startsWith("ERR_SSL_")
          ? "The desktop rejected the site's TLS connection. Ask the user to fix the certificate or trust configuration; do not bypass certificate checks."
          : network === "ERR_ABORTED"
            ? "Navigation was interrupted or became a download. Inspect browser.tabs.list({}) and browser.files.list({tabID}) before deciding to navigate again."
            : network
              ? "The site failed to load through the connected server. Check its URL/network and the connection before retrying; inspect the current tab first."
              : viz
                ? hidden
                : undefined

  return {
    type: "failure",
    code: cause instanceof BrowserError ? cause.code : viz ? "tab_hidden" : network ? "navigation_failed" : "operation_failed",
    message: `browser.${action.type} failed. ${hint ? `${hint} Details: ${detail.slice(0, 400)}` : detail}`.slice(
      0,
      2_048,
    ),
  }
}

function message(cause: unknown, limit = 400) {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, limit)
}
