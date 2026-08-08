import { describe, expect, test } from "bun:test"
import { isSafeExternalUrl } from "./external-url"

describe("external URL policy", () => {
  test.each(["https://opencode.ai", "http://127.0.0.1:4096", "mailto:hello@opencode.ai"])("allows %s", (url) =>
    expect(isSafeExternalUrl(url)).toBe(true),
  )

  test.each(["file:///tmp/test", "javascript:alert(1)", "data:text/html,test", "vscode://file/tmp/test", "nope"])(
    "rejects %s",
    (url) => expect(isSafeExternalUrl(url)).toBe(false),
  )

  test("rejects non-string values", () => {
    expect(isSafeExternalUrl(null)).toBe(false)
    expect(isSafeExternalUrl({ toString: () => "https://opencode.ai" })).toBe(false)
  })
})
