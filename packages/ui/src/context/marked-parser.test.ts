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

test("renders inline dollar math", async () => {
  expect(await parser.parse("$x^2$")).toContain('<span class="katex">')
  expect(await parser.parse("$E = mc^2$")).toContain('<span class="katex">')
  expect(await parser.parse("inline $v_\\pi(s)$ math")).toContain('<span class="katex">')
})

test("renders same-line double dollar display math", async () => {
  expect(await parser.parse("$$x^2$$")).toContain('<span class="katex-display">')
})

test("renders bracket display math", async () => {
  expect(await parser.parse("\\[\nx^2\n\\]\n")).toContain('<span class="katex-display">')
  expect(await parser.parse("\\[x^2\\]\n")).toContain('<span class="katex-display">')
  expect(await parser.parse("text \\[x^2\\] text")).toContain('<span class="katex-display">')
})

test("does not render currency as math", async () => {
  const html = await parser.parse("Costs $5 and $10 today.")
  expect(html).not.toContain("katex")
  expect(html).toContain("$5")
})

test("uses the configured code highlighter", async () => {
  expect(await parser.parse("```ts\nconst value = 1\n```\n")).toBe('<pre data-language="ts">const value = 1</pre>\n')
})
