import { describe, expect, test } from "bun:test"
import { cleanMarkdownHTML } from "./markdown"

describe("markdown rich copy", () => {
  test("removes markdown copy buttons from html", () => {
    const html = cleanMarkdownHTML(
      '<p>Hello</p><button data-slot="markdown-copy-button">Copy</button><pre><code>echo test</code></pre>',
    )

    expect(html).toContain("<p>Hello</p>")
    expect(html).toContain("<pre><code>echo test</code></pre>")
    expect(html).not.toContain("markdown-copy-button")
    expect(html).not.toContain(">Copy<")
  })
})
