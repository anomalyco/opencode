import { describe, expect, test } from "bun:test"
import { latexToUnicode } from "../../../../src/cli/cmd/run/latex-unicode"

describe("latexToUnicode", () => {
  test("leaves plain text alone", () => {
    expect(latexToUnicode("hello world")).toBe("hello world")
  })

  test("leaves currency bare-dollars alone", () => {
    expect(latexToUnicode("costs $0.02/GB or $203/month")).toBe("costs $0.02/GB or $203/month")
    expect(latexToUnicode("price is $100 today")).toBe("price is $100 today")
  })

  test("converts display math with frac and greek", () => {
    const out = latexToUnicode(String.raw`\[ D_{KL}(P \| Q) = \sum_x P(x) \log \frac{P(x)}{Q(x)} \]`)
    expect(out).toContain("∑")
    expect(out).toContain("(P(x))/(Q(x))")
    expect(out).not.toContain("\\frac")
    expect(out).not.toContain("\\sum")
  })

  test("converts inline \\( \\) delimiters", () => {
    const out = latexToUnicode(String.raw`Advantage \( A_t = \log \pi_T - \log \pi_\theta \) here`)
    expect(out).toContain("Aₜ")
    expect(out).toContain("π₍T₎")
    expect(out).toContain("π₍θ₎")
    expect(out).not.toContain("\\(")
    expect(out).not.toContain("\\pi")
  })

  test("converts $$ blocks", () => {
    const out = latexToUnicode(String.raw`$$ \mathbb{E}_{x \sim p}[f(x)] $$`)
    expect(out).toContain("𝔼")
    expect(out).toContain("∼")
    expect(out).not.toContain("$$")
  })

  test("converts math-like bare dollars", () => {
    const out = latexToUnicode(String.raw`score $x_i^2$ done`)
    expect(out).toContain("xᵢ")
    expect(out).toContain("²")
    expect(out).not.toContain("$")
  })

  test("mathrm subscript", () => {
    const out = latexToUnicode(String.raw`$D_{\mathrm{KL}}(p\|q)$`)
    expect(out).toMatch(/D.*KL/)
    expect(out).not.toContain("\\mathrm")
    expect(out.includes("_")).toBe(false)
  })

  test("softmax fraction", () => {
    const out = latexToUnicode(
      String.raw`$$\operatorname{softmax}(z)_i = \frac{e^{z_i}}{\sum_j e^{z_j}}$$`,
    )
    expect(out).toContain("softmax")
    expect(out).toContain("∑")
    expect(out).not.toContain("\\frac")
  })

  test("reverse KL study example", () => {
    const src = String.raw`
On-policy distillation uses
\[
A_t = \log \pi_T(a_t \mid s_t) - \log \pi_\theta(a_t \mid s_t)
\]
which is reverse $D_{KL}(\pi_\theta \| \pi_T)$.
`
    const out = latexToUnicode(src)
    expect(out).toContain("Aₜ")
    expect(out).toContain("π₍T₎")
    expect(out).toContain("π₍θ₎")
    expect(out).not.toContain("\\log")
    expect(out).not.toContain("\\pi")
  })

  test("no raw underscore survives (markdown-safe)", () => {
    const out = latexToUnicode(String.raw`$a_b + \pi_T + x_{1:L}$`)
    expect(out.includes("_")).toBe(false)
  })

  test("sequence likelihood", () => {
    const out = latexToUnicode(
      String.raw`$$\pi(a_{1:L}\mid s) = \prod_{t=1}^{L} \pi(a_t\mid s, a_{<t})$$`,
    )
    expect(out).toContain("π")
    expect(out).toContain("∏")
    expect(out).toContain("∣")
  })
})
