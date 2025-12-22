import { describe, expect, test } from "bun:test"
import { SessionRunner } from "../../src/session/runner"

describe("SessionRunner", () => {
  describe("Options schema", () => {
    test("validates valid options", () => {
      const valid = {
        model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
        agent: "code",
      }
      expect(SessionRunner.Options.safeParse(valid).success).toBe(true)
    })

    test("validates options with tools", () => {
      const opts = {
        model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
        agent: "code",
        tools: { bash: true, read: true, write: false },
      }
      expect(SessionRunner.Options.safeParse(opts).success).toBe(true)
    })

    test("validates options with timeout", () => {
      const opts = {
        model: { providerID: "openai", modelID: "gpt-4" },
        agent: "general",
        timeoutMs: 30000,
        maxSteps: 10,
      }
      expect(SessionRunner.Options.safeParse(opts).success).toBe(true)
    })

    test("rejects missing model", () => {
      expect(SessionRunner.Options.safeParse({ agent: "code" }).success).toBe(false)
    })

    test("rejects missing agent", () => {
      const opts = { model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" } }
      expect(SessionRunner.Options.safeParse(opts).success).toBe(false)
    })

    test("rejects invalid model structure", () => {
      const opts = { model: { providerID: "anthropic" }, agent: "code" }
      expect(SessionRunner.Options.safeParse(opts).success).toBe(false)
    })
  })

  describe("stub methods", () => {
    test("runBackground throws", () => {
      const opts: SessionRunner.Options = {
        model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
        agent: "code",
      }
      expect(() => SessionRunner.runBackground("session_123", opts)).toThrow("not yet implemented")
    })

    test("cancelBackground throws", () => {
      expect(() => SessionRunner.cancelBackground("session_123")).toThrow("not yet implemented")
    })

    test("waitFor throws", async () => {
      await expect(SessionRunner.waitFor("session_123")).rejects.toThrow("not yet implemented")
    })
  })
})
