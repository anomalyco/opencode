import { run } from "@opencode-ai/tui"
import { TuiConfig } from "@opencode-ai/tui/config"
import { createBuiltinPlugins } from "@opencode-ai/tui/builtins"
import type { TuiPluginHost } from "@opencode-ai/tui/plugin/runtime"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"

// Slots render nothing (not even their fallback children) until a plugin host calls setupSlots,
// and the home and session screens are slot-wrapped, so a no-op host leaves the TUI blank.
// Register the built-in feature plugins; loading external plugin packages stays out of this host.
const pluginHost: TuiPluginHost = {
  async start(input) {
    const slots = input.runtime.setupSlots(input.api)
    for (const plugin of createBuiltinPlugins({ experimentalEventSystem: false })) {
      if (plugin.enabled === false) continue
      // Object.create keeps the host api's getters live; a spread would snapshot them.
      const api = Object.assign(Object.create(input.api), {
        slots: {
          register(slotPlugin: { order?: number; slots: object }) {
            slots.register({ ...slotPlugin, id: plugin.id } as never)
            return plugin.id
          },
        },
      })
      await plugin
        .tui(api, undefined, { id: plugin.id } as never)
        .catch((error) => console.error("Failed to start builtin TUI plugin", plugin.id, error))
    }
  },
  async dispose() {},
}

export function runTui(transport: { url: string; headers: RequestInit["headers"] }) {
  const config = TuiConfig.resolve({}, { terminalSuspend: false })
  return run({
    ...transport,
    args: {},
    config,
    fetch: gracefulFetch,
    pluginHost,
  }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
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
