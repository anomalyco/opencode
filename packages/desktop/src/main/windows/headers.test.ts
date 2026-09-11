import { describe, expect, test } from "bun:test"
import { addRendererHeaders, documentPolicyHeader, jsCallStacksDocumentPolicy, upsertHeader } from "./headers"

describe("renderer response headers", () => {
  test("keeps the server's exact allow-headers list so Chromium can reuse the cached preflight", () => {
    const headers = {
      "access-control-allow-origin": ["oc://renderer"],
      "access-control-allow-headers": ["authorization"],
      "access-control-max-age": ["86400"],
    }
    addRendererHeaders(headers, { document: false })
    expect(headers).toEqual({
      "access-control-allow-origin": ["*"],
      "access-control-allow-headers": ["authorization"],
      "access-control-max-age": ["86400"],
    })
  })

  test("fills CORS headers for servers that send none, naming authorization explicitly", () => {
    const headers: Record<string, string[]> = { "content-type": ["application/json"] }
    addRendererHeaders(headers, { document: false })
    expect(headers["Access-Control-Allow-Origin"]).toEqual(["*"])
    expect(headers["Access-Control-Allow-Headers"]).toEqual(["*, authorization"])
    expect(headers["Access-Control-Max-Age"]).toEqual(["7200"])
  })

  test("adds the crash-report document policy only to renderer documents", () => {
    const document = {}
    addRendererHeaders(document, { document: true })
    expect(Reflect.get(document, documentPolicyHeader)).toEqual([jsCallStacksDocumentPolicy])
    const asset = {}
    addRendererHeaders(asset, { document: false })
    expect(Object.keys(asset)).not.toContain(documentPolicyHeader)
  })

  test("upsert replaces a header regardless of key casing", () => {
    const headers = { "X-Test": ["a"] }
    upsertHeader(headers, "x-test", ["b"])
    expect(headers).toEqual({ "X-Test": ["b"] })
  })
})
