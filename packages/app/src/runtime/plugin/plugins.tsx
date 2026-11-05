import { createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import type { PluginOptions } from "@opencode/plugin/gui"
import {
  pluginIdAvailable,
  runsOn,
  shipsPluginGui,
  type Bridge,
  type BridgePluginGui,
  type BridgePluginGuis,
  type Entry,
} from "@opencode/plugin/gui/host"
import type { OpenCodeClient } from "@opencode/client/promise"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { builtins } from "./builtins"
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
 * Loads the plugin GUIs that run in this window. On the desktop, main alone lists the plugins on the app's own
 * server and reads their `./gui-experimental` bundles; this window evaluates what main sends, so every window and
 * main run the same set. That server already runs the plugins' server entries, so their bundles add no new source
 * of code; other servers' plugins load no GUI.
 *
 * On the web there is no main process: the window itself lists the plugins on the server that served it, reads
 * their bundles there, and follows that server's `plugin.updated` event, the rules main applies for its own server.
 *
 * Mounted below the app's server providers, which the plugin root sits above, for the client of that server; it
 * hands the definitions up through `onChange` rather than the root reading them.
 */
export function PluginGuiLoader(props: {
  /** The desktop bridge, or none on the web. */
  bridge: Bridge | undefined
  /** The GUIs that load, and the ids of plugins whose GUI cannot load because a built-in claims the id. */
  onChange: (plugins: readonly PluginGui[], reserved: readonly string[]) => void
}) {
  const global = useGlobal()
  const servers = useServers()

  // The app's own server, as the registry names it: the desktop sidecar, or on the web the server that served this
  // page.
  const controller = createMemo(() => {
    const conn = servers.list.find((conn) => servers.current(conn))

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  })

  // One evaluation per plugin revision, so an unchanged plugin keeps its definition and the host does not reload it.
  const cache = new Map<string, Loaded>()
  const [guis, setGuis] = createSignal<BridgePluginGuis>()

  if (props.bridge) {
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
  } else {
    // A web window lists its own server's plugins itself: only plugins that ship a bundle, only ids no built-in of
    // this window claims, and a bundle that cannot be read is left out until the next change.
    let listing = 0

    const listPlugins = async () => {
      const api = controller()?.sdk.api

      if (!api) return

      const seq = ++listing

      const listed = await api.plugin.list().then(
        (result) => result.data,
        () => undefined,
      )

      if (!listed || seq !== listing) return

      const shipped = listed.filter(shipsPluginGui)
      const reserved = shipped.flatMap((plugin) => (pluginIdAvailable(plugin.id, builtins) ? [] : [plugin.id]))
      const loadable = shipped.filter((plugin) => !reserved.includes(plugin.id))

      const read = await Promise.all(
        loadable.map((plugin) =>
          api.plugin.gui({ id: plugin.id }).then(
            (result) => result.data,
            () => undefined,
          ),
        ),
      )

      // A newer listing that began while this one read its bundles decides.
      if (seq !== listing) return

      setGuis({
        plugins: loadable.flatMap((plugin, index) => {
          const bundle = read[index]

          return bundle
            ? [{ id: plugin.id, revision: bundle.revision, code: bundle.code, options: bundle.options }]
            : []
        }),
        reserved,
      })
    }

    // Lists once the server connects and again whenever its plugins change, the events main follows for its own.
    createEffect(() => {
      const ctx = controller()

      if (!ctx) return

      if (ctx.sdk.connection.status() === "connected") void listPlugins()

      onCleanup(ctx.sdk.event.on("plugin.updated", () => void listPlugins()))
    })
  }

  const [found] = createResource(guis, async (input) => {
    const loaded = await Promise.all(input.plugins.map((plugin) => load(plugin, cache)))
    // Main already ran its `runsOn` check on what it sends; a window that read the bundles itself runs it here, where
    // no OS is known and only a plugin that lists none runs.
    const plugins = props.bridge ? loaded : loaded.filter((plugin) => runsOn(plugin.definition, undefined))

    const ids = new Set(loaded.map((plugin) => plugin.id))
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
