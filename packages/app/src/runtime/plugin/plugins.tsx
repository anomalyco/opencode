import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import type { PluginOptions } from "@opencode/plugin/gui"
import { pluginIdAvailable, runsOn, type Bridge, type Entry, type PluginFactory } from "@opencode/plugin/gui/host"
import type { OpenCodeClient } from "@opencode/client/promise"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { builtins } from "./builtins"
import { pluginDefinition, webPluginError } from "./module"
import {
  createPluginGuiState,
  PLUGIN_GUI_INITIAL_TIMEOUT_MS,
  transitionPluginGui,
  type LoadedPluginGui,
  type GuiSource,
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
 * Loads the plugin GUIs that run in this window. On the desktop, main alone lists the plugins on the app's own
 * server and reads their `./gui-experimental` bundles; this window evaluates what main sends, so every window and
 * main run the same set. Other servers' plugins load no GUI.
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
    if (effect.type === "fetch.initial") {
      const bridge = props.bridge

      if (!bridge) return

      return void Promise.try(() => bridge.pluginGuis()).then(
        (guis) => dispatch({ type: "initial.resolved", attempt: effect.attempt, guis }),
        (cause: unknown) => dispatch({ type: "initial.failed", attempt: effect.attempt, cause }),
      )
    }

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
        (loaded) =>
          dispatch({ type: "evaluated", attempt: effect.attempt, loaded: loaded.filter((item) => item !== undefined) }),
        (cause: unknown) => dispatch({ type: "evaluate.failed", attempt: effect.attempt, cause }),
      )

    if (effect.type === "publish")
      return props.onChange(
        effect.plugins
          .filter((plugin) => props.bridge || runsOn(plugin.definition, undefined))
          .map((plugin) => ({ definition: plugin.definition, options: plugin.options, client })),
        effect.reserved,
      )

    console.error("[plugin] failed to load plugin GUIs", effect.cause)
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  if (props.bridge) {
    onCleanup(
      props.bridge.on((message) => {
        if (message.type === "pluginGuis") dispatch({ type: "pushed", guis: message })
      }),
    )
    initial.effects.forEach(run)

    return null
  }

  createEffect(() => {
    const ctx = controller()

    if (!ctx || servers.ownUrl() !== window.location.origin || ctx.sdk.connection.status() !== "connected") return
    let pending: AbortController | undefined

    const refresh = () => {
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      void ctx.sdk.api.experimental.plugin.webList({ signal: controller.signal }).then(
        (listed) => {
          if (controller.signal.aborted) return
          const plugins = listed.filter((plugin) => pluginIdAvailable(plugin.id, builtins))
          const reserved = listed.flatMap((plugin) => (pluginIdAvailable(plugin.id, builtins) ? [] : [plugin.id]))
          dispatch({ type: "pushed", guis: { plugins, reserved } })
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) console.error("[plugin] could not list web GUIs", webPluginError(cause))
        },
      )
    }

    onCleanup(ctx.sdk.event.on("plugin.updated", refresh))
    onCleanup(() => pending?.abort())
    refresh()
  })

  return null
}

/** A failed module request leaves the previously published revision running until a fresh listing. */
async function evaluate(plugin: GuiSource): Promise<LoadedPluginGui | undefined> {
  const code = "code" in plugin ? plugin.code : await importWebFactory(plugin)

  if (code === undefined) return undefined

  return {
    id: plugin.id,
    revision: plugin.revision,
    options: plugin.options,
    definition: await pluginDefinition(plugin.id, code),
  }
}

async function importWebFactory(plugin: Extract<GuiSource, { ticket: string }>) {
  const url = new URL("/api/experimental/plugin/web-module", window.location.origin)
  url.search = new URLSearchParams({ id: plugin.id, revision: plugin.revision, ticket: plugin.ticket }).toString()

  const module: { default: PluginFactory } | undefined = await import(/* @vite-ignore */ url.href).catch(
    (cause: unknown) => {
      console.error(
        "[plugin] could not import web GUI",
        plugin.id,
        plugin.revision,
        webPluginError(cause, plugin.ticket),
      )

      return undefined
    },
  )

  return module?.default
}
