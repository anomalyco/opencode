import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import type { PluginOptions } from "@opencode/plugin/gui"
import {
  pluginIdAvailable,
  runsOn,
  type Bridge,
  type BridgePluginGui,
  type BridgePluginGuis,
  type Entry,
} from "@opencode/plugin/gui/host"
import type { OpenCodeClient } from "@opencode/client/promise"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { builtins } from "./builtins"
import { pluginDefinition, webPluginDefinition } from "./module"
import {
  createPluginGuiState,
  PLUGIN_GUI_INITIAL_TIMEOUT_MS,
  transitionPluginGui,
  type LoadedPluginGui,
  type PluginGuiEffect,
  type PluginGuiEvent,
} from "./plugin-gui-machine"

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
 * A web tab has no main process. It lists the plugins that the server which served it allows on the web
 * (`experimental.plugin_gui_web`) and reads their bundles itself, with its own credential, applying the id and OS
 * checks main applies on desktop. It runs only their window setups.
 *
 * Mounted below the app's server providers, which the plugin root sits above, for the client of that server; it
 * hands the definitions up through `onChange` rather than the root reading them.
 */
export function PluginGuiLoader(props: {
  /** The desktop bridge; undefined in a web tab. */
  bridge: Bridge | undefined
  /** The GUIs that load, and the ids of plugins whose GUI cannot load because a built-in claims the id. */
  onChange: (plugins: readonly PluginGui[], reserved: readonly string[]) => void
}) {
  const global = useGlobal()
  const servers = useServers()
  const bridge = props.bridge

  const controller = createMemo(() => {
    const conn = global.servers.list().find(bridge ? ServerConnection.builtin : servers.current)

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  })

  // The server that runs the plugin, read each time: it is a new client after that server restarts.
  const client = () => controller()?.sdk.api
  const initial = createPluginGuiState()
  const machine = { state: initial.state }
  // Events an effect raises synchronously wait behind that effect.
  const queue: PluginGuiEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: PluginGuiEvent) => {
    queue.push(event)

    if (queue.length === 1) untrack(drain)
  }

  const drain = () => {
    const event = queue[0]

    if (!event) return

    try {
      const next = transitionPluginGui(machine.state, event)

      machine.state = next.state
      next.effects.forEach((effect) =>
        Promise.try(() => run(effect)).catch((cause: unknown) =>
          console.error("[plugin] plugin GUI effect failed", cause),
        ),
      )
    } finally {
      queue.shift()
    }

    drain()
  }

  // A web tab's own server lists what main would send.
  const list = () => (bridge ? bridge.pluginGuis() : webGuis(client()))

  const run = (effect: PluginGuiEffect) => {
    if (effect.type === "fetch.initial")
      return void Promise.try(list).then(
        (guis) => dispatch({ type: "initial.resolved", attempt: effect.attempt, guis }),
        (cause: unknown) => dispatch({ type: "initial.failed", attempt: effect.attempt, cause }),
      )

    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer = setTimeout(() => dispatch({ type: "timeout", attempt: effect.attempt }), PLUGIN_GUI_INITIAL_TIMEOUT_MS)

      return
    }

    if (effect.type === "timer.stop") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "evaluate")
      return void Promise.all(effect.plugins.map((plugin) => evaluate(plugin, !bridge))).then(
        (loaded) => dispatch({ type: "evaluated", attempt: effect.attempt, loaded }),
        (cause: unknown) => dispatch({ type: "evaluate.failed", attempt: effect.attempt, cause }),
      )

    if (effect.type === "publish")
      return props.onChange(
        effect.plugins
          // Main leaves out plugins limited to other systems; on the web no OS is known, so only those that list none run.
          .filter((plugin) => bridge || runsOn(plugin.definition, undefined))
          .map((plugin) => ({ definition: plugin.definition, options: plugin.options, client })),
        effect.reserved,
      )

    console.error("[plugin] failed to load plugin GUIs", effect.cause)
  }

  if (bridge)
    onCleanup(
      bridge.on((message) => {
        if (message.type === "pluginGuis")
          dispatch({ type: "pushed", guis: { plugins: message.plugins, reserved: message.reserved } })
      }),
    )

  // On the web, the tab lists again on each `plugin.updated` and reconnect, as main does, and once a server that was
  // not there for the first list arrives. Only the newest listing is pushed.
  if (!bridge) {
    const first = untrack(controller)
    const listing = { count: 0 }

    createEffect(() => {
      const ctx = controller()

      if (!ctx) return

      const relist = () => {
        const count = ++listing.count

        void webGuis(ctx.sdk.api).then(
          (guis) => {
            if (count === listing.count) dispatch({ type: "pushed", guis })
          },
          (cause: unknown) => console.error("[plugin] failed to list plugin GUIs", cause),
        )
      }

      if (ctx !== first) relist()
      onCleanup(ctx.sdk.event.on("plugin.updated", relist))
      onCleanup(ctx.sdk.event.on("server.connected", relist))
    })
  }

  onCleanup(() => dispatch({ type: "disposed" }))
  initial.effects.forEach(run)

  return null
}

/**
 * The plugin GUIs a web tab loads: those its server allows on the web, read as main reads them on desktop. A plugin
 * whose id a built-in claims stays out, and a bundle that cannot be read is left out until the next listing.
 */
async function webGuis(api: OpenCodeClient | undefined): Promise<BridgePluginGuis> {
  if (!api) throw new Error("The app's own server is unavailable")

  const listed = (await api.experimental.plugin.web()).data.flatMap((plugin) => (plugin.id ? [plugin.id] : []))
  const reserved = listed.filter((id) => !pluginIdAvailable(id, builtins))

  const plugins = await Promise.all(
    listed
      .filter((id) => !reserved.includes(id))
      .map((id) =>
        api.plugin.gui({ id }).then(
          (bundle) => [{ ...bundle.data, id }],
          (cause: unknown) => {
            console.error("[plugin] failed to read a plugin GUI", id, cause)

            return []
          },
        ),
      ),
  )

  return { plugins: plugins.flat(), reserved }
}

/** Evaluates a plugin's bundle at the revision main sent, or a web tab listed. */
async function evaluate(plugin: BridgePluginGui, web: boolean): Promise<LoadedPluginGui> {
  return {
    id: plugin.id,
    revision: plugin.revision,
    options: plugin.options,
    definition: await (web ? webPluginDefinition : pluginDefinition)(plugin.id, plugin.code),
  }
}
