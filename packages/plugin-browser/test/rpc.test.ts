import { expect, test } from "bun:test"
import { Browser } from "../src/rpc.js"
import { Schema } from "effect"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)

test("every page operation requires its own tab ID", () => {
  for (const operation of Browser.Operations) {
    if (operation.name === "tabs.list" || operation.name === "tabs.open") continue
    expect(Schema.decodeUnknownOption(operation.input)({})._tag).toBe("None")
  }
  expect(Schema.decodeUnknownSync(Browser.Action)({ type: "tabs.list" })).toEqual({ type: "tabs.list" })
  expect(Schema.decodeUnknownSync(Browser.Action)({ type: "tabs.open" })).toEqual({ type: "tabs.open" })
})

test("browser input bounds and optional fields survive the wire", () => {
  const decode = Schema.decodeUnknownSync(Browser.Action)
  expect(decode({ type: "console", tabID })).toEqual({ type: "console", tabID })
  expect(() => decode({ type: "console", tabID, limit: 501 })).toThrow()
  expect(() => decode({ type: "console", tabID, limit: 0 })).toThrow()
  expect(() => decode({ type: "console", tabID, level: "verbose" })).toThrow()
  expect(() => decode({ type: "wait", tabID, load: true, timeoutMs: -1 })).toThrow()
  expect(() => decode({ type: "wait", tabID, timeoutMs: Browser.MAX_WAIT_MS + 1 })).toThrow()
  expect(() => decode({ type: "click", tabID: "another-tab", target: "e1" })).toThrow()
  expect(() => decode({ type: "click", tabID, target: "" })).toThrow()
  expect(decode({ type: "evaluate", tabID, target: "@e5", script: "(element) => element.id" })).toMatchObject({
    target: "@e5",
  })
  expect(() => decode({ type: "network.list", tabID, resourceType: "imaginary" })).toThrow()
})

// Every element parameter takes the same locator grammar, so a guess that works for one tool works for all of them.
test("element parameters share one locator schema", () => {
  const locators = Browser.Operations.flatMap((operation) =>
    Object.entries(operation.input.fields).flatMap(([name, field]) =>
      ["target", "from", "to"].includes(name) ? [{ operation: operation.name, name, field }] : [],
    ),
  )
  expect(locators.map((item) => item.operation)).toEqual(
    expect.arrayContaining(["click", "hover", "fill", "type", "press", "scroll", "find", "read", "evaluate", "wait", "screenshot", "snapshot", "upload", "drop", "drag"]),
  )
  const decode = Schema.decodeUnknownSync(Browser.Action)
  for (const target of ["@e12", "text=Save", 'role=button[name="Send"]', "#id >> nth=1"])
    expect(decode({ type: "click", tabID, target })).toMatchObject({ target })
})

test("agent tools are the public surface; the pane's own history controls stay internal", () => {
  const tools = Browser.Operations.filter((operation) => !operation.internal).map((operation) => operation.name)
  expect(tools).not.toContain("back")
  expect(tools).not.toContain("stop")
  expect(tools).toEqual(expect.arrayContaining(["read", "type", "watch", "emulate", "storage", "handoff"]))
})

test("the server waits for long actions instead of timing them out at a fixed minute", () => {
  expect(Browser.deadline({ type: "tabs.list" })).toBe(60_000)
  expect(Browser.deadline({ type: "wait", tabID, timeoutMs: 110_000 })).toBe(125_000)
  expect(Browser.deadline({ type: "watch", tabID, script: "1", durationMs: 90_000 })).toBe(105_000)
  expect(Browser.deadline({ type: "handoff", tabID, reason: "Sign in" })).toBe(615_000)
})

test("browser files are bounded bytes, not remote filesystem paths", () => {
  const id = `file_${crypto.randomUUID()}`
  const decode = Schema.decodeUnknownSync(Browser.File)
  expect(decode({ id, name: "file.bin", mime: "application/octet-stream", data: "AAEC/w==" }).data).toEqual(
    new Uint8Array([0, 1, 2, 255]),
  )
  expect(() =>
    decode({
      id,
      name: "file.bin",
      mime: "application/octet-stream",
      data: Buffer.alloc(Browser.MAX_FILE_BYTES + 1).toString("base64"),
    }),
  ).toThrow()
})

test("network lifecycle and RPC version are explicit", () => {
  const request = { id: "request", url: "https://example.com", method: "GET", resourceType: "document", timestampMs: 1 }
  const decode = Schema.decodeUnknownSync(Browser.NetworkRequest)
  expect(decode({ ...request, state: "completed", statusCode: 404, durationMs: 3 }).state).toBe("completed")
  expect(() => decode({ ...request, state: "failed" })).toThrow()
  expect(() => Schema.decodeUnknownSync(Browser.Control)({ type: "attached", connectionID: "old-client" })).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Browser.Control)({ type: "attached", connectionID: "old-client", version: 4 }),
  ).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(Browser.Control)({ type: "attached", connectionID: "old-client", version: 2 }),
  ).toThrow()
  expect(Schema.decodeUnknownSync(Browser.Definition.methods.attach.output)("replaced")).toBe("replaced")
})

// Tool search matches query words as substrings of the description, folding a trailing "s"/"es".
// Each phrase an agent is likely to search for when it wants the user to see a file must hit.
test.each([
  "show file to user",
  "display file",
  "open file for user",
  "view result",
  "present output",
  "artifact",
  "media",
  "preview",
  "image",
  "images",
  "screenshot",
  "screenshots",
  "png",
  "jpeg",
  "gif",
  "chart",
  "plot",
  "photo",
  "video",
  "mp4",
  "audio",
  "pdf",
  "document",
  "html page",
  "markdown",
  "diagram",
  "csv",
  "table",
  "font",
  "svg",
  "render",
  "source code",
])("browser.preview is found by searching %s", (query) => {
  const preview = Browser.Operations.find((operation) => operation.name === "preview")!
  const description = preview.description.toLowerCase()
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  for (const term of terms) {
    const forms = [
      term,
      ...(term.endsWith("es") ? [term.slice(0, -2)] : []),
      ...(term.endsWith("s") ? [term.slice(0, -1)] : []),
    ]
    expect(forms.some((form) => description.includes(form))).toBe(true)
  }
})

test("network RPC is bounded bytes and does not add model tools", () => {
  expect(Browser.Operations.some((operation) => operation.name.startsWith("tunnel."))).toBe(false)
  expect(Schema.decodeUnknownSync(Browser.TunnelRead)({ data: "AAEC", eof: false }).data).toEqual(
    new Uint8Array([0, 1, 2]),
  )
  expect(() =>
    Schema.decodeUnknownSync(Browser.TunnelRead)({
      data: Buffer.alloc(Browser.TUNNEL_CHUNK_BYTES + 1).toString("base64"),
      eof: false,
    }),
  ).toThrow()
  expect(() => Schema.decodeUnknownSync(Browser.TunnelTarget)({ host: "localhost", port: 0 })).toThrow()
})
