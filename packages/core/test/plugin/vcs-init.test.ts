import { expect } from "bun:test"
import { Plugin } from "@opencode/plugin"
import type { VcsDefinition } from "@opencode/plugin/effect/vcs"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { State } from "@opencode/core/state"
import { Effect } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

it.live("Promise VCS initializer reaches the registered provider with its location scope", () =>
  Effect.gen(function* () {
    const calls: string[] = []
    const state = State.create({
      initial: () => new Map<string, VcsDefinition>(),
      editor: (providers) => ({
        add: (definition: VcsDefinition) => providers.set(definition.id, definition),
        default: { get: () => undefined, set: (_selection: string) => {} },
      }),
    })
    const context = host()
    const plugin = PluginPromise.fromPromise(
      Plugin.define({
        id: "init-vcs",
        async setup(ctx) {
          await ctx.vcs.transform((editor) =>
            editor.add({
              id: "custom",
              name: "Custom VCS",
              init: async (scope, { signal }) => {
                expect(signal.aborted).toBe(false)
                calls.push(scope.worktree)
              },
              info: async () => ({ branch: {} }),
              branches: async () => [],
              status: async () => [],
              diff: async () => [],
            }),
          )
        },
      }),
    )
    yield* plugin.effect(host({ vcs: { ...context.vcs, transform: state.transform, reload: state.reload } }))
    const init = state.get().get("custom")?.init
    if (!init) return yield* Effect.die("Initializer was not registered")
    yield* init({ directory: "/workspace", worktree: "/workspace", canonical: "/workspace" })
    expect(calls).toEqual(["/workspace"])
  }),
)
