import { run } from "@opencode-ai/tui"
import { TuiConfig } from "@opencode-ai/tui/config"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { loadBuiltinPlugins } from "@opencode-ai/tui/builtins"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

export function runTui(transport: { url: string; headers: RequestInit["headers"] }) {
  const config = TuiConfig.resolve({}, { terminalSuspend: false })
  let disposeSlots: (() => void) | undefined
  return Effect.gen(function* () {
    const client = createOpencodeClient({ baseUrl: transport.url, headers: transport.headers, fetch: gracefulFetch })
    // The long-lived server may have started from a different directory than this CLI.
    // Probe the client cwd on the server before making it the TUI's default location.
    const directory = yield* Effect.tryPromise(() =>
      client.v2.fs.list({ location: { directory: process.cwd() } }, { throwOnError: true }),
    ).pipe(
      Effect.map((response) => response.data.location.directory),
      Effect.catch(() =>
        // A client path may not exist on a remote server, so preserve the server's own default in that case.
        Effect.tryPromise(() => client.v2.location.get(undefined, { throwOnError: true })).pipe(
          Effect.map((response) => response.data.directory),
        ),
      ),
    )
    return yield* run({
      ...transport,
      directory,
      args: {},
      config,
      fetch: gracefulFetch,
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

const legacyDefaults: Record<string, unknown> = {
  "/config/providers": { providers: [], default: {} },
  "/provider": { all: [], default: {}, connected: [] },
  "/agent": [],
  "/config": {},
}

const gracefulFetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init)
    if (response.status !== 404) return response
    const fallback = legacyDefaults[new URL(input instanceof Request ? input.url : input).pathname]
    if (fallback === undefined) return response
    return Response.json(fallback)
  },
  { preconnect: fetch.preconnect },
)
