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
  expect(() => decode({ type: "wait", tabID, condition: "load", timeoutMs: -1 })).toThrow()
  expect(() => decode({ type: "click", tabID: "another-tab", ref: "e1" })).toThrow()
  expect(() => decode({ type: "network.list", tabID, resourceType: "imaginary" })).toThrow()
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
    Schema.decodeUnknownSync(Browser.Control)({ type: "attached", connectionID: "old-client", version: 3 }),
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
