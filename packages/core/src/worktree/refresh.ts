export * as WorktreeRefresh from "./refresh.js"

import { Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Location } from "../location.js"
import { Plugin } from "../plugin.js"
import { PluginSupervisor } from "../plugin/supervisor.js"
import { Worktree } from "../worktree.js"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const plugins = yield* Plugin.Service
    const worktrees = yield* Worktree.Service
    if (location.workspaceID) return
    yield* plugins.awaitActivation.pipe(
      Effect.andThen(worktrees.refresh()),
      Effect.catchCause((cause) => Effect.logWarning("worktree refresh failed", { cause })),
      Effect.forkScoped,
    )
  }),
)

export const node = makeLocationNode({
  name: "worktree-refresh",
  layer,
  deps: [Worktree.node, Location.node, Plugin.node, PluginSupervisor.node],
})
