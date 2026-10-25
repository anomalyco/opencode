import { describe, expect, test } from "bun:test"
import { layoutMath } from "./layout"
import { renderLatexToString } from "./render"

const text = (value: string) => ({ type: "text" as const, value })

describe("structured math layout", () => {
  test.each([
    String.raw`\sqrt{x}`,
    String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
    String.raw`\underbrace{abcd}`,
    String.raw`\overbrace{abcd}`,
    String.raw`\sum`,
  ])("empty scripts do not change geometry: %s", (source) => {
    for (const scripts of ["^{}", "_{}", "^{}_{}"]) {
      expect(renderLatexToString(source + scripts)).toBe(renderLatexToString(source))
    }
  })

  test("centers annotations over even-width brace junctions", () => {
    expect(renderLatexToString(String.raw`\overbrace{abcd}^{n}`)).toBe([" n", "╭┴─╮", "abcd"].join("\n"))
    expect(renderLatexToString(String.raw`\underbrace{abcd}_{n}`)).toBe(["abcd", "╰┬─╯", " n"].join("\n"))
  })

  test("raises powers above tall matrix delimiters", () => {
    expect(renderLatexToString(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}^2`)).toBe(
      ["     2", "⎛a b⎞", "⎜   ⎟", "⎝c d⎠"].join("\n"),
    )
  })

  test("keeps piecewise values left-aligned", () => {
    expect(renderLatexToString(String.raw`\begin{cases}x & x>0\\x^2+1 & x\le0\end{cases}`)).toBe(
      ["⎧x       x > 0", "⎨", "⎩x² + 1  x ≤ 0"].join("\n"),
    )
  })

  test("honors array column alignment and continuous separators", () => {
    expect(
      layoutMath({
        type: "matrix",
        environment: "array",
        columns: "l|r",
        rows: [
          [text("a"), text("wide")],
          [text("long"), text("b")],
        ],
      }).toString(),
    ).toBe(["a    │ wide", "     │", "long │    b"].join("\n"))
  })

  test("preserves edge rules and double array separators", () => {
    expect(
      layoutMath({
        type: "matrix",
        environment: "array",
        columns: "|l||r|",
        rows: [
          [text("a"), text("b")],
          [text("long"), text("c")],
        ],
      }).toString(),
    ).toBe(["│ a    ││ b │", "│      ││   │", "│ long ││ c │"].join("\n"))
  })

  test.each(["left", "right"] as const)("aligns continued-fraction numerators to the %s", (numeratorAlign) => {
    const layout = layoutMath({
      type: "fraction",
      numerator: text("1"),
      denominator: text("12345"),
      bar: true,
      numeratorAlign,
    })
    expect(layout.toString()).toBe([numeratorAlign === "left" ? " 1" : "     1", "───────", " 12345"].join("\n"))
  })

  test.each(["over", "under"] as const)("stretches %s braces and places annotations outside them", (position) => {
    const layout = layoutMath({
      type: "scripts",
      base: { type: "brace", body: text("a + b + c"), position },
      ...(position === "over" ? { superscript: text("n") } : { subscript: text("n") }),
    })
    expect(layout.toString()).toBe(
      (position === "over" ? ["    n", "╭───┴───╮", "a + b + c"] : ["a + b + c", "╰───┬───╯", "    n"]).join("\n"),
    )
    expect(layout.baseline).toBe(position === "over" ? 2 : 0)
  })
})
