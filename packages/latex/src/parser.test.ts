import { describe, expect, test } from "bun:test"
import { parseLatex } from "./parser"
import { LatexParseError } from "./types"

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
      columns: "cc",
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

  test("preserves double norm delimiters without changing single bars", () => {
    expect(parseLatex(String.raw`\|v\|`, { strict: true })).toMatchObject({
      type: "row",
      body: [{ value: "║" }, { value: "v" }, { value: "║" }],
    })
    expect(parseLatex(String.raw`\left\|v\right\|`, { strict: true })).toMatchObject({
      type: "delimited",
      left: "║",
      right: "║",
    })
    expect(parseLatex(String.raw`\left|v\right|`, { strict: true })).toMatchObject({
      type: "delimited",
      left: "│",
      right: "│",
    })
  })

  test("matches the whole right command and keeps nested delimiters", () => {
    expect(parseLatex(String.raw`\left(A\rightarrow B\right)`, { strict: true })).toMatchObject({
      type: "delimited",
      left: "(",
      body: { type: "row", body: [{ value: "A" }, { value: "→" }, { value: "B" }] },
      right: ")",
    })
    expect(parseLatex(String.raw`\left(\left[A\right]\rightharpoonup B\right)`)).toMatchObject({
      type: "delimited",
      body: { type: "row", body: [{ type: "delimited" }, { value: "⇀" }, { value: "B" }] },
    })
    expect(() => parseLatex(String.raw`\left(A\rightarrow B`, { strict: true })).toThrow(/Missing \\right/)
    expect(() => parseLatex(String.raw`\left(A\rightward B\right)`, { strict: true })).toThrow(
      /Unsupported command \\rightward/,
    )
  })

  test("accepts empty leading, interior, and trailing environment cells", () => {
    expect(parseLatex(String.raw`\begin{aligned}&=x\\&=y\end{aligned}`, { strict: true })).toMatchObject({
      type: "matrix",
      environment: "aligned",
      rows: [
        [
          { type: "row", body: [] },
          { type: "row", body: [{ value: "=" }, { value: "x" }] },
        ],
        [
          { type: "row", body: [] },
          { type: "row", body: [{ value: "=" }, { value: "y" }] },
        ],
      ],
    })
    expect(parseLatex(String.raw`\begin{matrix}a&&\\&b&\end{matrix}`, { strict: true })).toMatchObject({
      type: "matrix",
      rows: [
        [{ value: "a" }, { type: "row", body: [] }, { type: "row", body: [] }],
        [{ type: "row", body: [] }, { value: "b" }, { type: "row", body: [] }],
      ],
    })
    expect(parseLatex(String.raw`\begin{matrix}a\\\end{matrix}`)).toMatchObject({ rows: [[{ value: "a" }]] })
    expect(parseLatex(String.raw`\begin{matrix}\\\end{matrix}`)).toMatchObject({ rows: [[{ type: "row", body: [] }]] })
  })

  test("parses displaylines as separate gathered rows", () => {
    expect(parseLatex(String.raw`\displaylines{x=1\\y=2}`, { strict: true })).toMatchObject({
      type: "matrix",
      environment: "gathered",
      rows: [
        [{ type: "row", body: [{ value: "x" }, { value: "=" }, { value: "1" }] }],
        [{ type: "row", body: [{ value: "y" }, { value: "=" }, { value: "2" }] }],
      ],
    })
    expect(parseLatex(String.raw`\displaylines{\frac{1}{2}\\{y}}+z`)).toMatchObject({
      type: "row",
      body: [{ type: "matrix", rows: [[{ type: "fraction" }], [{ value: "y" }]] }, { value: "+" }, { value: "z" }],
    })
    expect(() => parseLatex(String.raw`\displaylines[l]{x\\y}`, { strict: true })).toThrow(LatexParseError)
    expect(() => parseLatex(String.raw`\displaylines{x\\y`, { strict: true })).toThrow(LatexParseError)
  })

  test.each([
    ["", undefined],
    ["[]", undefined],
    ["[l]", "left"],
    ["[r]", "right"],
  ] as const)("parses continued fraction alignment %s before its arguments", (option, numeratorAlign) => {
    expect(parseLatex(String.raw`\cfrac${option}{1}{23}`, { strict: true })).toEqual({
      type: "fraction",
      numerator: { type: "symbol", value: "1", role: "ordinary" },
      denominator: {
        type: "row",
        body: [
          { type: "symbol", value: "2", role: "ordinary" },
          { type: "symbol", value: "3", role: "ordinary" },
        ],
      },
      bar: true,
      ...(numeratorAlign ? { numeratorAlign } : {}),
    })
  })

  test.each(["[c]", "[lr]", "[left]", "[l"])("rejects unsupported continued fraction alignment %s", (option) => {
    expect(() => parseLatex(String.raw`\cfrac${option}{1}{2}`, { strict: true })).toThrow(LatexParseError)
  })

  test("retains normalized array columns including edge and double rules", () => {
    expect(parseLatex(String.raw`\begin{array}{ | l || c r | }a&b&c\end{array}`, { strict: true })).toMatchObject({
      type: "matrix",
      environment: "array",
      columns: "|l||cr|",
    })
  })

  test.each(["", "||", "p{2cm}", "*{2}{c}", "c@{}c", "lXr"])("rejects unsupported array columns %s", (columns) => {
    expect(() => parseLatex(String.raw`\begin{array}{${columns}}a\end{array}`, { strict: true })).toThrow(
      LatexParseError,
    )
  })

  test("requires an array column specification", () => {
    expect(() => parseLatex(String.raw`\begin{array}a&b\end{array}`, { strict: true })).toThrow(LatexParseError)
  })

  test("emits structural braces while keeping annotations as scripts", () => {
    expect(parseLatex(String.raw`\overbrace{a+b}^{n}`, { strict: true })).toMatchObject({
      type: "scripts",
      base: { type: "brace", position: "over", body: { type: "row" } },
      superscript: { value: "n" },
    })
    expect(parseLatex(String.raw`\underbrace{x}_{k}`, { strict: true })).toMatchObject({
      type: "scripts",
      base: { type: "brace", position: "under", body: { value: "x" } },
      subscript: { value: "k" },
    })
  })

  test("recognizes named braces and rejects unsupported delimiter commands in strict mode", () => {
    expect(parseLatex(String.raw`\left\lbrace x\right\rbrace`, { strict: true })).toMatchObject({
      type: "delimited",
      left: "{",
      right: "}",
    })
    expect(parseLatex(String.raw`\lbrace x\rbrace`, { strict: true })).toMatchObject({
      type: "row",
      body: [{ value: "{" }, { value: "x" }, { value: "}" }],
    })
    for (const source of [
      String.raw`\left\unknown x\right)`,
      String.raw`\left(x\right\unknown`,
      String.raw`\big\unknown`,
      String.raw`\left(x\middle\unknown y\right)`,
    ]) {
      expect(() => parseLatex(source, { strict: true })).toThrow(/Unsupported delimiter \\unknown/)
    }
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
      base: { type: "operator", value: "arg max", limits: true },
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

  test("interprets operator spacing and preserves roman text whitespace", () => {
    expect(parseLatex(String.raw`\operatorname{arg\,max}`, { strict: true })).toEqual({
      type: "operator",
      value: "arg max",
      limits: false,
    })
    expect(parseLatex(String.raw`\textrm{ if }`, { strict: true })).toEqual({
      type: "variant",
      variant: "normal",
      body: { type: "text", value: " if " },
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
    expect(() => parseLatex(String.raw`\a`, { macros: { a: "{{x}}" }, maxDepth: 1 })).toThrow(/1-level limit/)
    expect(() => parseLatex("x", { maxSourceLength: 0 })).toThrow(RangeError)
  })

  test("fails quickly when malformed environments cannot advance", () => {
    expect(() => parseLatex(String.raw`\begin{matrix}]`)).toThrow(/Missing \\end{matrix}/)
    expect(() => parseLatex(String.raw`\begin{matrix}x}`)).toThrow(/Unexpected "}" in matrix/)
    expect(() => parseLatex(String.raw`\begin{matrix}&}`)).toThrow(/Unexpected "}" in matrix/)
  })

  test("bounds structural nesting with a parse error instead of overflowing the stack", () => {
    const source = "{".repeat(80) + "x" + "}".repeat(80)
    expect(() => parseLatex(source, { maxDepth: 64 })).toThrow(/64-level limit/)
    expect(() => parseLatex(String.raw`\frac`.repeat(80) + "x", { maxDepth: 64 })).toThrow(/64-level limit/)
  })
})
