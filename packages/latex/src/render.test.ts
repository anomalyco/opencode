import { describe, expect, test } from "bun:test"
import { renderLatex, renderLatexToString } from "./render"

describe("renderLatexToString", () => {
  test("renders a fraction with a centered rule", () => {
    expect(renderLatexToString(String.raw`\frac{x+1}{y-1}`)).toBe([" x + 1", "───────", " y - 1"].join("\n"))
  })

  test("uses compact unicode scripts where possible", () => {
    expect(renderLatexToString(String.raw`E = mc^2`)).toBe("E = mc²")
    expect(renderLatexToString(String.raw`a_n`)).toBe("aₙ")
    expect(renderLatexToString(String.raw`x_i^2`)).toBe("x²ᵢ")
  })

  test("centers binomials around an empty math-axis row", () => {
    expect(renderLatexToString(String.raw`P = \binom{n}{k}`)).toBe(["    ⎛ n ⎞", "P = ⎜   ⎟", "    ⎝ k ⎠"].join("\n"))
  })

  test("renders roots with a vinculum", () => {
    expect(renderLatexToString(String.raw`\sqrt{x^2+y^2}`)).toBe([" ╭───────", "√ x² + y²"].join("\n"))
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

  test("renders nested fractions without flattening their structure", () => {
    const result = renderLatexToString(String.raw`\frac{1}{1+\frac{1}{x}}`)
    expect(result.split("\n")).toHaveLength(5)
    expect(result.match(/─/g)?.length).toBeGreaterThanOrEqual(10)
  })

  test("renders common textbook structures", () => {
    const result = renderLatexToString(String.raw`\left[\frac{-b \pm \sqrt{b^2-4ac}}{2a}\right]`)
    expect(result).toContain("±")
    expect(result).toContain("√")
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
