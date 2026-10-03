import { expect, test } from "bun:test"
import { createMarkdownParser } from "./marked-parser"
import { parseSmallMarkdown } from "./marked-base"

const parser = createMarkdownParser((code, language) => `<pre data-language="${language}">${code}</pre>`)

test("renders links with application attributes", async () => {
  expect(await parser.parse("[OpenCode](https://opencode.ai)")).toBe(
    '<p><a href="https://opencode.ai" class="external-link" target="_blank" rel="noopener noreferrer">OpenCode</a></p>\n',
  )
})

test("renders inline and block math", async () => {
  expect(await parser.parse("\\(x^2\\)")).toContain('<span class="katex">')
  expect(await parser.parse("$$\nx^2\n$$\n")).toContain('<span class="katex-display">')
})

test("renders single-dollar inline math", async () => {
  const html = await parser.parse("Given $f(0)=f(0)+f(0)$ it follows that $f(0)=0$, so $f(-2)=-f(2)=4$")
  expect(html).toContain('<span class="katex">')
  expect(html).not.toContain("$")
})

test("renders symbol-heavy inline math", async () => {
  const html = await parser.parse("The solution set is $(-\\infty,-3)\\cup(1,+\\infty)$ where $x_1<x_2$ and $x \\in \\mathbb{R}$")
  expect(html).toContain('<span class="katex">')
  expect(html).not.toContain("$")
})

test("renders CJK text inside \\text{}", async () => {
  const html = await parser.parse("Given $\\text{速度} \\times \\text{时间} = \\text{路程}$, solve for speed")
  expect(html).toContain('<span class="katex">')
  expect(html).not.toContain("$")
})

test("renders single-line dollar-block math", async () => {
  const html = await parser.parse("Derivation:\n\n$$f(-x^2)>f(2x)+f(-3)=f(2x-3)$$\n")
  expect(html).toContain('<span class="katex-display">')
  expect(html).not.toContain("$$")
})

test("renders block math glued to preceding text", async () => {
  const html = await parser.parse("so the inequality becomes\n$$\nx^2+2x-3>0\\;\\Rightarrow\\;(x+3)(x-1)>0\n$$\n")
  expect(html).toContain('<span class="katex-display">')
  expect(html).not.toContain("$$")
})

test("renders double-dollar display math inside a paragraph", async () => {
  const html = await parser.parse("Conclusion $$x<-3$$ or $$x>1$$ holds")
  expect(html).toContain('<span class="katex-display">')
  expect(html).not.toContain("$$")
})

test("leaves money amounts as text", async () => {
  const html = await parser.parse("It costs $5, originally $10, ranging from $1,000 to $2,000.")
  expect(html).not.toContain("katex")
  expect(html).toContain("$5")
  expect(html).toContain("$10")
})

test("leaves unclosed math delimiters as text without throwing", async () => {
  const html = await parser.parse("Unclosed $f(0)=f(0) keeps streaming\n\nand $$\nx=1")
  expect(html).not.toContain("katex")
  expect(html).toContain("$f(0)")
})

test("renders invalid latex as inline error instead of throwing", async () => {
  const html = await parser.parse("$\\notacommand{x}$")
  expect(html).toContain('<span class="katex">')
  expect(html).toContain("#cc0000")
})

test("keeps dollar delimiters literal inside code", async () => {
  const inline = await parser.parse("Use `$f(0)$` as a placeholder")
  expect(inline).toContain("<code>$f(0)$</code>")
  expect(inline).not.toContain("katex")
  expect(await parser.parse("```text\n$<a>$ and $b$\n```\n")).toBe(
    '<pre data-language="text">$<a>$ and $b$</pre>\n',
  )
})

test("plain markdown is unaffected by the math extension", async () => {
  const html = await parser.parse("# Heading\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- list **bold** *italic*\n")
  expect(html).toContain("<h1>Heading</h1>")
  expect(html).toContain("<table>")
  expect(html).toContain("<strong>bold</strong>")
  expect(html).toContain("<em>italic</em>")
  expect(html).not.toContain("katex")
})

test("uses the configured code highlighter", async () => {
  expect(await parser.parse("```ts\nconst value = 1\n```\n")).toBe('<pre data-language="ts">const value = 1</pre>\n')
})

test.each(["```", "~~~"])("recognizes an empty %s fence at EOF", async (fence) => {
  expect(await parser.parse(`foo\n${fence}`)).toBe('<p>foo</p>\n<pre data-language=""></pre>\n')
})

test("preserves emphasis when rejecting an outer reference link", async () => {
  expect(await parser.parse("[foo *bar [baz](/url) qux*][ref]\n\n[ref]: /uri")).toBe(
    '<p>[foo <em>bar <a href="/url" class="external-link" target="_blank" rel="noopener noreferrer">baz</a> qux</em>]<a href="/uri" class="external-link" target="_blank" rel="noopener noreferrer">ref</a></p>\n',
  )
})

test.each([
  "Plain text with **bold**, *emphasis*, ~~deleted~~, and `inline code`.",
  "## Heading\n\n> Quote\n\n- [x] Done\n- Nested\n  - item",
  "| A | B |\n| --- | ---: |\n| one | two |",
  '[link](https://example.com "Title") and <https://example.com>',
  "[reference][key]\n\n[key]: https://example.com",
  "[foo *bar [baz](/url) qux*][ref]\n\n[ref]: /uri",
  '<img src="image.png" onerror="alert(1)"><script>alert(2)</script>',
  "hello\r\n\r\nworld",
])("small Markdown uses the same rendering rules: %s", async (text) => {
  expect(parseSmallMarkdown(text)).toBe(await parser.parse(text))
})

test.each([
  "```ts\nconst answer = 42\n```",
  "~~~\ncode\n~~~",
  "    indented code",
  "> ```ts\n> const nested = true\n> ```",
  "- item\n\n      nested code",
  "foo\n```",
  "\\(x^2\\)",
  "$$\nx^2\n$$\n",
  "a".repeat(1025),
])("leaves code, math, and large Markdown to the worker: %s", (text) => {
  expect(parseSmallMarkdown(text)).toBeUndefined()
})
