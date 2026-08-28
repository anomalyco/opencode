import { expect, test } from "bun:test"
import { createMarkdownParser } from "./marked-parser"

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
