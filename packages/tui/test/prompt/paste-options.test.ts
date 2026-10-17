import { describe, expect, test } from "bun:test"
import {
  applyPasteOptions,
  pasteOptionDisabled,
  PasteOptionsDefault,
  readPasteOptions,
  togglePasteOption,
  unwrapPaste,
  type PasteOptions,
} from "../../src/prompt/paste-options"

const on = (...keys: (keyof PasteOptions)[]): PasteOptions => ({
  ...PasteOptionsDefault,
  ...Object.fromEntries(keys.map((key) => [key, true])),
})

describe("applyPasteOptions", () => {
  test("no options leaves the text as it is", () => {
    expect(applyPasteOptions("  a \n\n", PasteOptionsDefault)).toBe("  a \n\n")
  })

  test("trim drops trailing whitespace on each line and blank lines at both ends, keeping indentation", () => {
    expect(applyPasteOptions("\n\n  a  \n\tb\t\n\n", on("trim"))).toBe("  a\n\tb")
  })

  test("normalize indents removes the indent every line shares", () => {
    expect(applyPasteOptions("    if (x) {\n      y()\n    }", on("dedent"))).toBe("if (x) {\n  y()\n}")
  })

  test("normalize indents ignores blank lines and never mixes tabs with spaces", () => {
    expect(applyPasteOptions("\t\ta\n\n\t\t\tb", on("dedent"))).toBe("a\n\n\tb")
    expect(applyPasteOptions("\ta\n    b", on("dedent"))).toBe("\ta\n    b")
    expect(applyPasteOptions("\t  a\n\t b", on("dedent"))).toBe(" a\nb")
  })

  test("a code block fence is longer than any backtick run inside", () => {
    expect(applyPasteOptions("a\nb", on("fence"))).toBe("```\na\nb\n```")
    expect(applyPasteOptions("x ```` y", on("fence"))).toBe("`````\nx ```` y\n`````")
  })

  test("inline code wraps one line, and is off for more", () => {
    expect(applyPasteOptions("a b", on("code"))).toBe("`a b`")
    expect(applyPasteOptions("a `b`", on("code"))).toBe("`` a `b` ``")
    expect(applyPasteOptions("a\nb", on("code"))).toBe("a\nb")
    expect(pasteOptionDisabled("code", "a\nb")).toBe(true)
    expect(pasteOptionDisabled("code", "a b")).toBe(false)
  })

  test("quote prefixes every line, outside the code block", () => {
    expect(applyPasteOptions("a\n\nb", on("quote"))).toBe("> a\n>\n> b")
    expect(applyPasteOptions("a", on("quote", "fence"))).toBe("> ```\n> a\n> ```")
  })

  test("collapse blank lines leaves at most one blank line in a row", () => {
    expect(applyPasteOptions("a\n\n\n\nb\n\nc", on("collapse"))).toBe("a\n\nb\n\nc")
  })

  test("strip ANSI escapes removes colors, cursor moves and links", () => {
    expect(applyPasteOptions("\x1b[31mred\x1b[0m \x1b]8;;http://x\x07link\x1b]8;;\x07", on("ansi"))).toBe("red link")
  })

  test("cleanups and wraps combine: an indented, trailing-space snippet becomes a clean code block", () => {
    expect(applyPasteOptions("\n    def f():  \n        pass\n\n", on("trim", "dedent", "fence"))).toBe(
      "```\ndef f():\n    pass\n```",
    )
  })
})

describe("unwrapPaste", () => {
  test("gives back the body inside intact wraps", () => {
    const options = on("quote", "fence")
    expect(unwrapPaste(applyPasteOptions("a\nb", options), options)).toEqual({ body: "a\nb", options })
    expect(unwrapPaste("`x`", on("code"))).toEqual({ body: "x", options: on("code") })
  })

  test("drops a wrap the edit broke", () => {
    expect(unwrapPaste("```\na", on("fence"))).toEqual({ body: "```\na", options: PasteOptionsDefault })
    expect(unwrapPaste("> a\nb", on("quote"))).toEqual({ body: "> a\nb", options: PasteOptionsDefault })
  })
})

describe("stored options", () => {
  test("only known keys with true values are read", () => {
    expect(readPasteOptions({ fence: true, trim: "yes", bogus: true })).toEqual(on("fence"))
    expect(readPasteOptions(undefined)).toEqual(PasteOptionsDefault)
  })

  test("the two wraps exclude each other", () => {
    expect(togglePasteOption(on("fence"), "code")).toEqual(on("code"))
    expect(togglePasteOption(on("code"), "fence")).toEqual(on("fence"))
    expect(togglePasteOption(on("fence"), "fence")).toEqual(PasteOptionsDefault)
  })
})
