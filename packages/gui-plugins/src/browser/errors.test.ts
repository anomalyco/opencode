import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { FileVerificationError } from "./file-verification"
import { undrawableMessage } from "./capture"
import { browserFailure, CodedError, missingArtifact, pageReports, protocolError } from "./errors"
import { NavigationDeadlineError } from "./navigation-deadline"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)

test("an unavailable artifact reports a preview failure, not a stale frame", () => {
  const failure = browserFailure({ type: "snapshot", tabID }, missingArtifact())
  expect(failure.code).toBe("preview_unavailable")
  expect(failure.message).toContain("artifact is no longer available")
  const verifier = browserFailure({ type: "snapshot", tabID }, new FileVerificationError())
  expect(verifier.code).toBe("file_verification_unavailable")
  expect(verifier.message).toContain("file verification could not be loaded")
})

test("native preview failures never export the private loader address", () => {
  const failure = browserFailure({ type: "preview", path: "report.html" }, new Error("ERR_FAILED loading 'oc-preview://grant/C:/repo/report.html'"))
  expect(failure.code).toBe("preview_unavailable")
  expect(failure.message).not.toContain("grant")
  expect(failure.message).not.toContain("C:/repo")
})

test("navigation failures explain the server network and never recommend disabling TLS", () => {
  const action: Browser.Action = { type: "navigate", tabID, url: "https://example.com" }
  const refused = browserFailure(action, new Error("net::ERR_CONNECTION_REFUSED"))
  expect(refused.code).toBe("navigation_failed")
  expect(refused.message).toContain("localhost means that server")
  expect(refused.message).toContain("hostname/port")
  const tls = browserFailure(action, new Error("net::ERR_CERT_AUTHORITY_INVALID"))
  expect(tls.message).toContain("do not bypass certificate checks")
  const aborted = browserFailure(action, new Error("net::ERR_ABORTED"))
  expect(aborted.message).toContain("browser.files.list({tabID})")
})

test("the person's command does not fail for a load the tab reports itself, and the agent still gets the failure", () => {
  // Electron rejects a load with Chromium's name and number.
  const load = (code: string, errno: number) => Object.assign(new Error(`${code} (${errno}) loading 'https://example.com/'`), { code, errno })
  const stopped = new CodedError("navigation_failed", "No page committed. The navigation was cancelled, failed, or became a download.")

  expect(pageReports(load("ERR_NAME_NOT_RESOLVED", -105))).toBe(true)
  expect(pageReports(load("ERR_ABORTED", -3))).toBe(true)
  // Stop, or a link that became a download, commits no page; a slow page outlives the command's deadline.
  expect(pageReports(stopped)).toBe(true)
  expect(pageReports(new NavigationDeadlineError())).toBe(true)
  // Anything else is a command that did not work, which the window says.
  expect(pageReports(new Error("Browser network is not ready; no tab was opened."))).toBe(false)
  expect(pageReports(new CodedError(Browser.FailureCode.previewUnavailable, "The preview could not be loaded"))).toBe(false)
  expect(pageReports(Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL" }))).toBe(false)

  const action: Browser.Action = { type: "navigate", tabID, url: "https://example.com" }
  expect(browserFailure(action, stopped).code).toBe("navigation_failed")
  expect(browserFailure(action, load("ERR_NAME_NOT_RESOLVED", -105)).code).toBe("navigation_failed")
})

test("native protocol errors keep the cause and give a valid recovery operation", () => {
  expect(protocolError("DOM.resolveNode", new Error("Could not find node with given id")).message).toContain(
    "browser.snapshot({tabID})",
  )
  expect(protocolError("Runtime.evaluate", new Error("Cannot find context with specified id")).message).toContain(
    "browser.frames({tabID})",
  )
  expect(
    protocolError("Runtime.callFunctionOn", new Error("Given expression does not evaluate to a function")).message,
  ).toContain("(element) => element.textContent")
  const unsupported = protocolError("Target.getBrowserContexts", new Error("Not allowed"))
  expect(unsupported.message).toContain("does not support or allow")
  expect(unsupported.message).toContain("do not retry unchanged")
  expect(unsupported.cause).toBeInstanceOf(Error)
  const failure = browserFailure({ type: "screenshot", tabID }, new Error("Capture failed: UnknownVizError"))
  expect(failure.message).not.toContain("browser.tabs.focus")
  expect(failure.message).toContain("browser.reload({tabID})")
  expect(failure.message).toContain("report the capture failure")
  const minimized = browserFailure({ type: "screenshot", tabID }, new Error(undrawableMessage("minimized")))
  expect(minimized.message).not.toContain("stuck")
})

test("a changed document, a stale ref and an unmet wait reach the server as codes, not words", () => {
  const evaluate: Browser.Action = { type: "evaluate", tabID, script: "1" }
  const code = (cause: Error) => browserFailure(evaluate, cause).code

  expect(code(protocolError("Runtime.evaluate", new Error("Cannot find context with specified id")))).toBe(
    Browser.FailureCode.documentChanged,
  )
  expect(code(protocolError("DOM.resolveNode", new Error("Could not find node with given id")))).toBe(
    Browser.FailureCode.staleRef,
  )
  expect(code(new CodedError(Browser.FailureCode.unmet, "Condition was not met within 10 ms."))).toBe(
    Browser.FailureCode.unmet,
  )
  // The same words in any other error carry no code.
  expect(code(new Error("The document changed before this operation ran. Condition was not met within 10 ms."))).toBe(
    "operation_failed",
  )
})

test("long page errors retain the operation context without classifying script text as a navigation error", () => {
  const failure = browserFailure(
    { type: "evaluate", tabID, script: "throw Error()" },
    new Error("ERR_CONNECTION_REFUSED " + "x".repeat(10_000)),
  )

  expect(failure.code).toBe("operation_failed")
  expect(failure.message.startsWith("browser.evaluate failed.")).toBe(true)
  expect(failure.message.length).toBeLessThanOrEqual(2_048)
})
