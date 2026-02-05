import { describe, test, expect } from "bun:test"
import { Command } from "../../src/command"

describe("Command", () => {
  describe("hints()", () => {
    test("extracts numbered placeholders from template", () => {
      const result = Command.hints("Run $1 on $2")
      expect(result).toEqual(["$1", "$2"])
    })

    test("extracts $ARGUMENTS placeholder", () => {
      const result = Command.hints("Execute with $ARGUMENTS")
      expect(result).toContain("$ARGUMENTS")
    })

    test("returns both numbered and $ARGUMENTS placeholders", () => {
      const result = Command.hints("Do $1 then $ARGUMENTS")
      expect(result).toEqual(["$1", "$ARGUMENTS"])
    })

    test("deduplicates repeated numbered placeholders", () => {
      const result = Command.hints("Use $1 and $1 again with $2")
      expect(result).toEqual(["$1", "$2"])
    })

    test("returns empty array when no placeholders exist", () => {
      const result = Command.hints("No placeholders here")
      expect(result).toEqual([])
    })

    test("sorts numbered placeholders in ascending order", () => {
      const result = Command.hints("$3 then $1 then $2")
      expect(result).toEqual(["$1", "$2", "$3"])
    })

    test("handles template with only $ARGUMENTS", () => {
      const result = Command.hints("$ARGUMENTS")
      expect(result).toEqual(["$ARGUMENTS"])
    })

    test("does not match $ARGUMENTS as part of numbered placeholders", () => {
      const result = Command.hints("$1 $ARGUMENTS $2")
      expect(result).toEqual(["$1", "$2", "$ARGUMENTS"])
    })

    test("handles empty template", () => {
      const result = Command.hints("")
      expect(result).toEqual([])
    })

    test("handles high numbered placeholders", () => {
      const result = Command.hints("$10 $99 $1")
      expect(result).toEqual(["$1", "$10", "$99"])
    })
  })

  describe("Default commands", () => {
    test("INIT constant is 'init'", () => {
      expect(Command.Default.INIT).toBe("init")
    })

    test("REVIEW constant is 'review'", () => {
      expect(Command.Default.REVIEW).toBe("review")
    })
  })

  describe("Info schema", () => {
    test("validates a minimal command info object", () => {
      const result = Command.Info.safeParse({
        name: "test-command",
        template: "some template $1",
        hints: ["$1"],
      })
      expect(result.success).toBe(true)
    })

    test("requires name field", () => {
      const result = Command.Info.safeParse({
        template: "template",
        hints: [],
      })
      expect(result.success).toBe(false)
    })

    test("accepts optional description field", () => {
      const result = Command.Info.safeParse({
        name: "cmd",
        description: "A test command",
        template: "template",
        hints: [],
      })
      expect(result.success).toBe(true)
    })

    test("accepts optional source field with valid values", () => {
      for (const source of ["command", "mcp", "skill"]) {
        const result = Command.Info.safeParse({
          name: "cmd",
          source,
          template: "template",
          hints: [],
        })
        expect(result.success).toBe(true)
      }
    })

    test("rejects invalid source values", () => {
      const result = Command.Info.safeParse({
        name: "cmd",
        source: "invalid-source",
        template: "template",
        hints: [],
      })
      expect(result.success).toBe(false)
    })

    test("template field accepts a string value", () => {
      const result = Command.Info.safeParse({
        name: "cmd",
        template: "a string template",
        hints: [],
      })
      expect(result.success).toBe(true)
    })
  })
})
