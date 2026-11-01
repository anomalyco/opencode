import { describe, expect } from "bun:test"
import { Effect, Fiber, SubscriptionRef } from "effect"
import { ClaudeProbe } from "@opencode/core/plugin/provider/claude-agent/claude/probe"
import { ClaudeStatus } from "@opencode/core/plugin/provider/claude-agent/claude/status"
import { it } from "../../../../lib/effect"
import { FakeClaude } from "../lib/fake-claude"
import { FakeIO } from "../lib/fake-io"

describe("login status", () => {
  it.effect("finds claude when it is installed after the plugin starts", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([FakeClaude.expectStartup()])
      let executable: string | undefined
      const io = { ...FakeIO.make({ claude }), which: () => executable }
      const status = yield* ClaudeStatus.make(io, () => Effect.succeed({}))

      yield* status.refresh()
      expect(yield* SubscriptionRef.get(status.state)).toEqual({ type: "missing" })

      executable = FakeIO.EXECUTABLE
      yield* status.refresh()
      expect((yield* SubscriptionRef.get(status.state)).type).toBe("ready")
      claude.check()
    }),
  )

  it.effect("a reconnect waits for the startup check, then publishes the new login", () =>
    Effect.gen(function* () {
      const hold = Promise.withResolvers<void>()
      const atStart = FakeClaude.expectStartup({ recording: "startup-logged-out", hold: hold.promise })
      const onConnect = FakeClaude.expectStartup()
      const claude = FakeClaude.make([atStart, onConnect])
      const status = yield* ClaudeStatus.make(FakeIO.make({ claude }), () => Effect.succeed({}))

      const startup = yield* status.refresh().pipe(Effect.forkScoped)
      yield* Effect.promise(() => claude.started(atStart))
      const reconnect = yield* status.refresh().pipe(Effect.forkScoped({ startImmediately: true }))
      expect(claude.runs).toHaveLength(1)

      hold.resolve()
      yield* Fiber.join(startup)
      yield* Fiber.join(reconnect)
      const state = yield* SubscriptionRef.get(status.state)
      expect(state.type).toBe("ready")
      if (state.type !== "ready") throw new Error("login check did not finish")
      expect(ClaudeProbe.isLoggedIn(state.probe.account)).toBe(true)
      claude.check()
    }),
  )

  it.effect("reports a failed startup and recovers on the next check", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([FakeClaude.expectStartup({ exitCode: 1 }), FakeClaude.expectStartup()])
      const status = yield* ClaudeStatus.make(FakeIO.make({ claude }), () => Effect.succeed({}))

      yield* status.refresh()
      const failed = yield* SubscriptionRef.get(status.state)
      expect(failed.type).toBe("failed")
      if (failed.type !== "failed") throw new Error("startup failure was not reported")
      expect(failed.message).toContain("code 1")

      yield* status.refresh()
      expect((yield* SubscriptionRef.get(status.state)).type).toBe("ready")
      claude.check()
    }),
  )
})
