import { expect } from "bun:test"
import { Effect, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { ClaudeStatus } from "@opencode/core/plugin/provider/claude-agent/claude/status"
import { ClaudeProvider } from "@opencode/core/plugin/provider/claude-agent/provider"
import { ID } from "@opencode/core/plugin/provider/claude-agent/index"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Model } from "@opencode/core/model"
import { testEffect } from "../../../lib/effect"
import { eventually } from "../../../lib/eventually"
import { drain } from "../../../lib/clock"
import { PluginTestLayer } from "../../fixture"
import { FakeClaude } from "./lib/fake-claude"
import { FakeIO } from "./lib/fake-io"

const it = testEffect(PluginTestLayer)

function failedProbe() {
  const steps = FakeClaude.replay("startup")
  const context = steps.find((step) => step.type === "exchange" && step.input.request?.subtype === "get_context_usage")
  if (context?.type !== "exchange") throw new Error("Missing context recording")
  context.replies[0].response = {
    subtype: "error",
    request_id: context.replies[0].response.request_id,
    error: "429 Usage credits are required for this model",
  }
  return steps
}

for (const recover of [true, false]) {
  it.effect(
    recover
      ? "retries incomplete context discovery after a cooldown"
      : "bounds failed automatic checks without blocking explicit refresh",
    () =>
      Effect.gen(function* () {
        const scripts = recover
          ? [failedProbe(), FakeClaude.replay("startup")]
          : [failedProbe(), failedProbe(), failedProbe(), FakeClaude.replay("startup")]
        const claude = FakeClaude.make(scripts.flat())
        const io = FakeIO.make({ claude })
        const status = yield* ClaudeStatus.make(io, () => Effect.succeed({}))
        const plugins = yield* Plugin.Service
        const host = yield* PluginHost.make(plugins, ID)
        yield* host.storage.set("models", { models: [{ id: "opus", name: "Opus", efforts: [] }] })
        yield* ClaudeProvider.register(host, status, io)
        const models = yield* Model.Service
        const opus = models
          .all()
          .pipe(
            Effect.map((items) => items.find((item) => item.providerID === ClaudeProvider.ID && item.id === "opus")),
          )
        const report = (name: string) =>
          status.report({
            type: "ready",
            fromChat: true,
            probe: {
              version: "2.1.309",
              account: {},
              models: [{ value: "opus", displayName: name, description: "Opus" }],
            },
          })
        const complete = (index: number) =>
          Effect.gen(function* () {
            const last = scripts[index]?.at(-1)
            if (!last) throw new Error("Missing final probe step")
            yield* Effect.promise(() => claude.reached(last))
            const run = claude.runs[index]
            if (!run) throw new Error("Probe did not start")
            yield* Effect.promise(() => run.closed)
            yield* TestClock.withLive(
              eventually(SubscriptionRef.get(status.state), (state) => state.type === "ready" && !state.fromChat),
            )
            yield* TestClock.withLive(eventually(opus, (model) => model?.name !== "Opus chat"))
          })
        yield* report("Opus chat")
        yield* complete(0)
        expect((yield* opus)?.limit.context).toBe(200_000)
        expect(claude.runs).toHaveLength(1)
        yield* TestClock.adjust("299 seconds")
        yield* report("Before cooldown")
        yield* TestClock.withLive(eventually(opus, (model) => model?.name === "Before cooldown"))
        expect(claude.runs).toHaveLength(1)
        yield* TestClock.adjust("1 second")
        // Elapsing the cooldown alone never starts a probe.
        expect(claude.runs).toHaveLength(1)
        yield* report("Opus chat")
        yield* complete(1)
        expect(claude.runs).toHaveLength(2)
        expect((yield* opus)?.limit.context).toBe(recover ? 1_000_000 : 200_000)
        if (!recover) {
          yield* TestClock.adjust("5 minutes")
          yield* report("Opus chat")
          yield* complete(2)
          expect(claude.runs).toHaveLength(3)
        }
        yield* TestClock.adjust("1 hour")
        yield* report("After checks")
        yield* TestClock.withLive(eventually(opus, (model) => model?.name === "After checks"))
        yield* drain
        expect(claude.runs).toHaveLength(recover ? 2 : 3)
        if (!recover) {
          yield* status.refresh()
          yield* complete(3)
          yield* TestClock.withLive(eventually(opus, (model) => model?.limit.context === 1_000_000))
          expect(claude.runs).toHaveLength(4)
        }
        claude.check()
      }),
  )
}
