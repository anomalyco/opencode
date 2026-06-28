import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

/**
 * Spawns a dedicated merge session in the project's MAIN checkout and sends it
 * the squash-merge prompt. Both run under the main checkout's instance context
 * (via `InstanceStore.provide`) so `Session.create` and `SessionPrompt.prompt`
 * operate in that directory rather than the worktree.
 */
export async function startMerge(input: {
  mainCheckout: string
  branch: string
  system?: string
  model?: { providerID: string; modelID: string }
  prompt: string
}): Promise<{ sessionID: string; directory: string }> {
  const created = await AppRuntime.runPromise(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory: input.mainCheckout },
        Session.Service.use((session) => session.create({ title: `Merge ${input.branch}` })),
      ),
    ),
  )

  // Fire-and-forget the merge prompt: the worktree agent only needs the
  // tracking session id to report back to the user.
  AppRuntime.runFork(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory: input.mainCheckout },
        SessionPrompt.Service.use((prompt) =>
          prompt.prompt({
            sessionID: created.id,
            ...(input.model
              ? {
                  model: {
                    providerID: ProviderV2.ID.make(input.model.providerID),
                    modelID: ModelV2.ID.make(input.model.modelID),
                  },
                }
              : {}),
            ...(input.system ? { system: input.system } : {}),
            parts: [{ type: "text", text: input.prompt }],
          }),
        ),
      ),
    ).pipe(Effect.catchCause(() => Effect.void)),
  )

  return { sessionID: created.id as string, directory: input.mainCheckout }
}
