import { describe, expect, test } from "bun:test"
import { parseLatex } from "../../src/feature-plugins/system/latex/parser"
import { LatexParseError } from "../../src/feature-plugins/system/latex/types"

describe("parseLatex", () => {
  test("parses fractions and scripts structurally", () => {
    expect(parseLatex(String.raw`\frac{x^2+1}{y_0}`)).toMatchObject({
      type: "fraction",
      bar: true,
      numerator: { type: "row" },
      denominator: { type: "scripts" },
    })
  })

  test("parses matrix environments into rows and cells", () => {
    expect(parseLatex(String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`)).toMatchObject({
      type: "matrix",
      environment: "pmatrix",
      rows: [
        [
          { type: "symbol", value: "a" },
          { type: "symbol", value: "b" },
        ],
        [
          { type: "symbol", value: "c" },
          { type: "symbol", value: "d" },
        ],
      ],
    })
  })

  test("accepts array column specs and starred alignment environments", () => {
    expect(parseLatex(String.raw`\begin{array}{cc}a & b \\ c & d\end{array}`)).toMatchObject({
      type: "matrix",
      environment: "array",
      rows: [
        [{}, {}],
        [{}, {}],
      ],
    })
    expect(parseLatex(String.raw`\begin{align*}a &= b \\ c &= d\end{align*}`)).toMatchObject({
      type: "matrix",
      environment: "align",
    })
  })

  test("expands user macros", () => {
    expect(parseLatex(String.raw`\R \to \R`, { macros: { "\\R": String.raw`\mathbb{R}` } })).toMatchObject({
      type: "row",
    })
  })

  test("reports useful strict-mode errors", () => {
    expect(() => parseLatex(String.raw`\definitelyUnknown{x}`, { strict: true })).toThrow(LatexParseError)
  })

  test("keeps escaped braces inside raw text groups", () => {
    expect(parseLatex(String.raw`\text{left \{ only}`)).toMatchObject({
      type: "text",
      value: "left { only",
    })
    expect(parseLatex(String.raw`\text{right \} only}`)).toMatchObject({
      type: "text",
      value: "right } only",
    })
  })

  test("supports starred named operators and limits modifiers", () => {
    expect(parseLatex(String.raw`\operatorname*{arg\,max}_{x}`)).toMatchObject({
      type: "scripts",
      base: { type: "operator", value: String.raw`arg\,max`, limits: true },
    })
    expect(parseLatex(String.raw`\int\limits_0^1`)).toMatchObject({
      type: "scripts",
      base: { type: "operator", value: "∫", limits: true },
    })
    expect(parseLatex(String.raw`\sum\nolimits_{i=1}`)).toMatchObject({
      type: "scripts",
      base: { type: "operator", value: "∑", limits: false },
    })
  })

  test("bounds source and recursive macro expansion", () => {
    expect(() => parseLatex("12345", { maxSourceLength: 4 })).toThrow(/4-character limit/)
    expect(() =>
      parseLatex(String.raw`\a`, {
        macros: { a: String.raw`\a\a` },
        maxExpandedLength: 64,
      }),
    ).toThrow(/64-character limit/)
    expect(() => parseLatex("x", { maxSourceLength: 0 })).toThrow(RangeError)
  })

  test("fails quickly when malformed environments cannot advance", () => {
    expect(() => parseLatex(String.raw`\begin{matrix}]`)).toThrow(/Missing \\end{matrix}/)
    expect(() => parseLatex(String.raw`\begin{matrix}x}`)).toThrow(/Unexpected "}" in matrix/)
  })

  test("bounds structural nesting with a parse error instead of overflowing the stack", () => {
    const source = "{".repeat(80) + "x" + "}".repeat(80)
    expect(() => parseLatex(source, { maxDepth: 64 })).toThrow(/64-level limit/)
    expect(() => parseLatex(String.raw`\frac`.repeat(80) + "x", { maxDepth: 64 })).toThrow(/64-level limit/)
  })
})
