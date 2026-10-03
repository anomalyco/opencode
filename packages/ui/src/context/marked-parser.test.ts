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

test("renders \\(...\\) and \\[...\\] delimiters", async () => {
  const inline = await parser.parse("\\( x^2 + y^2 \\)")
  expect(inline).toContain('<span class="katex">')
  expect(inline).not.toContain("katex-display")

  const display = await parser.parse("\\[x^2 + y^2\\]")
  expect(display).toContain('<span class="katex-display">')
})

test("renders single-dollar and single-line double-dollar math", async () => {
  expect(await parser.parse("$x^2$")).toContain('<span class="katex">')
  expect(await parser.parse("$$x^2$$")).toContain('<span class="katex-display">')
  expect(await parser.parse("text $x^2$ text")).toContain('<span class="katex">')
})

test("renders multiline display math with environments", async () => {
  const kmap = [
    "\\[",
    "\\begin{array}{c|cccc}",
    "AB\\backslash CD & 00 & 01 & 11 & 10\\\\",
    "\\hline",
    "00 & 1 & 1 & 1 & 1\\\\",
    "\\end{array}",
    "\\]",
  ].join("\n")
  const kmapHtml = await parser.parse(kmap)
  expect(kmapHtml).toContain('<span class="katex-display">')
  expect(kmapHtml).not.toContain("katex-error")

  for (const env of ["aligned", "matrix", "cases"]) {
    const body =
      env === "aligned"
        ? "a &= 1\\\\\nb &= 2"
        : env === "matrix"
          ? "1 & 2\\\\\n3 & 4"
          : "x & y"
    const html = await parser.parse(`\\[\n\\begin{${env}}\n${body}\n\\end{${env}}\n\\]`)
    expect(html).toContain('<span class="katex-display">')
  }

  expect(await parser.parse("\\(x^2 +\ny^2\\)")).toContain('<span class="katex">')
  expect(await parser.parse("$$\nx^2\ny^2\n$$")).toContain('<span class="katex-display">')
})

test("does not render math inside code or from escaped/currency dollars", async () => {
  expect(await parser.parse("`\\(x^2\\)`")).not.toContain("katex")
  expect(await parser.parse("```\n\\[x^2\\]\n```\n")).not.toContain("katex")
  expect(await parser.parse("```\n$x^2$\n```\n")).not.toContain("katex")

  expect(await parser.parse("price is $5 and $10")).not.toContain("katex")
  expect(await parser.parse("I paid $5 for coffee")).not.toContain("katex")
  expect(await parser.parse("\\$x\\$")).not.toContain("katex")
})

test("leaves incomplete math as text without throwing", async () => {
  for (const partial of ["\\(x^2", "\\[x^2", "$x^2", "$$x^2", "\\[\n\\begin{array}{c}\n1\\\\\n2"]) {
    const html = await parser.parse(partial)
    expect(html).not.toContain("katex")
    expect(typeof html).toBe("string")
  }
})

test("uses the configured code highlighter", async () => {
  expect(await parser.parse("```ts\nconst value = 1\n```\n")).toBe('<pre data-language="ts">const value = 1</pre>\n')
})
