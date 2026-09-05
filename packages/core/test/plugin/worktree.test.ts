import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { Plugin } from "@opencode-ai/plugin"
import type { WorktreeDefinition } from "@opencode-ai/plugin/effect/worktree"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { State } from "@opencode-ai/core/state"
import { it } from "../lib/effect"
import { host } from "./host"

it.live("Promise worktree callbacks receive interruption through their AbortSignal", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<AbortSignal>()
    const state = State.create({
      initial: () => new Map<string, WorktreeDefinition>(),
      editor: (value) => ({
        add: (definition: WorktreeDefinition) => {
          value.set(definition.id, definition)
        },
      }),
    })
    const context = host()
    const plugin = PluginPromise.fromPromise(
      Plugin.define({
        id: "cancel-worktree",
        async setup(ctx) {
          await ctx.worktree.transform((editor) =>
            editor.add({
              id: "cancel",
              create: (_input, { signal }) =>
                new Promise<never>((_resolve, reject) => {
                  signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
                  Effect.runSync(Deferred.succeed(started, signal))
                }),
              remove: async () => {},
              list: async () => [],
            }),
          )
        },
      }),
    )
    yield* plugin.effect(host({ worktree: { ...context.worktree, transform: state.transform, reload: state.reload } }))
    const strategy = state.get().get("cancel")
    if (!strategy) return yield* Effect.die("Strategy was not registered")
    const fiber = yield* strategy.create({ sourceDirectory: "/source", directory: "/target" }).pipe(Effect.forkScoped)
    const signal = yield* Deferred.await(started)
    expect(signal.aborted).toBe(false)
    yield* Fiber.interrupt(fiber)
    const exit = yield* Fiber.await(fiber)
    expect(signal.aborted).toBe(true)
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  }),
)
