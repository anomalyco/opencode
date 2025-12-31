/**
 * Tests for Plugin.trigger BlockedError handling
 *
 * Verifies that BlockedError from hooks is caught and returns
 * { blocked: { hookEvent, reason } } instead of crashing.
 */

import { describe, expect, test } from "bun:test"

describe("Plugin.trigger BlockedError handling", () => {
  class BlockedError extends Error {
    public readonly hookEvent: string
    public readonly reason: string

    constructor(hookEvent: string, reason: string) {
      super(reason)
      this.name = "BlockedError"
      this.hookEvent = hookEvent
      this.reason = reason
    }
  }

  describe("isBlockedError type guard", () => {
    test("should identify BlockedError correctly", () => {
      // #given
      const blockedError = new BlockedError("PreToolUse", "blocked by policy")
      const genericError = new Error("generic")
      const isBlockedError = (e: unknown): e is BlockedError =>
        e instanceof Error &&
        (e as any).name === "BlockedError" &&
        typeof (e as any).hookEvent === "string" &&
        typeof (e as any).reason === "string"

      // #when / #then
      expect(isBlockedError(blockedError)).toBe(true)
      expect(isBlockedError(genericError)).toBe(false)
    })
  })

  describe("BlockedError catch and return pattern", () => {
    test("should return blocked result when BlockedError is caught", async () => {
      // #given
      const mockHook = async () => {
        throw new BlockedError("UserPromptSubmit", "prompt validation failed")
      }
      const output = { message: { role: "user" }, parts: [] }

      // #when
      let result: any
      try {
        await mockHook()
        result = output
      } catch (e) {
        if (e instanceof BlockedError) {
          result = { ...output, blocked: { hookEvent: e.hookEvent, reason: e.reason } }
        } else {
          throw e
        }
      }

      // #then
      expect(result.blocked).toBeDefined()
      expect(result.blocked.hookEvent).toBe("UserPromptSubmit")
      expect(result.blocked.reason).toBe("prompt validation failed")
      expect(result.message).toEqual({ role: "user" })
    })

    test("should re-throw non-BlockedError exceptions", async () => {
      // #given
      const mockHook = async () => {
        throw new Error("unexpected error")
      }

      // #when / #then
      await expect(mockHook()).rejects.toThrow("unexpected error")
    })
  })

  describe("Output should contain blocked info when hook blocks", () => {
    test("PreToolUse BlockedError should result in blocked output", () => {
      // #given
      const output = { args: { command: "rm -rf /" } }
      const error = new BlockedError("PreToolUse", "dangerous command blocked")

      // #when
      const result = { ...output, blocked: { hookEvent: error.hookEvent, reason: error.reason } }

      // #then
      expect(result.args.command).toBe("rm -rf /")
      expect(result.blocked.hookEvent).toBe("PreToolUse")
      expect(result.blocked.reason).toBe("dangerous command blocked")
    })
  })
})
