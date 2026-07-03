import { run } from "@opencode-ai/tui"
import { TuiConfig } from "@opencode-ai/tui/config"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { loadBuiltinPlugins } from "@opencode-ai/tui/builtins"
import { OpenCode } from "@opencode-ai/client/promise"
import type { Transport } from "@opencode-ai/client/effect"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { Args } from "@opencode-ai/tui/context/args"

export function runTui(transport: Transport, args: Args, discover?: () => Promise<Transport>) {
  const config = TuiConfig.resolve({}, { terminalSuspend: false })
  let disposeSlots: (() => void) | undefined
  return Effect.gen(function* () {
    const options = { baseUrl: transport.url, headers: transport.headers }
    const api = OpenCode.make(options)
    const directory = yield* Effect.tryPromise(() => api.file.list({ location: { directory: process.cwd() } })).pipe(
      Effect.map((response) => response.location.directory),
      Effect.catch(() =>
        Effect.tryPromise(() => api.location.get()).pipe(Effect.map((response) => response.directory)),
      ),
    )
    return yield* run({
      client: createOpencodeClient({ ...options, directory }),
      api,
      discover: discover
        ? async () => {
            const next = await discover()
            return {
              client: createOpencodeClient({ baseUrl: next.url, headers: next.headers, directory }),
              api: OpenCode.make({ baseUrl: next.url, headers: next.headers }),
            }
          }
        : undefined,
      args,
      config,
      pluginHost: {
        async start(input) {
          disposeSlots = await loadBuiltinPlugins(input.api, input.runtime)
        },
        async dispose() {
          disposeSlots?.()
        },
      },
    })
  }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
