import { describe, expect, test } from "bun:test"
import createDOMPurify from "dompurify"
import { JSDOM } from "jsdom"
import { config } from "./markdown-sanitize"

const DOMPurify = createDOMPurify(new JSDOM("").window)

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

describe("markdown sanitize", () => {
  test("keeps safe links with target and rel", () => {
    const out = sanitize(`<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>`)
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  test("strips script tags and contents", () => {
    expect(sanitize("<script>alert(1)</script>hello")).toBe("hello")
  })

  test("strips inline event handlers", () => {
    expect(sanitize('<img src="x" onerror="alert(1)">')).not.toContain("onerror")
  })

  test("forbids style tags", () => {
    expect(sanitize("<style>body{color:red}</style><p>ok</p>")).toBe("<p>ok</p>")
  })

  test("keeps katex markup", () => {
    const out = sanitize('<span class="katex"><span class="katex-html">x</span></span>')
    expect(out).toContain('class="katex"')
  })
})
