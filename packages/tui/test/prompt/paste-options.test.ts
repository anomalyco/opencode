import { describe, expect, test } from "bun:test"
import {
  applyPasteOptions,
  pasteOptionDisabled,
  PasteOptionList,
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
    expect(pasteOptionDisabled("code", "a\nb", PasteOptionsDefault)).toBe(true)
    expect(pasteOptionDisabled("code", "a b", PasteOptionsDefault)).toBe(false)
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

  test("remove indents strips every line's leading spaces and tabs, shared or not", () => {
    expect(applyPasteOptions("    a\n\t\tb\n \t c\nd  e", on("unindent"))).toBe("a\nb\nc\nd  e")
    expect(applyPasteOptions("  a\n   \n  b", on("unindent"))).toBe("a\n\nb")
  })

  test("join into one line drops blank lines and joins the rest with one space at each break", () => {
    expect(applyPasteOptions("a\nb\nc", on("join"))).toBe("a b c")
    expect(applyPasteOptions("a  \n\n\n   b\t\n\t c", on("join"))).toBe("a b c")
    expect(applyPasteOptions("a\r\nb\rc", on("join"))).toBe("a b c")
  })

  test("join into one line keeps spaces inside a line and at the paste's two ends", () => {
    expect(applyPasteOptions("  x   y  \n  z  ", on("join"))).toBe("  x   y z  ")
    expect(applyPasteOptions("\n\n  x\n", on("join"))).toBe("  x")
    expect(applyPasteOptions("  one line  ", on("join"))).toBe("  one line  ")
    expect(applyPasteOptions("\n \n\t\n", on("join"))).toBe("")
  })

  test("the wraps go around the joined line, and inline code becomes possible", () => {
    expect(applyPasteOptions("ls -la\n  | grep x", on("join", "code"))).toBe("`ls -la | grep x`")
    expect(applyPasteOptions("a\nb", on("join", "fence"))).toBe("```\na b\n```")
    expect(applyPasteOptions("a\nb", on("join", "quote"))).toBe("> a b")
  })

  test("trim and remove indents run before the join", () => {
    expect(applyPasteOptions("    def f():  \n        pass\n", on("trim", "unindent", "join"))).toBe("def f(): pass")
  })

  test("remove indents greys out normalize indents, and join greys out collapse blank lines", () => {
    expect(pasteOptionDisabled("dedent", "a", on("unindent"))).toBe(true)
    expect(pasteOptionDisabled("dedent", "a", PasteOptionsDefault)).toBe(false)
    expect(pasteOptionDisabled("collapse", "a", on("join"))).toBe(true)
    expect(pasteOptionDisabled("collapse", "a", PasteOptionsDefault)).toBe(false)
    // What covers them leaves them nothing to change, so their stored value makes no difference.
    const text = "    a\n\n\n\n      b\n"
    expect(applyPasteOptions(text, on("unindent", "dedent"))).toBe(applyPasteOptions(text, on("unindent")))
    expect(applyPasteOptions(text, on("join", "collapse"))).toBe(applyPasteOptions(text, on("join")))
  })

  test("cleanups and wraps combine: an indented, trailing-space snippet becomes a clean code block", () => {
    expect(applyPasteOptions("\n    def f():  \n        pass\n\n", on("trim", "dedent", "fence"))).toBe(
      "```\ndef f():\n    pass\n```",
    )
  })
})

// Blank lines at both ends and in a run, CR LF breaks, trailing spaces, a shared four-space indent
// with more under it (spaces on one line, a tab on another) and terminal colors: every option changes
// it, inline code once it is one line.
const messy = "\r\n\n    alpha   \n\n\n\n        beta  \r\n    \t\x1b[31mgamma\x1b[0m\n\n"

describe("every option on a messy paste", () => {
  const keys = PasteOptionList.map((option) => option.key).filter((key) => key !== "inline")

  test.each(keys)("%s changes it", (key) => {
    const base = key === "code" ? on("join") : PasteOptionsDefault
    expect(applyPasteOptions(messy, { ...base, [key]: true })).not.toBe(applyPasteOptions(messy, base))
  })

  // The dialog's toggles, including the ones a greyed-out option ignores, in a seeded random order.
  test.each([1, 7, 42, 1234])("a random walk of toggles back to all off gives the paste back (seed %i)", (seed) => {
    let state = seed
    const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    let options = { ...PasteOptionsDefault }
    const toggle = (key: (typeof keys)[number]) => {
      if (pasteOptionDisabled(key, applyPasteOptions(messy, { ...options, fence: false, code: false, quote: false }), options)) return
      options = togglePasteOption(options, key)
    }
    for (let step = 0; step < 60; step++) toggle(keys[Math.floor(random() * keys.length)])
    // Turn off what shows ticked until nothing does, as a user would, uncovering greyed-out options.
    for (let pass = 0; pass < keys.length && keys.some((key) => options[key]); pass++)
      for (const key of [...keys].sort(() => random() - 0.5)) if (options[key]) toggle(key)
    const left = keys.filter((key) => options[key])
    // Only inline code can stay stored, greyed out for this multi-line paste and without effect.
    expect(left.filter((key) => key !== "code")).toEqual([])
    expect(applyPasteOptions(messy, options)).toBe(messy)
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
