import { expect, test } from "bun:test"
import { createMarkdownParser } from "./marked-parser"
import { parseSmallMarkdown } from "./marked-base"

const parser = createMarkdownParser()

test.each([
  ["OpenCode", "OpenCode"],
  ["**`#123`**", "<strong><code>#123</code></strong>"],
  ["*Review* ~~draft~~", "<em>Review</em> <del>draft</del>"],
  ["`<example>`", "<code>&lt;example&gt;</code>"],
  ["\\*literal\\*", "*literal*"],
])("renders link label %s with application attributes", async (label, html) => {
  const markdown = `[${label}](https://opencode.ai)`
  const expected = `<p><a href="https://opencode.ai" class="external-link" target="_blank" rel="noopener noreferrer">${html}</a></p>\n`

  expect(await parser.parse(markdown)).toBe(expected)
  expect(parseSmallMarkdown(markdown)).toBe(expected)
})

test("keeps fragment links in the page", async () => {
  const markdown = "See [Host services](#host-services)"
  const expected = '<p>See <a href="#host-services">Host services</a></p>\n'

  expect(await parser.parse(markdown)).toBe(expected)
  expect(parseSmallMarkdown(markdown)).toBe(expected)
})

test("renders inline and block math", async () => {
  expect(await parser.parse("\\(x^2\\)")).toContain('<span class="katex">')
  expect(await parser.parse("$$\nx^2\n$$\n")).toContain('<span class="katex-display">')
})

test.each([
  "Energy is $E = mc^2$.",
  "因此 $x^2$ 是正数",
  "因此$x^2$是正数",
  "$a_1$ and $b_1$.",
  "where (i.e. $x$) holds",
  "the $x$-axis",
  "is $x$; y",
  "$x$'s value",
  "ack ($440\\text{ ms}$ IPC p50)",
])("renders dollar inline math: %s", async (text) => {
  const html = await parser.parse(text)
  expect(html).toContain('<span class="katex">')
  expect(html).not.toContain("$")
})

test("renders every dollar span in a line", async () => {
  const html = await parser.parse("ack ($440\\text{ ms}$ IPC p50, $413\\text{ MB} \\rightarrow 98\\text{ MB}$)")
  expect(html.match(/<span class="katex">/g)).toHaveLength(2)
  expect(html).not.toContain("$")
})

test("keeps an escaped dollar inside dollar math", async () => {
  const html = await parser.parse("Escaped $a\\$b$ dollar")
  expect(html.match(/<span class="katex">/g)).toHaveLength(1)
  expect(html).toContain('<annotation encoding="application/x-tex">a\\$b</annotation>')
})

test.each(["$$E = mc^2$$", "Inline $$x$$ display", "($$x$$)", "$$\na\n\nb\n$$\n"])(
  "renders dollar display math: %s",
  async (text) => {
    const html = await parser.parse(text)
    expect(html).toContain('<span class="katex-display">')
    expect(html).not.toContain("$$")
  },
)

test.each([
  "It costs $5 and $10.",
  "From $5-$10 a month",
  "It costs $5, originally $10, ranging from $1,000 to $2,000.",
  "It costs $5 (or $6) now",
  "between $5 and $6 dollars",
  "paid $5/$6.",
  "Use $HOME and $PATH",
  "Use $HOME/$USER or $PATH:$HOME",
  "Use `$x$` as a placeholder",
  "An escaped \\$x$ dollar",
  "$ x $ has space inside its delimiters",
])("leaves prices, shell variables, and code as text: %s", async (text) => {
  expect(await parser.parse(text)).not.toContain("katex")
})

// Each repeated unit took seconds at this size when `start` retried the dollar regex from every `$` for every text token.
test("lexes dollar-heavy paragraphs in near-linear time", () => {
  const units = ["`a` $5 ", "$a ", "\\$$a", "$a\\\\\\ ", "It costs $5, ", "with `c` $x_1$ and "]
  const startedAt = performance.now()
  units.forEach((unit) => parser.lexer(unit.repeat(Math.ceil(10_000 / unit.length))))
  expect(performance.now() - startedAt).toBeLessThan(500)
})

test("highlights fenced code with the app theme variables", async () => {
  const html = await parser.parse("```ts\nconst value = 1\n```\n")

  expect(html).toStartWith('<pre class="highlights" style="background-color:var(--color-background-stronger)')
  expect(html).toContain('<code class="language-ts">')
  expect(html).toContain('<span style="color:var(--syntax-keyword)">const </span>')
})

test("keeps the fence language for code without a lexer", async () => {
  const html = await parser.parse("```mermaid\ngraph TD; A-->B\n```\n")

  expect(html).toContain('<code class="language-mermaid">graph TD; A--&gt;B</code>')
})

test.each(["```", "~~~"])("recognizes an empty %s fence at EOF", async (fence) => {
  expect(await parser.parse(`foo\n${fence}`)).toContain('<p>foo</p>\n<pre class="highlights"')
  expect(await parser.parse(`foo\n${fence}`)).toContain('<code class="language-text"></code>')
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
  "Energy is $E = mc^2$.",
  "a".repeat(1025),
])("leaves code, math, and large Markdown to the worker: %s", (text) => {
  expect(parseSmallMarkdown(text)).toBeUndefined()
})
