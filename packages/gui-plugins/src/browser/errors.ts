import { Browser } from "@opencode/plugin-browser/rpc"
import { CAPTURE_DEADLINE_MS, FULL_PAGE_DEADLINE_MS } from "./capture"
import { FileVerificationError } from "./file-verification"
import { NavigationDeadlineError } from "./navigation-deadline"
import { exitCodeHex, type PageEnd } from "./page-log"

/** A failure the server acts on by its code, such as a wait whose condition never held. */
export class CodedError extends Error {
  constructor(
    readonly code: (typeof Browser.FailureCode)[keyof typeof Browser.FailureCode] | "navigation_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/**
 * What an agent's command hears when the page of its tab stopped under it: why, as the desktop log has it, and how to
 * go on. The tab stays, unloaded, with `page_crashed` as its load error.
 */
export class PageEndedError extends Error {
  constructor(readonly end: PageEnd) {
    super(`${pageEnded(end)} Reload the tab with browser.reload({tabID}) and inspect its state before repeating anything; the desktop log has the details.`)
  }
}

function pageEnded(end: PageEnd) {
  switch (end.cause) {
    case "renderer-gone":
      return `This tab's page process ended: ${processGone(end.reason)} (exit code ${end.exitCode}${process.platform === "win32" ? `, ${exitCodeHex(end.exitCode)}` : ""}).`
    case "target-crashed":
      return "This tab's page process ended: Chromium reported a crash."
    case "debugger-detached":
      return `This tab's page was stopped: the desktop lost its debugger connection to it (${end.reason.slice(0, 100)}).`
    case "setup-failed":
      return "This tab's page was stopped: it did not become ready."
    case "frame-unprepared":
      return "This tab's page was stopped: one of its frames could not be prepared."
    case "passkeys-unrestricted":
      return "This tab's page was stopped: passkeys could not be turned off for it, which a tab the agent drives requires."
  }
}

/** Electron's reason for a process that is gone, in words. */
function processGone(reason: string) {
  switch (reason) {
    case "crashed":
      return "it crashed"
    case "oom":
      return "out of memory"
    case "killed":
      return "it was killed"
    case "abnormal-exit":
      return "it exited abnormally"
    case "launch-failed":
      return "it failed to start"
    case "integrity-failure":
      return "it failed a code integrity check"
    case "clean-exit":
      return "it exited"
    default:
      return reason.slice(0, 100)
  }
}

/**
 * Whether the tab itself reports how a rejected load ended, so the person's command did not fail: Chromium's own load
 * error, which the page area explains; a navigation that was stopped, replaced or became a download; or one still
 * under way when the command's deadline passed. The agent's commands still get every one of these as a failure.
 */
export function pageReports(error: Error) {
  if (error instanceof NavigationDeadlineError) return true

  if (error instanceof CodedError) return error.code === "navigation_failed"

  // Chromium's load errors carry its negative number beside the name; Node's own `ERR_` errors have no `errno`.
  return "errno" in error && "code" in error && String(error.code).startsWith("ERR_")
}

export function missingArtifact() {
  return new CodedError(Browser.FailureCode.previewUnavailable, "This artifact is no longer available on this session’s server.")
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
  if (cause instanceof FileVerificationError) return { type: "failure", code: cause._tag, message: cause.message }
  const detail = message(cause, 1_700)

  // Native and CDP errors may quote more than one internal URL. Never relay the raw error as recovery detail.
  if (/oc-preview:/i.test(detail))
    return { type: "failure", code: Browser.FailureCode.previewUnavailable, message: `browser.${action.type} failed. The workspace file could not be loaded.` }
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
                ? `Chromium could not provide a rendered frame (capture deadline ${(action.fullPage ? FULL_PAGE_DEADLINE_MS : CAPTURE_DEADLINE_MS) / 1000} seconds); the page may be stuck in a long task or crashed. Check it with browser.evaluate({tabID}) or browser.reload({tabID}), then capture again. If it keeps failing, report the capture failure instead of repeating it unchanged.`
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
