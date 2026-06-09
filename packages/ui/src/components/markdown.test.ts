import { describe, expect, test } from "bun:test"
import { Marked } from "marked"
import { fileLink, findFileLinks } from "./markdown"
import { protectMathExpressions, renderMathExpressions } from "../context/marked"

describe("markdown fileLink", () => {
  test("parses relative file paths", () => {
    expect(fileLink(".trellis/tasks/foo/scripts/run.py")).toEqual({
      path: ".trellis/tasks/foo/scripts/run.py",
      line: undefined,
      col: undefined,
    })
  })

  test("parses file paths with line and column", () => {
    expect(fileLink("packages/app/src/app.tsx:12:4")).toEqual({
      path: "packages/app/src/app.tsx",
      line: 12,
      col: 4,
    })
  })

  test("parses file paths with line ranges", () => {
    expect(fileLink("packages/app/src/app.tsx:12-18")).toEqual({
      path: "packages/app/src/app.tsx",
      line: 12,
      col: undefined,
    })
  })

  test("parses hash line references", () => {
    expect(fileLink("/tmp/demo/file.ts#L20C3")).toEqual({
      path: "/tmp/demo/file.ts",
      line: 20,
      col: 3,
    })
  })

  test("parses @ file mentions with spaces and non-ascii path segments", () => {
    expect(fileLink("@广义相对论讲义/Schwarzchild Balck Hole/assets/rain-null-geodesics.html")).toEqual({
      path: "广义相对论讲义/Schwarzchild Balck Hole/assets/rain-null-geodesics.html",
      line: undefined,
      col: undefined,
    })
  })

  test("finds full @ file mention instead of suffix after a path space", () => {
    const text = "参考 @广义相对论讲义/Schwarzchild Balck Hole/assets/rain-null-geodesics.html 生成"
    const raw = "@广义相对论讲义/Schwarzchild Balck Hole/assets/rain-null-geodesics.html"
    const start = text.indexOf(raw)

    expect(findFileLinks(text)).toEqual([
      {
        raw,
        start,
        end: start + raw.length,
        link: {
          path: "广义相对论讲义/Schwarzchild Balck Hole/assets/rain-null-geodesics.html",
          line: undefined,
          col: undefined,
        },
      },
    ])
  })

  test("ignores urls", () => {
    expect(fileLink("https://opencode.ai/docs/file.ts")).toBeUndefined()
  })

  test("ignores fractions", () => {
    expect(fileLink("9/8")).toBeUndefined()
    expect(fileLink("9/4")).toBeUndefined()
  })

  test("ignores plain slash-separated prose", () => {
    expect(fileLink("mode/Zhu")).toBeUndefined()
  })

  test("ignores inline code commands containing file paths", () => {
    expect(fileLink("pytest tests/test_backend.py tests/test_operator_spaces.py -q")).toBeUndefined()
  })
})

describe("markdown math", () => {
  test("protects display math from markdown block parsing", () => {
    const markdown = `好的，本题已完成。核心结果是：

$$
n_k(a)
=
\\sum_{r=0}^{k}
\\frac{B_r}{r!}
E_{k+1-r}\\left[\\begin{matrix}-1\\\\ ab\\end{matrix}\\right]
+
p(a),
\\qquad
p(aq)=p(a),
$$`

    const html = protectMathExpressions(markdown)

    expect(html).toContain('data-opencode-math-style="display"')
    expect(html).toContain("n_k(a)&#10;=&#10;&#92;sum")
    expect(html).toContain("&#92;begin{matrix}-1&#92;&#92; ab&#92;end{matrix}")
    expect(html).not.toContain("$$")
  })

  test("renders protected display math with relation and matrix rows", () => {
    const protectedHtml =
      '<p>核心结果是：</p><div data-opencode-math-style="display">n_k(a)\n=\nE_k\\left[\\begin{matrix}-1\\\\ ab\\end{matrix}\\right]</div>'

    const html = renderMathExpressions(protectedHtml, "html")

    expect(html).toContain('data-opencode-math-tex="n_k(a)&#10;=&#10;E_k&#92;left')
    expect(html).toContain("katex-display")
    expect(html).toContain("mrel")
    expect(html).toContain("mtable")
  })

  test("protects inline math commands before markdown parsing", () => {
    const html = protectMathExpressions("约定 $E_0\\!\\left[\\substack{-1\\\\ z}\\right]=-1$ 下满足")

    expect(html).toContain('data-opencode-math-style="inline"')
    expect(html).toContain('data-opencode-math-tex="E_0&#92;!&#92;left')
    expect(html).toContain("&#92;substack{-1&#92;&#92; z}")
    expect(html).not.toContain("$E_0")
  })

  test("keeps inline math escapes through markdown parsing", async () => {
    const marked = new Marked()
    const protectedMarkdown = protectMathExpressions("约定 $E_0\\!\\left[\\substack{-1\\\\ z}\\right]=-1$ 下满足")
    const parsed = await marked.parse(protectedMarkdown)
    const html = renderMathExpressions(parsed, "html")

    expect(parsed).toContain("data-opencode-math-tex")
    expect(parsed).toContain("E_0&#92;!&#92;left")
    expect(html).toContain("katex")
    expect(html).toContain("mspace")
    expect(html).toContain("vlist")
    expect(html).not.toContain("E_0!")
    expect(html).not.toContain("\\substack")
  })

  test("renders protected inline spacing and substack commands", () => {
    const protectedHtml =
      '<p>约定 <span data-math-style="inline">E_0\\!\\left[\\substack{-1\\\\ z}\\right]=-1</span> 下满足</p>'

    const html = renderMathExpressions(protectedHtml, "html")

    expect(html).toContain("katex")
    expect(html).not.toContain("data-opencode-math-tex")
    expect(html).toContain("mspace")
    expect(html).toContain("vlist")
    expect(html).not.toContain("E_0!")
    expect(html).not.toContain("\\substack")
  })

  test("does not protect inline math inside code", () => {
    const html = protectMathExpressions("`$E_0[\\substack{-1\\\\ z}]=-1$`")

    expect(html).toBe("`$E_0[\\substack{-1\\\\ z}]=-1$`")
  })
})
