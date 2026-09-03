import { expect, test } from "bun:test"
import { Browser } from "../src/browser.js"
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
