import { describe, expect, test } from "bun:test"
import { marked } from "marked"
import { katexExtension, renderMathInText } from "./marked"

describe("renderMathInText (native markdown parser path)", () => {
  test("renders \\(...\\) inline math", () => {
    const html = renderMathInText("A quantum state \\( \\rho \\) is normalized.")
    expect(html).toContain("katex")
    expect(html).not.toContain("\\(")
    expect(html).not.toContain("\\)")
  })

  test("renders \\[...\\] display math", () => {
    const html = renderMathInText("\\[\n\\langle O \\rangle = \\mathrm{Tr}(O\\rho)\n\\]")
    expect(html).toContain("katex")
    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain("\\[")
    expect(html).not.toContain("\\]")
  })

  test("still renders $$...$$ display math", () => {
    const html = renderMathInText("$$\nx^2\n$$")
    expect(html).toContain("katex")
    expect(html).toContain('class="katex-display"')
  })
})

describe("katexExtension (marked tokenizer path)", () => {
  const parser = marked.use(katexExtension)

  test("renders \\(...\\) inline math", async () => {
    const html = await parser.parse("A quantum state \\( \\rho \\) is normalized.")
    expect(html).toContain("katex")
    expect(html).not.toContain("\\(")
  })

  test("renders \\[...\\] display math on its own lines", async () => {
    const html = await parser.parse("\\[\n\\langle O \\rangle = \\mathrm{Tr}(O\\rho)\n\\]")
    expect(html).toContain("katex")
    expect(html).toContain('class="katex-display"')
  })

  test("still renders $$...$$ display math", async () => {
    const html = await parser.parse("$$\nx^2\n$$")
    expect(html).toContain("katex")
    expect(html).toContain('class="katex-display"')
  })

  test("does not mangle fenced code blocks containing backslash-bracket text", async () => {
    const html = await parser.parse("```\n\\[ not math \\]\n```")
    expect(html).toContain("\\[ not math \\]")
    expect(html).not.toContain("katex")
  })

  test("renders \\(...\\) inside a markdown table cell without CommonMark eating the backslash", async () => {
    const md = [
      "| Fratto semplice | Antitrasformata |",
      "|---|---|",
      "| \\(\\frac{1}{s+a}\\) | \\(e^{-at}\\text{sca}(t)\\) |",
    ].join("\n")
    const html = await parser.parse(md)
    expect(html).toContain("katex")
    expect(html).not.toContain("\\(")
    expect(html).not.toContain("\\)")
  })
})

describe("issue #24426 repro", () => {
  test("full snippet renders both delimiter styles without leaking raw LaTeX", () => {
    const input = [
      "A quantum state \\( \\rho \\) gives an observable expectation by",
      "",
      "\\[",
      "\\langle O \\rangle = \\mathrm{Tr}(O\\rho)",
      "\\]",
    ].join("\n")

    const html = renderMathInText(input)
    expect(html).not.toContain("\\(")
    expect(html).not.toContain("\\)")
    expect(html).not.toContain("\\[")
    expect(html).not.toContain("\\]")
  })
})
