import { Git } from "@opencode-ai/core/git"
import { SessionV2 } from "@opencode-ai/core/session"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { WorktreeMergeRequestTool } from "@opencode-ai/core/tool/worktree-merge-request"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Effect, Layer } from "effect"

/**
 * Registers the process-global `worktree_merge_request` tool. It is built here,
 * at the server composition root, rather than in `LocationServiceMap`, because
 * its implementation spawns a session in the project's main checkout and that
 * requires the process-global `SessionV2.Service` wired ABOVE the Location
 * service map. Registering it through the shared `ApplicationTools` registry
 * makes it visible to every Location's session runner.
 */
const worktreeMergeToolLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const git = yield* Git.Service
    const tools = yield* ApplicationTools.Service
    yield* tools
      .register({ [WorktreeMergeRequestTool.name]: WorktreeMergeRequestTool.make({ session, git }) })
      .pipe(Effect.orDie)
  }),
).pipe(Layer.provide(Git.defaultLayer))

// Side-effect-only global node: it registers into the shared `ApplicationTools`
// registry (same process-global instance LocationServiceMap reads from) and
// resolves `SessionV2.Service` from the process-global Session node.
export const worktreeMergeToolNode = makeGlobalNode({
  name: "worktree-merge-tool",
  layer: worktreeMergeToolLayer,
  deps: [SessionV2.node, ApplicationTools.node],
})
