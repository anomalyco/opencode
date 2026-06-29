import { run } from "@opencode-ai/tui"
import { TuiConfig } from "@opencode-ai/tui/config"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { loadBuiltinPlugins } from "@opencode-ai/tui/builtins"
import { OpenCode } from "@opencode-ai/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

type Transport = { url: string; headers: RequestInit["headers"] }

export function runTui(transport: Transport, reload?: () => Promise<Transport>) {
  const config = TuiConfig.resolve({}, { terminalSuspend: false })
  let disposeSlots: (() => void) | undefined
  return Effect.gen(function* () {
    const options = { baseUrl: transport.url, headers: transport.headers }
    const api = OpenCode.make(options)
    const directory = yield* Effect.tryPromise(() => api.files.list({ location: { directory: process.cwd() } })).pipe(
      Effect.map((response) => response.location.directory),
      Effect.catch(() =>
        Effect.tryPromise(() => api.location.get()).pipe(Effect.map((response) => response.directory)),
      ),
    )
    return yield* run({
      client: createOpencodeClient({ ...options, directory }),
      api,
      reload: reload
        ? async () => {
            const next = await reload()
            return {
              client: createOpencodeClient({ baseUrl: next.url, headers: next.headers, directory }),
              api: OpenCode.make({ baseUrl: next.url, headers: next.headers }),
            }
          }
        : undefined,
      args: {},
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
  }).pipe(Effect.provide(Global.defaultLayer))
}
