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
