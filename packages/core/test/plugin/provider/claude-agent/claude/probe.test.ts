import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { ClaudeProbe } from "@opencode/core/plugin/provider/claude-agent/claude/probe"
import { ClaudeQueryOptions } from "@opencode/core/plugin/provider/claude-agent/claude/query-options"
import { it } from "../../../../lib/effect"
import { FakeClaude } from "../lib/fake-claude"
import { FakeIO } from "../lib/fake-io"

describe("login check", () => {
  it.effect("discovers each model's capacity without sending a prompt", () =>
    Effect.gen(function* () {
      const steps = FakeClaude.replay("startup")
      const context = steps.find(
        (step) => step.type === "exchange" && step.input.request?.subtype === "get_context_usage",
      )
      if (context?.type !== "exchange") throw new Error("Missing context recording")
      // Claude's auto-compaction window is not the model's capacity.
      context.replies[0].response.response.maxTokens = 200_000
      const claude = FakeClaude.make(steps)
      const result = yield* ClaudeProbe.run(
        ClaudeQueryOptions.base({ executable: FakeIO.EXECUTABLE, io: FakeIO.make({ claude }) }),
      )
      expect(result.models.find((model) => model.value === "opus")?.contextWindow).toBe(1_000_000)
      expect(result.models.find((model) => model.value === "claude-opus-4-6")?.contextWindow).toBe(200_000)
      expect(claude.runs[0]!.received.some((message) => message.type === "user")).toBe(false)
      claude.check()
    }),
  )

  it.effect("keeps the login and other limits when one model reports an invalid capacity", () =>
    Effect.gen(function* () {
      const steps = FakeClaude.replay("startup")
      const context = steps.find(
        (step) => step.type === "exchange" && step.input.request?.subtype === "get_context_usage",
      )
      if (context?.type !== "exchange") throw new Error("Missing context recording")
      context.replies[0].response.response.rawMaxTokens = 0
      const claude = FakeClaude.make(steps)
      const result = yield* ClaudeProbe.run(
        ClaudeQueryOptions.base({ executable: FakeIO.EXECUTABLE, io: FakeIO.make({ claude }) }),
      )
      expect(ClaudeProbe.isLoggedIn(result.account)).toBe(true)
      expect(result.models.find((model) => model.value === "opus")?.contextWindow).toBeUndefined()
      expect(result.models.find((model) => model.value === "sonnet")?.contextWindow).toBe(1_000_000)
      claude.check()
    }),
  )

  it.effect("closes stuck context discovery without turning it into a login failure", () =>
    Effect.gen(function* () {
      const steps = FakeClaude.replay("startup").slice(0, 3)
      const context = { ...steps[2]!, hold: new Promise<void>(() => {}) }
      steps[2] = context
      const claude = FakeClaude.make(steps)
      const check = yield* ClaudeProbe.run(
        ClaudeQueryOptions.base({ executable: FakeIO.EXECUTABLE, io: FakeIO.make({ claude }) }),
      ).pipe(Effect.forkScoped)
      yield* Effect.promise(() => claude.started(context))
      yield* TestClock.adjust("30 seconds")
      const result = yield* Fiber.join(check)
      expect(ClaudeProbe.isLoggedIn(result.account)).toBe(true)
      expect(result.models.find((model) => model.value === "opus")?.contextWindow).toBeUndefined()
      yield* Effect.promise(() => claude.runs[0]!.closed)
      expect(() => claude.check()).toThrow("1 script steps did not finish")
    }),
  )

  it.effect("times out a stuck startup and closes the process", () =>
    Effect.gen(function* () {
      const startup = FakeClaude.expectStartup({ hold: new Promise<void>(() => {}) })
      const claude = FakeClaude.make([startup])
      const io = FakeIO.make({ claude })
      const check = yield* ClaudeProbe.run(ClaudeQueryOptions.base({ executable: FakeIO.EXECUTABLE, io })).pipe(
        Effect.flip,
        Effect.forkScoped,
      )
      yield* Effect.promise(() => claude.started(startup))
      yield* TestClock.adjust("30 seconds")
      const error = yield* Fiber.join(check)
      expect(String(error.cause)).toContain("did not start within 30 seconds")
      yield* Effect.promise(() => claude.runs[0]!.closed)
    }),
  )
})

describe("compatibility and login", () => {
  test("only 2.1.248 or later is compatible", () => {
    expect(ClaudeProbe.versionError("2.1.248")).toBeUndefined()
    expect(ClaudeProbe.versionError("2.1.247")?.message).toContain("claude update")
    expect(ClaudeProbe.versionError(undefined)?.message).toContain("claude update")
  })

  test("only a missing credential counts as logged out", () => {
    expect(ClaudeProbe.isLoggedIn({ tokenSource: "none", apiProvider: "firstParty" })).toBe(false)
    expect(ClaudeProbe.isLoggedIn({ tokenSource: "none", apiKeySource: "ANTHROPIC_API_KEY" })).toBe(true)
    expect(ClaudeProbe.isLoggedIn({ subscriptionType: "Claude Team", apiProvider: "firstParty" })).toBe(true)
  })
})
