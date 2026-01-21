import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"
import { Command } from "../../src/command"

describe("session.prompt", () => {
  describe("processEscapes", () => {
    test("escapes \\$1 to literal $1", () => {
      const { processed, restore } = SessionPrompt.processEscapes("\\$1")
      expect(restore(processed)).toBe("$1")
    })

    test("escapes \\$ARGUMENTS to literal $ARGUMENTS", () => {
      const { processed, restore } = SessionPrompt.processEscapes("\\$ARGUMENTS")
      expect(restore(processed)).toBe("$ARGUMENTS")
    })

    test("leaves unescaped $1 intact for substitution", () => {
      const { processed, restore } = SessionPrompt.processEscapes("$1")
      expect(processed).toBe("$1")
      expect(restore(processed)).toBe("$1")
    })

    test("leaves unescaped $ARGUMENTS intact for substitution", () => {
      const { processed, restore } = SessionPrompt.processEscapes("$ARGUMENTS")
      expect(processed).toBe("$ARGUMENTS")
      expect(restore(processed)).toBe("$ARGUMENTS")
    })

    test("mixed escaped and unescaped placeholders", () => {
      const { processed, restore } = SessionPrompt.processEscapes("Use \\$1 for first arg: $1")
      expect(processed.includes("$1")).toBe(true)
      const substituted = processed.replace("$1", "foo")
      expect(restore(substituted)).toBe("Use $1 for first arg: foo")
    })

    test("preserves other escape sequences like \\n", () => {
      const { processed, restore } = SessionPrompt.processEscapes("\\n stays \\n")
      expect(restore(processed)).toBe("\\n stays \\n")
    })
  })
})

describe("command.hints", () => {
  test("detects unescaped $1 placeholder", () => {
    expect(Command.hints("Use $1 here")).toEqual(["$1"])
  })

  test("detects unescaped $ARGUMENTS placeholder", () => {
    expect(Command.hints("Use $ARGUMENTS here")).toEqual(["$ARGUMENTS"])
  })

  test("detects multiple placeholders", () => {
    expect(Command.hints("Use $1 and $2")).toEqual(["$1", "$2"])
  })

  test("ignores escaped \\$1 placeholder", () => {
    expect(Command.hints("Use \\$1 here")).toEqual([])
  })

  test("ignores escaped \\$ARGUMENTS placeholder", () => {
    expect(Command.hints("Use \\$ARGUMENTS here")).toEqual([])
  })

  test("mixed escaped and unescaped placeholders", () => {
    expect(Command.hints("Use \\$1 for docs but $2 for substitution")).toEqual(["$2"])
  })
})
