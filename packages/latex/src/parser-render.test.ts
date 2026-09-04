import { describe, expect, test } from "bun:test"
import { renderLatexToString } from "./render"

describe("parser rendering regressions", () => {
  test.each([
    [String.raw`\|v\|`, "║v║"],
    [String.raw`\left\|v\right\|`, "║v║"],
    [String.raw`\left|v\right|`, "│v│"],
    [String.raw`\left(A\rightarrow B\right)`, "(A → B)"],
    [String.raw`\left\lbrace x\right\rbrace`, "{x}"],
    [String.raw`\operatorname{arg\,max} x`, "arg max x"],
    [String.raw`\textrm{if }x`, "if x"],
    [String.raw`\displaylines{x=1\\y=2}`, "x = 1\n\ny = 2"],
  ])("renders supported syntax without leaking or losing tokens: %s", (source, expected) => {
    expect(renderLatexToString(source, { strict: true })).toBe(expected)
  })

  test("renders empty aligned cells like explicitly empty groups", () => {
    expect(renderLatexToString(String.raw`\begin{aligned}&=x\\&=y\end{aligned}`, { strict: true })).toBe(
      renderLatexToString(String.raw`\begin{aligned}{}&=x\\{}&=y\end{aligned}`, { strict: true }),
    )
  })
})
