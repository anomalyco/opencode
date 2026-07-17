import type { PluginInput, WorkspaceAdapter } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Effect } from "effect"
import { registerAdapter } from "@/control-plane/adapters"
import { ServerAuth } from "@/server/auth"
import type { InstanceContext } from "@/project/instance-context"

export const makeInput = Effect.fnUntraced(function* (ctx: InstanceContext) {
  const { Server } = yield* Effect.promise(() => import("../server/server"))
  const serverUrl = Server.url
  const client = createOpencodeClient({
    baseUrl: serverUrl?.toString() ?? "http://localhost:4096",
    directory: ctx.directory,
    headers: ServerAuth.headers(),
    ...(serverUrl ? {} : { fetch: async (...args) => Server.Default().app.fetch(...args) }),
  })

  const input: PluginInput = {
    client,
    project: ctx.project,
    worktree: ctx.worktree,
    directory: ctx.directory,
    experimental_workspace: {
      register(type: string, adapter: WorkspaceAdapter) {
        registerAdapter(ctx.project.id, type, adapter as Parameters<typeof registerAdapter>[2])
      },
    },
    get listenerUrl(): URL | undefined {
      return Server.url
    },
    get serverUrl(): URL {
      return Server.url ?? new URL("http://localhost:4096")
    },
    // @ts-expect-error
    $: typeof Bun === "undefined" ? undefined : Bun.$,
  }
  return input
})
