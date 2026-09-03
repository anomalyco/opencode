import type { Browser } from "@opencode-ai/plugin-browser/rpc"

export function protocolError(method: string, error: unknown) {
  const detail = message(error)
  const recovery = /(?:node|object).*(?:not found|not exist)|(?:find|resolve).*(?:node|object)|detached/i.test(detail)
    ? "The element may have detached. Call browser.snapshot({tabID}) and use a fresh ref from that tab."
    : /context.*(?:destroyed|not found)|find.*context|session.*not found/i.test(detail)
      ? "The document or frame changed. Call browser.frames({tabID}) and browser.snapshot({tabID}); use current frame IDs and refs."
      : /wasn't found|method not found|not implemented|not allowed/i.test(detail)
        ? "This Chromium target does not support or allow the operation. Check desktop/plugin compatibility and report it; do not retry unchanged or disable browser security."
        : "Inspect browser.tabs.list({}) and the target tab before deciding to retry; a partially completed action is not automatically safe to repeat."
  return new Error(`${recovery} Chromium command ${method} failed: ${detail}`, { cause: error })
}

export function browserFailure(action: Browser.Action, error: unknown): Extract<Browser.Outcome, { type: "failure" }> {
  const detail = message(error, 1_700)
  const navigation = ["tabs.open", "navigate", "back", "forward", "reload"].includes(action.type)
  const network = navigation ? detail.match(/\bERR_[A-Z_]+\b/)?.[0] : undefined
  const hint =
    network === "ERR_CONNECTION_REFUSED"
      ? "The desktop could not connect to the site. Check its hostname/port and that the site is reachable from the desktop. localhost means the desktop, not the remote server."
      : network === "ERR_NAME_NOT_RESOLVED"
        ? "The desktop could not resolve the hostname. Check the URL spelling and the desktop's DNS/network connection."
        : network?.startsWith("ERR_CERT_") || network?.startsWith("ERR_SSL_")
          ? "The desktop rejected the site's TLS connection. Ask the user to fix the certificate or trust configuration; do not bypass certificate checks."
          : network === "ERR_ABORTED"
            ? "Navigation was interrupted or became a download. Inspect browser.tabs.list({}) and browser.files.list({tabID}) before deciding to navigate again."
            : network
              ? "The site failed to load from the desktop. Check the URL and desktop connectivity before retrying; inspect the current tab first."
              : action.type === "screenshot" && /UnknownVizError|capture.*(?:failed|unavailable)/i.test(detail)
                ? "Chromium could not capture a rendered frame. Call browser.tabs.focus({tabID}) and keep the desktop window visible. If it is already visible, report the capture failure instead of repeating it unchanged."
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

function message(error: unknown, limit = 400) {
  return (error instanceof Error ? error.message : String(error)).slice(0, limit)
}
