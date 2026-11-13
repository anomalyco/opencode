import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { undrawableMessage } from "./capture"
import { browserFailure, CodedError, protocolError } from "./errors"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)

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
