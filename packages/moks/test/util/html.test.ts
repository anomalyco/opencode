import { describe, expect, test } from "bun:test"
import { escapeHtml } from "../../src/util/html"

describe("escapeHtml", () => {
  test("escapes HTML metacharacters", () => {
    expect(escapeHtml(`</div><script>alert(1)</script><div class="x">`)).toBe(
      "&lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;div class=&quot;x&quot;&gt;",
    )
    expect(escapeHtml("a & b")).toBe("a &amp; b")
    expect(escapeHtml("it's fine")).toBe("it&#39;s fine")
    expect(escapeHtml("invalid_grant")).toBe("invalid_grant")
    expect(escapeHtml("")).toBe("")
    expect(escapeHtml("&<")).toBe("&amp;&lt;")
  })
})
