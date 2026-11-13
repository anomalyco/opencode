import { Browser } from "@opencode/plugin-browser/rpc"
import { CAPTURE_DEADLINE_MS } from "./capture"

/** A failure the server acts on by its code, such as a wait whose condition never held. */
export class CodedError extends Error {
  constructor(
    readonly code: (typeof Browser.FailureCode)[keyof typeof Browser.FailureCode],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export function protocolError(method: string, cause: unknown) {
  const detail = message(cause)

  const kind =
    method === "DOM.setFileInputFiles" && /not.*file input/i.test(detail)
      ? "file-input"
      : method === "Runtime.callFunctionOn" && /not evaluate to a function/i.test(detail)
        ? "function"
        : /(?:node|object).*(?:not found|not exist)|(?:find|resolve).*(?:node|object)|detached/i.test(detail)
          ? "detached"
          : /context.*(?:destroyed|not found)|find.*context|session.*not found/i.test(detail)
            ? "changed"
            : /wasn't found|method not found|not implemented|not allowed/i.test(detail)
              ? "unsupported"
              : "other"

  const recovery = {
    "file-input":
      "Target is not a file input. Call browser.snapshot({tabID}) and choose an input[type=file] ref for browser.files.upload, or use browser.files.drop for a drop area.",
    function:
      "With ref, browser.evaluate needs a function that receives the element, for example (element) => element.textContent.",
    detached: "The element may have detached. Call browser.snapshot({tabID}) and use a fresh ref from that tab.",
    changed:
      "The document or frame changed. Call browser.frames({tabID}) and browser.snapshot({tabID}); use current frame IDs and refs.",
    unsupported:
      "This Chromium target does not support or allow the operation. Check desktop/plugin compatibility and report it; do not retry unchanged or disable browser security.",
    other:
      "Inspect browser.tabs.list({}) and the target tab before deciding to retry; a partially completed action is not automatically safe to repeat.",
  }[kind]

  const text = `${recovery} Chromium command ${method} failed: ${detail}`

  if (kind === "detached") return new CodedError(Browser.FailureCode.staleRef, text, { cause })

  if (kind === "changed") return new CodedError(Browser.FailureCode.documentChanged, text, { cause })

  return new Error(text, { cause })
}

export function browserFailure(action: Browser.Action, cause: unknown): Extract<Browser.Outcome, { type: "failure" }> {
  const detail = message(cause, 1_700)
  const navigation = ["tabs.open", "navigate", "back", "forward", "reload"].includes(action.type)
  const network = navigation ? detail.match(/\bERR_[A-Z_]+\b/)?.[0] : undefined

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
              ? "The site failed to load through the connected server. Check its URL/network and the OC2 connection before retrying; inspect the current tab first."
              : action.type === "screenshot" && /UnknownVizError|capture.*(?:failed|unavailable)/i.test(detail)
                ? `Chromium had no rendered frame of this tab for ${CAPTURE_DEADLINE_MS / 1000} seconds; the page may be stuck in a long task or crashed. Check it with browser.evaluate({tabID}) or browser.reload({tabID}), then capture again. If it keeps failing, report the capture failure instead of repeating it unchanged.`
                : undefined

  return {
    type: "failure",
    code: cause instanceof CodedError ? cause.code : network ? "navigation_failed" : "operation_failed",
    message: `browser.${action.type} failed. ${hint ? `${hint} Details: ${detail.slice(0, 400)}` : detail}`.slice(
      0,
      2_048,
    ),
  }
}

function message(cause: unknown, limit = 400) {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, limit)
}
