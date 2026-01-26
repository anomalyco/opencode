import { describe, expect, test } from "bun:test"
import { markdownToHtml } from "../../../src/cli/cmd/tui/util/markdown-html"

describe("markdownToHtml", () => {
  describe("inline formatting", () => {
    test("converts bold text", () => {
      const result = markdownToHtml("**bold text**")
      expect(result).toContain('<strong style="font-weight: bold;">bold text</strong>')
    })

    test("converts italic text", () => {
      const result = markdownToHtml("*italic text*")
      expect(result).toContain('<em style="font-style: italic;">italic text</em>')
    })

    test("converts inline code", () => {
      const result = markdownToHtml("`code snippet`")
      expect(result).toContain(
        '<code style="font-family: monospace; background-color: #f0f0f0; padding: 2px 4px; border-radius: 3px;">code snippet</code>',
      )
    })

    test("converts combined formatting", () => {
      const result = markdownToHtml("**bold** and *italic* and `code`")
      expect(result).toContain('<strong style="font-weight: bold;">bold</strong>')
      expect(result).toContain('<em style="font-style: italic;">italic</em>')
      expect(result).toContain("code")
    })
  })

  describe("headers", () => {
    test("converts h1", () => {
      const result = markdownToHtml("# Header 1")
      expect(result).toContain('<h1 style="font-size: 2em; font-weight: bold; margin: 0.5em 0;">Header 1</h1>')
    })

    test("converts h2", () => {
      const result = markdownToHtml("## Header 2")
      expect(result).toContain('<h2 style="font-size: 1.5em; font-weight: bold; margin: 0.5em 0;">Header 2</h2>')
    })

    test("converts h3", () => {
      const result = markdownToHtml("### Header 3")
      expect(result).toContain('<h3 style="font-size: 1.25em; font-weight: bold; margin: 0.5em 0;">Header 3</h3>')
    })

    test("converts h4", () => {
      const result = markdownToHtml("#### Header 4")
      expect(result).toContain('<h4 style="font-size: 1em; font-weight: bold; margin: 0.5em 0;">Header 4</h4>')
    })

    test("converts h5", () => {
      const result = markdownToHtml("##### Header 5")
      expect(result).toContain('<h5 style="font-size: 0.875em; font-weight: bold; margin: 0.5em 0;">Header 5</h5>')
    })

    test("converts h6", () => {
      const result = markdownToHtml("###### Header 6")
      expect(result).toContain('<h6 style="font-size: 0.75em; font-weight: bold; margin: 0.5em 0;">Header 6</h6>')
    })
  })

  describe("lists", () => {
    test("converts unordered list", () => {
      const result = markdownToHtml("- Item 1\n- Item 2\n- Item 3")
      expect(result).toContain('<ul style="margin: 0.5em 0; padding-left: 1.5em;">')
      expect(result).toContain("<li>Item 1</li>")
      expect(result).toContain("<li>Item 2</li>")
      expect(result).toContain("<li>Item 3</li>")
      expect(result).toContain("</ul>")
    })

    test("converts ordered list", () => {
      const result = markdownToHtml("1. First\n2. Second\n3. Third")
      expect(result).toContain('<ol style="margin: 0.5em 0; padding-left: 1.5em;">')
      expect(result).toContain("<li>First</li>")
      expect(result).toContain("<li>Second</li>")
      expect(result).toContain("<li>Third</li>")
      expect(result).toContain("</ol>")
    })
  })

  describe("links", () => {
    test("converts link without title", () => {
      const result = markdownToHtml("[OpenCode](https://opencode.ai)")
      expect(result).toContain(
        '<a href="https://opencode.ai" style="color: #0066cc; text-decoration: underline;">OpenCode</a>',
      )
    })

    test("converts link with title", () => {
      const result = markdownToHtml('[OpenCode](https://opencode.ai "OpenCode Website")')
      expect(result).toContain('<a href="https://opencode.ai"')
      expect(result).toContain('title="OpenCode Website"')
      expect(result).toContain(">OpenCode</a>")
    })
  })

  describe("blockquotes", () => {
    test("converts blockquote", () => {
      const result = markdownToHtml("> This is a quote")
      expect(result).toContain(
        '<blockquote style="border-left: 3px solid #ccc; padding-left: 1em; margin: 0.5em 0; color: #666;">',
      )
      expect(result).toContain("This is a quote")
      expect(result).toContain("</blockquote>")
    })
  })

  describe("code blocks", () => {
    test("converts code block", () => {
      const result = markdownToHtml("```\nconst x = 1\nconsole.log(x)\n```")
      expect(result).toContain("<pre")
      expect(result).toContain("<code>")
      expect(result).toContain("const x = 1")
      expect(result).toContain("console.log(x)")
      expect(result).toContain("</code>")
      expect(result).toContain("</pre>")
    })

    test("converts code block with language", () => {
      const result = markdownToHtml("```javascript\nconst x = 1\n```")
      expect(result).toContain("<pre")
      expect(result).toContain("<code>")
      expect(result).toContain("const x = 1")
    })
  })

  describe("tables", () => {
    test("converts table", () => {
      const markdown = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |`

      const result = markdownToHtml(markdown)
      expect(result).toContain('<table style="border-collapse: collapse; margin: 0.5em 0;">')
      expect(result).toContain("<thead>")
      expect(result).toContain("<tbody>")
      expect(result).toContain('<th style="border: 1px solid #ddd; padding: 8px;">Header 1</th>')
      expect(result).toContain('<th style="border: 1px solid #ddd; padding: 8px;">Header 2</th>')
      expect(result).toContain('<td style="border: 1px solid #ddd; padding: 8px;">Cell 1</td>')
      expect(result).toContain('<td style="border: 1px solid #ddd; padding: 8px;">Cell 2</td>')
    })
  })

  describe("horizontal rules", () => {
    test("converts horizontal rule", () => {
      const result = markdownToHtml("---")
      expect(result).toContain('<hr style="border: none; border-top: 1px solid #ccc; margin: 1em 0;">')
    })
  })

  describe("paragraphs", () => {
    test("converts paragraph", () => {
      const result = markdownToHtml("This is a paragraph.")
      expect(result).toContain('<p style="margin: 0.5em 0;">This is a paragraph.</p>')
    })

    test("converts multiple paragraphs", () => {
      const result = markdownToHtml("First paragraph.\n\nSecond paragraph.")
      expect(result).toContain("First paragraph")
      expect(result).toContain("Second paragraph")
    })
  })

  describe("HTML escaping", () => {
    test("escapes HTML in inline code", () => {
      const result = markdownToHtml("`<script>alert('xss')</script>`")
      expect(result).toContain("&lt;script&gt;")
      expect(result).toContain("&lt;/script&gt;")
      expect(result).not.toContain("<script>")
    })

    test("escapes HTML in code blocks", () => {
      const result = markdownToHtml("```\n<div>Test</div>\n```")
      expect(result).toContain("&lt;div&gt;")
      expect(result).toContain("&lt;/div&gt;")
      expect(result).not.toContain("<div>Test</div>")
    })

    test("escapes ampersands", () => {
      const result = markdownToHtml("`foo & bar`")
      expect(result).toContain("foo &amp; bar")
    })

    test("escapes quotes", () => {
      const result = markdownToHtml("`\"quoted\"` and `'single'`")
      expect(result).toContain("&quot;quoted&quot;")
      expect(result).toContain("&#39;single&#39;")
    })
  })

  describe("edge cases", () => {
    test("handles empty input", () => {
      const result = markdownToHtml("")
      expect(result).toBe("")
    })

    test("handles whitespace-only input", () => {
      const result = markdownToHtml("   \n\n   ")
      expect(result.trim()).toBe("")
    })

    test("handles nested formatting", () => {
      const result = markdownToHtml("**bold with *italic* inside**")
      expect(result).toContain("<strong")
      expect(result).toContain("<em")
      expect(result).toContain("italic")
    })

    test("handles special characters in text", () => {
      const result = markdownToHtml("Text with & < > \" ' characters")
      expect(result).toContain("&amp;")
    })

    test("preserves newlines in code blocks", () => {
      const result = markdownToHtml("```\nline 1\nline 2\nline 3\n```")
      expect(result).toContain("line 1")
      expect(result).toContain("line 2")
      expect(result).toContain("line 3")
    })
  })

  describe("complex markdown", () => {
    test("converts mixed content", () => {
      const markdown = `# Title

This is a paragraph with **bold** and *italic* text.

## Subsection

- Item 1
- Item 2 with \`code\`
- Item 3

\`\`\`javascript
const hello = "world"
console.log(hello)
\`\`\`

> A thoughtful quote

[A link](https://example.com)

---

Final paragraph.`

      const result = markdownToHtml(markdown)
      expect(result).toContain('<h1 style="font-size: 2em')
      expect(result).toContain('<h2 style="font-size: 1.5em')
      expect(result).toContain("<strong")
      expect(result).toContain("<em")
      expect(result).toContain("<ul")
      expect(result).toContain("<pre")
      expect(result).toContain("<blockquote")
      expect(result).toContain("<a href=")
      expect(result).toContain("<hr")
    })
  })
})
