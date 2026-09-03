import { expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { Browser } from "@opencode-ai/plugin-browser/rpc"
import { browserFailure, protocolError } from "../src/main/browser/errors"
import { createBrowserFiles } from "../src/main/browser/files"
import { analyzeCpu, analyzeTrace, parseHeap } from "../src/main/browser/analysis"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)

test("navigation failures explain the desktop network and never recommend disabling TLS", () => {
  const action: Browser.Action = { type: "navigate", tabID, url: "https://example.com" }
  const refused = browserFailure(action, new Error("net::ERR_CONNECTION_REFUSED"))
  expect(refused.code).toBe("navigation_failed")
  expect(refused.message).toContain("localhost means the desktop")
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

test("files distinguish pending, failed, unknown and missing desktop copies", async () => {
  const files = createBrowserFiles(() => ["https://example.com"])
  await files.ready
  try {
    const pending = files.add("download.txt", "text/plain")
    expect(() => files.get(pending.id)).toThrow("do not start a duplicate download")
    pending.state = "failed"
    expect(() => files.get(pending.id)).toThrow("Inspect browser.console")
    expect(() => files.get(Browser.FileID.make(`file_${crypto.randomUUID()}`))).toThrow(
      "not a server path or request ID",
    )
    const id = await files.save("capture.json", "application/json", new TextEncoder().encode("{}"))
    await rm(files.get(id).path)
    await expect(files.transfer(id)).rejects.toThrow("on the desktop")
    await expect(
      files.save("large.bin", "application/octet-stream", new Uint8Array(Browser.MAX_FILE_BYTES + 1)),
    ).rejects.toThrow("Do not retry an identical capture")
    await expect(files.save(".", "text/plain", new Uint8Array([1]))).rejects.toThrow(
      "Cannot write the capture on the desktop",
    )
    expect(files.list().find((file) => file.name === ".")?.state).toBe("failed")
  } finally {
    await files.dispose()
  }
})

test("wrong capture formats identify the matching capture tool", () => {
  expect(() => analyzeTrace({ nodes: [] })).toThrow("browser.trace.stop")
  expect(() => analyzeCpu({ traceEvents: [] })).toThrow("browser.cpu.stop")
  expect(() => parseHeap({ traceEvents: [] })).toThrow("browser.heap.snapshot")
})
