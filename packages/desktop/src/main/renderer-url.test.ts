import { describe, expect, test } from "bun:test"
import { resolveRendererDevUrl } from "./renderer-url"

describe("renderer development URL", () => {
  test("allows a valid URL in development", () => {
    expect(resolveRendererDevUrl(false, "http://localhost:5173")?.origin).toBe("http://localhost:5173")
  })

  test("ignores the override in packaged applications", () => {
    expect(resolveRendererDevUrl(true, "https://example.com")).toBeUndefined()
  })

  test("ignores invalid URLs", () => {
    expect(resolveRendererDevUrl(false, "not a url")).toBeUndefined()
  })
})
