import { describe, expect, test } from "bun:test"
import { renderLatex, renderLatexToString } from "./render"

describe("renderLatexToString", () => {
  test("renders a fraction with a centered rule", () => {
    expect(renderLatexToString(String.raw`\frac{x+1}{y-1}`)).toBe([" x + 1", "───────", " y - 1"].join("\n"))
  })

  test.each([
    [String.raw`E = mc^2`, "E = mc²"],
    [String.raw`a_n`, "aₙ"],
    [String.raw`x_i^2`, "x²ᵢ"],
    [String.raw`x^{}`, "x"],
    [String.raw`x_{}`, "x"],
    [String.raw`x^{}_{}`, "x"],
    [String.raw`x^m_1`, " m\nx\n 1"],
    [String.raw`x^2_q`, " 2\nx\n q"],
    [String.raw`x^{\frac{1}{2}}_1`, "  1\n ───\n  2\nx\n 1"],
  ])("compacts scripts only when every script is supported: %s", (source, expected) => {
    expect(renderLatexToString(source)).toBe(expected)
  })

  test("respects script and display mode options", () => {
    expect(renderLatexToString(String.raw`x_i^2`, { compactScripts: false })).toBe(" 2\nx\n i")
    expect(renderLatexToString(String.raw`\sum_1^n`, { displayMode: false })).toBe("∑ⁿ₁")
    expect(renderLatexToString(String.raw`\sum_1^n`, { compactScripts: false })).toBe("n\n∑\n1")
  })

  test("centers binomials around an empty math-axis row", () => {
    expect(renderLatexToString(String.raw`P = \binom{n}{k}`)).toBe(["    ⎛ n ⎞", "P = ⎜   ⎟", "    ⎝ k ⎠"].join("\n"))
  })

  test("renders roots with a vinculum", () => {
    expect(renderLatexToString(String.raw`\sqrt{x^2+y^2}`)).toBe([" ╭───────", "╰╯x² + y²"].join("\n"))
  })

  test.each([
    [String.raw`\boxed{?}`, ["┌───┐", "│ ? │", "└───┘"]],
    [String.raw`\boxed{\frac{1}{2}}`, ["┌─────┐", "│  1  │", "│ ─── │", "│  2  │", "└─────┘"]],
    [String.raw`\boxed{\boxed{x}}`, ["┌───────┐", "│ ┌───┐ │", "│ │ x │ │", "│ └───┘ │", "└───────┘"]],
    [String.raw`\sqrt[3]{\boxed{?}}`, ["3╭─────", " │┌───┐", " ││ ? │", "╰╯└───┘"]],
  ])("renders boxed math without overwriting its body: %s", (source, expected) => {
    expect(renderLatexToString(source, { strict: true })).toBe(expected.join("\n"))
  })

  test("preserves a box's baseline and style", () => {
    const layout = renderLatex(String.raw`\boxed{\frac{1}{2}}=x`, { color: "red" })
    expect(layout.baseline).toBe(2)
    expect(layout.toString().split("\n")[layout.baseline]).toBe("│ ─── │ = x")
    expect(
      layout.cells
        .flat()
        .filter(Boolean)
        .every((cell) => cell?.style?.color === "red"),
    ).toBe(true)
  })

  test("does not apply mathematical alphabets to locally preserved TeX", () => {
    expect(renderLatexToString(String.raw`\mathbb{\unknown{R}}`)).toBe(String.raw`\unknown{R}`)
  })

  test("keeps multiline unknown content readable without dropping grouping", () => {
    expect(renderLatexToString("\\unknown{a\n+ b}")).toBe("\\unknown{a\n+ b}")
    expect(renderLatexToString("\\unknown{a % comment\n  b}")).toBe("\\unknown{a % comment\n  b}")
  })

  test("renders known math alongside an opaque command", () => {
    expect(renderLatexToString(String.raw`\frac{1}{2}=\unknown{x}`)).toBe(" 1\n─── = \\unknown{x}\n 2")
  })

  test("bounds rectangular layouts from uneven literal lines", () => {
    expect(() => renderLatexToString("\\unknown{" + "x".repeat(2000) + "\nx".repeat(500) + "}")).toThrow(/cell limit/)
  })

  test("renders matrices with stretching delimiters", () => {
    expect(renderLatexToString(String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`)).toBe(
      ["⎛a b⎞", "⎜   ⎟", "⎝c d⎠"].join("\n"),
    )
  })

  test("places display operator limits above and below", () => {
    expect(renderLatexToString(String.raw`\sum_{i=1}^{n} i^2`)).toBe(["  n", "  ∑   i²", "i = 1"].join("\n"))
  })

  test("returns intrinsic geometry and baseline", () => {
    const layout = renderLatex(String.raw`\frac{1}{2}`)
    expect(layout.width).toBe(3)
    expect(layout.height).toBe(3)
    expect(layout.baseline).toBe(1)
  })

  test("renders blackboard, calligraphic, and fraktur alphabets", () => {
    expect(renderLatexToString(String.raw`\mathbb{R} \to \mathcal{C} \times \mathfrak{g}`)).toBe("ℝ → 𝒞 × 𝔤")
  })

  test("preserves inherited styles through nested variants and colors", () => {
    const layout = renderLatex(String.raw`\mathbf{\mathsf{\textcolor{red}{\mathit{x}}}}`)
    expect(layout.cells[0][0]).toEqual({ char: "x", style: { bold: true, italic: true, color: "red" } })
  })

  test("renders nested fractions without flattening their structure", () => {
    const result = renderLatexToString(String.raw`\frac{1}{1+\frac{1}{x}}`)
    expect(result.split("\n")).toHaveLength(5)
    expect(result.match(/─/g)?.length).toBeGreaterThanOrEqual(10)
  })

  test("renders common textbook structures", () => {
    const result = renderLatexToString(String.raw`\left[\frac{-b \pm \sqrt{b^2-4ac}}{2a}\right]`)
    expect(result).toContain("±")
    expect(result).toContain("╰╯")
    expect(result).toContain("─")
    expect(result).toContain("⎡")
    expect(result).toContain("⎦")
  })

  test("places fallback combining negation after the base symbol", () => {
    const result = renderLatexToString(String.raw`\not\rightarrow`)
    expect(Array.from(result)).toEqual(["→", "̸"])
  })

  test("treats square brackets as ordinary interval delimiters", () => {
    expect(renderLatexToString(String.raw`x\in[0,1]`)).toBe("x ∈ [0,1]")
    expect(renderLatexToString(String.raw`[-1,1]`)).toBe("[-1,1]")
  })
})
