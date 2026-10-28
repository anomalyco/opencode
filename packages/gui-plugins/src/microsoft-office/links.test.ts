import { describe, expect, test } from "bun:test"
import { externalUrl, wordLink } from "./links"

describe("externalUrl", () => {
  test("allows the web and mail addresses the host opens", () => {
    expect(externalUrl("https://example.com/a b")).toBe("https://example.com/a%20b")
    expect(externalUrl("http://example.com")).toBe("http://example.com/")
    expect(externalUrl("mailto:someone@example.com")).toBe("mailto:someone@example.com")
    expect(externalUrl("HTTPS://EXAMPLE.COM/#Sheet2!A1")).toBe("https://example.com/#Sheet2!A1")
  })

  test("refuses every other scheme and anything that is not a URL", () => {
    expect(externalUrl("javascript:alert(1)")).toBeUndefined()
    expect(externalUrl("file:///C:/Windows/System32/calc.exe")).toBeUndefined()
    expect(externalUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined()
    expect(externalUrl("tel:+15550100")).toBeUndefined()
    expect(externalUrl("vbscript:msgbox")).toBeUndefined()
    expect(externalUrl("example.com/page")).toBeUndefined()
  })
})

describe("wordLink", () => {
  test("follows bookmarks and allowed addresses", () => {
    expect(wordLink("#_Toc123")).toEqual({ kind: "internal", bookmark: "_Toc123" })
    expect(wordLink("https://example.com")).toEqual({ kind: "external", url: "https://example.com/" })
    expect(wordLink("mailto:someone@example.com")).toEqual({ kind: "external", url: "mailto:someone@example.com" })
  })

  test("leaves other links as text", () => {
    expect(wordLink(undefined)).toBeUndefined()
    expect(wordLink("")).toBeUndefined()
    expect(wordLink("#")).toBeUndefined()
    expect(wordLink("javascript:alert(1)")).toBeUndefined()
    expect(wordLink("file:///etc/passwd")).toBeUndefined()
    expect(wordLink("data:text/plain,hi")).toBeUndefined()
    expect(wordLink("tel:+15550100")).toBeUndefined()
  })
})
