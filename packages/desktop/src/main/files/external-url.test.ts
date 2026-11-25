import { describe, expect, test } from "bun:test"
import { resolveExternalURL } from "./external-url"

describe("external URLs", () => {
  test("opens only web and mail URLs externally", () => {
    expect(resolveExternalURL("https://example.com/a?b=c")).toBe("https://example.com/a?b=c")
    expect(resolveExternalURL("http://example.com")).toBe("http://example.com/")
    expect(resolveExternalURL("mailto:hello@opencode.ai")).toBe("mailto:hello@opencode.ai")

    for (const url of ["file:///tmp/index.html", "javascript:alert(1)", "data:text/html,hello", "not a url"])
      expect(resolveExternalURL(url)).toBeUndefined()
  })

})
