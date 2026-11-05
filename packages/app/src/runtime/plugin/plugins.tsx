import { createMemo, onCleanup, untrack } from "solid-js"
import type { PluginOptions } from "@opencode/plugin/gui"
import type { Bridge, BridgePluginGui, Entry } from "@opencode/plugin/gui/host"
import type { OpenCodeClient } from "@opencode/client/promise"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { pluginDefinition } from "./module"
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

  const run = (effect: PluginGuiEffect) => {
    if (effect.type === "fetch.initial")
      return void Promise.try(() => props.bridge.pluginGuis()).then(
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
      return void Promise.all(effect.plugins.map(evaluate)).then(
        (loaded) => dispatch({ type: "evaluated", attempt: effect.attempt, loaded }),
        (cause: unknown) => dispatch({ type: "evaluate.failed", attempt: effect.attempt, cause }),
      )

    if (effect.type === "publish")
      return props.onChange(
        effect.plugins.map((plugin) => ({ definition: plugin.definition, options: plugin.options, client })),
        effect.reserved,
      )

    console.error("[plugin] failed to load plugin GUIs", effect.cause)
  }

  onCleanup(
    props.bridge.on((message) => {
      if (message.type === "pluginGuis")
        dispatch({ type: "pushed", guis: { plugins: message.plugins, reserved: message.reserved } })
    }),
  )
  onCleanup(() => dispatch({ type: "disposed" }))
  initial.effects.forEach(run)

  return null
}

/** Evaluates a plugin's bundle at the revision main sent. */
async function evaluate(plugin: BridgePluginGui): Promise<LoadedPluginGui> {
  return {
    id: plugin.id,
    revision: plugin.revision,
    options: plugin.options,
    definition: await pluginDefinition(plugin.id, plugin.code),
  }
}
