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

test("renders single-dollar inline math", async () => {
  const html = await parser.parse("The model $y = \\beta_0 + \\beta_1 x$ is linear")
  expect(html).toContain('<span class="katex">')
  expect(html).not.toContain("$y = \\beta_0")
})

test("single-dollar math with common econometrics commands", async () => {
  const html = await parser.parse("$\\sqrt{N}(\\hat\\beta-\\beta_0) \\xrightarrow{d} N(0, A_0^{-1}B_0 A_0^{-1})$")
  expect(html).toContain('<span class="katex">')
  expect(html).toContain("katex-mathml")
})

test("single-dollar does not treat currency as math", async () => {
  expect(await parser.parse("cost is $0.02/GB and $5 today")).toBe("<p>cost is $0.02/GB and $5 today</p>\n")
})

test("single-dollar with whitespace after is not math", async () => {
  expect(await parser.parse("total is $ 5")).toBe("<p>total is $ 5</p>\n")
})

test("single-dollar formula starting with number still renders", async () => {
  expect(await parser.parse("LR:$2(L_{ur}-L_r)\\sim\\chi^2(Q)$")).toContain('<span class="katex">')
})

test("single-dollar unclosed is left as-is", async () => {
  expect(await parser.parse("price is $5 today, total $")).toBe("<p>price is $5 today, total $</p>\n")
})

test("single-dollar with escaped dollar inside", async () => {
  const html = await parser.parse("price $p = \\$5$ today")
  expect(html).toContain('<span class="katex">')
})

test("single-dollar does not cross newlines", async () => {
  expect(await parser.parse("line one $\nx^2\n$ line two")).toBe("<p>line one $\nx^2\n$ line two</p>\n")
})

test("uses the configured code highlighter", async () => {
  expect(await parser.parse("```ts\nconst value = 1\n```\n")).toBe('<pre data-language="ts">const value = 1</pre>\n')
})
