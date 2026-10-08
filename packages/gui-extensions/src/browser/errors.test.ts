import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { BrowserError, browserFailure, protocolError } from "./errors"

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
    "browser.find again",
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
})

// A hidden tab's failures used to read as a bare UnknownVizError on click and as advice to focus the tab, which never
// helped; every action now names the cause and the fix.
test.each([
  { type: "screenshot", tabID } as const,
  { type: "click", tabID, target: "text=Save" } as const,
  { type: "hover", tabID, target: "#menu" } as const,
])("render failures on $type name the hidden user tab and the agent-tab fix", (action) => {
  const failure = browserFailure(action, new Error("UnknownVizError"))
  expect(failure.code).toBe("tab_hidden")
  expect(failure.message).toContain("browser.tabs.open({url})")
  expect(failure.message).not.toContain("browser.tabs.focus")
})

test("coded browser errors keep their code", () => {
  const failure = browserFailure(
    { type: "click", tabID, target: "text=Nope" },
    new BrowserError("not_found", "Nothing matched text=Nope after 5000 ms."),
  )

  expect(failure.code).toBe("not_found")
  expect(failure.message).toContain("Nothing matched text=Nope")
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
