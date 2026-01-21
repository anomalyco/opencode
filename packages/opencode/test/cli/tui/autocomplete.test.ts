import { describe, expect, test } from "bun:test"
import { shouldClearSlashCommand } from "../../../src/cli/cmd/tui/component/prompt/autocomplete-util"

describe("shouldClearSlashCommand", () => {
  describe("slash command mode", () => {
    test("clears partial command without arguments", () => {
      expect(shouldClearSlashCommand("/", "/gc")).toBe(true)
      expect(shouldClearSlashCommand("/", "/help")).toBe(true)
      expect(shouldClearSlashCommand("/", "/gcd:plan-phase")).toBe(true)
    })

    test("does not clear command with single argument", () => {
      expect(shouldClearSlashCommand("/", "/help topic")).toBe(false)
      expect(shouldClearSlashCommand("/", "/gcd:plan-phase 2")).toBe(false)
      expect(shouldClearSlashCommand("/", "/run test")).toBe(false)
    })

    test("does not clear command with multiple arguments", () => {
      expect(shouldClearSlashCommand("/", "/cmd arg1 arg2")).toBe(false)
      expect(shouldClearSlashCommand("/", "/cmd arg1 arg2 arg3")).toBe(false)
      expect(shouldClearSlashCommand("/", "/gcd:plan-phase 2 extra")).toBe(false)
    })

    test("does not clear command with trailing space (selected from autocomplete)", () => {
      expect(shouldClearSlashCommand("/", "/help ")).toBe(false)
      expect(shouldClearSlashCommand("/", "/gcd:plan-phase ")).toBe(false)
    })

    test("does not clear text that doesn't start with /", () => {
      expect(shouldClearSlashCommand("/", "hello")).toBe(false)
      expect(shouldClearSlashCommand("/", "")).toBe(false)
      expect(shouldClearSlashCommand("/", "gc")).toBe(false)
    })

    test("clears just the slash character", () => {
      expect(shouldClearSlashCommand("/", "/")).toBe(true)
    })
  })

  describe("mention mode (@)", () => {
    test("never clears in mention mode", () => {
      expect(shouldClearSlashCommand("@", "/help")).toBe(false)
      expect(shouldClearSlashCommand("@", "/gc")).toBe(false)
      expect(shouldClearSlashCommand("@", "@file")).toBe(false)
    })
  })

  describe("hidden mode (false)", () => {
    test("never clears when autocomplete is hidden", () => {
      expect(shouldClearSlashCommand(false, "/help")).toBe(false)
      expect(shouldClearSlashCommand(false, "/gc")).toBe(false)
      expect(shouldClearSlashCommand(false, "anything")).toBe(false)
    })
  })

  describe("pasted command scenarios", () => {
    test("preserves pasted command with arguments (the main bug fix)", () => {
      // This was the original bug: pasting "/gcd:plan-phase 2" would get deleted
      expect(shouldClearSlashCommand("/", "/gcd:plan-phase 2")).toBe(false)
    })

    test("preserves pasted command with complex arguments", () => {
      expect(shouldClearSlashCommand("/", "/search query with spaces")).toBe(false)
      expect(shouldClearSlashCommand("/", "/run npm install --save")).toBe(false)
      expect(shouldClearSlashCommand("/", "/edit file.ts line 42")).toBe(false)
    })

    test("preserves command even with multiple spaces", () => {
      expect(shouldClearSlashCommand("/", "/cmd  double-space")).toBe(false)
      expect(shouldClearSlashCommand("/", "/cmd   triple")).toBe(false)
    })
  })

  describe("edge cases", () => {
    test("handles empty string", () => {
      expect(shouldClearSlashCommand("/", "")).toBe(false)
    })

    test("handles whitespace only", () => {
      expect(shouldClearSlashCommand("/", " ")).toBe(false)
      expect(shouldClearSlashCommand("/", "  ")).toBe(false)
    })

    test("handles slash with only whitespace", () => {
      // "/ " means user typed / then space - has space so don't clear
      expect(shouldClearSlashCommand("/", "/ ")).toBe(false)
    })

    test("handles commands with special characters", () => {
      expect(shouldClearSlashCommand("/", "/gcd:plan-phase")).toBe(true) // no args
      expect(shouldClearSlashCommand("/", "/gcd:plan-phase 2")).toBe(false) // with args
      expect(shouldClearSlashCommand("/", "/some_command")).toBe(true) // no args
      expect(shouldClearSlashCommand("/", "/some_command arg")).toBe(false) // with args
    })

    test("handles newlines in arguments", () => {
      expect(shouldClearSlashCommand("/", "/cmd arg1\narg2")).toBe(false)
    })

    test("handles tabs as whitespace", () => {
      expect(shouldClearSlashCommand("/", "/cmd\targ")).toBe(false)
    })
  })
})
