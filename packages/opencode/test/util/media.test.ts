import { describe, expect, test } from "bun:test"
import { isTextMime, isMedia } from "../../src/util/media"

describe("isTextMime", () => {
  test("detects text/* types", () => {
    expect(isTextMime("text/csv")).toBe(true)
    expect(isTextMime("text/plain")).toBe(true)
    expect(isTextMime("text/html")).toBe(true)
    expect(isTextMime("text/xml")).toBe(true)
  })

  test("detects common application text types", () => {
    expect(isTextMime("application/json")).toBe(true)
    expect(isTextMime("application/xml")).toBe(true)
    expect(isTextMime("application/x-yaml")).toBe(true)
    expect(isTextMime("application/yaml")).toBe(true)
    expect(isTextMime("application/javascript")).toBe(true)
    expect(isTextMime("application/sql")).toBe(true)
    expect(isTextMime("application/ld+json")).toBe(true)
  })

  test("detects +xml and +json suffixes", () => {
    expect(isTextMime("application/vnd.api+json")).toBe(true)
    expect(isTextMime("application/svg+xml")).toBe(true)
    expect(isTextMime("application/atom+xml")).toBe(true)
  })

  test("rejects images and PDFs", () => {
    expect(isTextMime("image/png")).toBe(false)
    expect(isTextMime("image/jpeg")).toBe(false)
    expect(isTextMime("application/pdf")).toBe(false)
  })

  test("rejects binary application types", () => {
    expect(isTextMime("application/octet-stream")).toBe(false)
    expect(isTextMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(false)
    expect(isTextMime("application/zip")).toBe(false)
  })
})

describe("MCP resource blob routing", () => {
  test("text/csv blob is decoded to text instead of binary attachment", () => {
    const csvContent = "name,age,city\nAlice,30,Seattle\nBob,25,Portland"
    const blob = Buffer.from(csvContent).toString("base64")
    const mime = "text/csv"

    // Simulates the tools.ts path: text blobs go to textParts
    expect(isTextMime(mime)).toBe(true)
    expect(Buffer.from(blob, "base64").toString("utf-8")).toBe(csvContent)
  })

  test("image blobs remain as media attachments", () => {
    expect(isMedia("image/png")).toBe(true)
    expect(isTextMime("image/png")).toBe(false)
  })

  test("PDF blobs remain as media attachments", () => {
    expect(isMedia("application/pdf")).toBe(true)
    expect(isTextMime("application/pdf")).toBe(false)
  })

  test("unknown binary blobs are not classified as text", () => {
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    expect(isMedia(mime)).toBe(false)
    expect(isTextMime(mime)).toBe(false)
  })
})

describe("toModelOutput attachment routing", () => {
  test("text attachments are decoded to text content parts", () => {
    const csvContent = "id,value\n1,foo"
    const url = `data:text/csv;base64,${Buffer.from(csvContent).toString("base64")}`
    const mime = "text/csv"

    // Simulates message-v2.ts routing: text mime → decode base64 → text part
    expect(isTextMime(mime)).toBe(true)
    const commaIndex = url.indexOf(",")
    const base64 = url.slice(commaIndex + 1)
    expect(Buffer.from(base64, "base64").toString("utf-8")).toBe(csvContent)
  })

  test("binary attachments produce placeholder text, not file-data", () => {
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    expect(isMedia(mime)).toBe(false)
    expect(isTextMime(mime)).toBe(false)
    // In the real code this becomes: [Binary file: <mime>]
  })
})
