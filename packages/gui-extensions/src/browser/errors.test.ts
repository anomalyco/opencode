import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { browserFailure, protocolError } from "./errors"

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
  const failure = browserFailure({ type: "screenshot", tabID }, new Error("UnknownVizError"))
  expect(failure.message).toContain("browser.tabs.focus({tabID})")
  expect(failure.message).toContain("report the capture failure")
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
