import { describe, expect, test } from "bun:test"
import { latexToUnicode, renderMath } from "../../src/util/math"

describe("util.math", () => {
  test("converts inline math", () => {
    expect(renderMath("The chance is \\(0.5^5 \\approx 3\\%\\). Even so.")).toBe("The chance is 0.5⁵ ≈ 3%. Even so.")
  })

  test("converts display math with text blocks", () => {
    const input = [
      "So the savings figure is:",
      "",
      "\\[",
      "\\text{saved} = (\\text{units if every call ran on Max} - \\text{units actually used}) \\times \\text{contract rate per unit}",
      "\\]",
      "",
      "Next.",
    ].join("\n")
    expect(renderMath(input)).toBe(
      [
        "So the savings figure is:",
        "",
        "saved = (units if every call ran on Max - units actually used) × contract rate per unit",
        "",
        "Next.",
      ].join("\n"),
    )
  })

  test("converts $$ blocks but leaves single dollars alone", () => {
    expect(renderMath("It raised $900M.\n\n$$\nE = mc^2\n$$")).toBe("It raised $900M.\n\nE = mc²")
  })

  test("leaves code spans and fences untouched", () => {
    const input = "Use `\\(x\\)` here.\n\n```ts\nconst re = /\\(a\\)/\n```\n\nBut \\(x_1\\) here."
    expect(renderMath(input)).toBe("Use `\\(x\\)` here.\n\n```ts\nconst re = /\\(a\\)/\n```\n\nBut x₁ here.")
  })

  test("leaves unclosed math raw while streaming", () => {
    expect(renderMath("The value \\(x^2")).toBe("The value \\(x^2")
    expect(renderMath("```\n\\(x\\)")).toBe("```\n\\(x\\)")
  })

  test("renders common constructs", () => {
    expect(latexToUnicode("\\frac{a+b}{2}")).toBe("(a+b)/2")
    expect(latexToUnicode("\\sqrt{x^2 + y^2}")).toBe("√(x² + y²)")
    expect(latexToUnicode("\\sum_{i=1}^{n} x_i")).toBe("∑ᵢ₌₁ⁿ xᵢ")
    expect(latexToUnicode("\\left( \\alpha \\le \\beta \\right)")).toBe("( α ≤ β )")
    expect(latexToUnicode("x \\in \\mathbb{R}^n")).toBe("x ∈ ℝⁿ")
    expect(latexToUnicode("p_{\\text{all}} = \\prod_i p_i")).toBe("pₐₗₗ = ∏ᵢ pᵢ")
    expect(latexToUnicode("p_{\\text{bad}}")).toBe("p_(bad)")
    expect(latexToUnicode("a^{x+y}")).toBe("aˣ⁺ʸ")
    expect(latexToUnicode("\\text{customer's well-known rate}")).toBe("customer's well-known rate")
    expect(latexToUnicode("a \\cdot b * c")).toBe("a · b ∗ c")
    expect(latexToUnicode("\\unknown{x}")).toBe("\\unknownx")
  })

  test("joins multi-line environments", () => {
    expect(latexToUnicode("\\begin{aligned} a &= b \\\\ &= c \\end{aligned}", true)).toBe("a = b\n= c")
    expect(latexToUnicode("a = b \\\\ c = d")).toBe("a = b; c = d")
  })
})
