import { createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import type { PluginOptions } from "@opencode/plugin/gui"
import type { Bridge, BridgePluginGui, BridgePluginGuis, Entry } from "@opencode/plugin/gui/host"
import type { OpenCodeClient } from "@opencode/client/promise"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { pluginDefinition } from "./module"

/** A plugin's `./gui-experimental` bundle as this window evaluated it, at one revision. */
type Loaded = {
  readonly id: string
  readonly revision: string
  readonly definition: Entry
  readonly options: PluginOptions
}

/** A plugin's GUI as the plugin host runs it: its definition, options, and the client of the server that runs it. */
export type PluginGui = {
  readonly definition: Entry
  readonly options: PluginOptions
  readonly client: () => OpenCodeClient | undefined
}

/**
 * Loads the plugin GUIs main runs. Main alone lists the plugins on the desktop app's own server and reads their
 * `./gui-experimental` bundles; this window evaluates what main sends, so every window and main run the same set. That
 * server already runs the plugins' server entries, so their bundles add no new source of code; other servers' plugins
 * load no GUI.
 *
 * Mounted below the app's server providers, which the plugin root sits above, for the client of that server; it
 * hands the definitions up through `onChange` rather than the root reading them.
 */
export function PluginGuiLoader(props: {
  bridge: Bridge
  /** The GUIs that load, and the ids of plugins whose GUI cannot load because a built-in claims the id. */
  onChange: (plugins: readonly PluginGui[], reserved: readonly string[]) => void
}) {
  const global = useGlobal()

  const controller = createMemo(() => {
    const conn = global.servers.list().find(ServerConnection.builtin)

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  })

  // One evaluation per plugin revision, so an unchanged plugin keeps its definition and the host does not reload it.
  const cache = new Map<string, Loaded>()
  const [guis, setGuis] = createSignal<BridgePluginGuis>()

  onCleanup(
    props.bridge.on((message) => {
      if (message.type === "pluginGuis") setGuis({ plugins: message.plugins, reserved: message.reserved })
    }),
  )
  // A change main pushed while this request was in flight is newer than its reply.
  void props.bridge.pluginGuis().then(
    (initial) => setGuis((current) => current ?? initial),
    () => undefined,
  )

  const [found] = createResource(guis, async (input) => {
    const plugins = await Promise.all(input.plugins.map((plugin) => load(plugin, cache)))
    const ids = new Set(plugins.map((plugin) => plugin.id))
    cache.forEach((_, id) => {
      if (!ids.has(id)) cache.delete(id)
    })

    return { plugins, reserved: input.reserved }
  })

  // Syncs the loaded plugins out to the plugin host.
  createEffect(() => {
    const latest = found.latest

    if (!latest) return
    // The server that runs the plugin, read each time: it is a new client after that server restarts.
    const client = () => controller()?.sdk.api
    props.onChange(
      latest.plugins.map((plugin) => ({ definition: plugin.definition, options: plugin.options, client })),
      latest.reserved,
    )
  })

  return null
}

/** Evaluates a plugin's bundle when its revision is new to this window. */
async function load(plugin: BridgePluginGui, cache: Map<string, Loaded>): Promise<Loaded> {
  const cached = cache.get(plugin.id)

  if (cached?.revision === plugin.revision) return cached

  const next = {
    id: plugin.id,
    revision: plugin.revision,
    options: plugin.options,
    definition: await pluginDefinition(plugin.id, plugin.code),
  }

  cache.set(plugin.id, next)

  return next
}
