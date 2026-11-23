import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  onCleanup,
  untrack,
  useContext,
  type ParentProps,
} from "solid-js"
import { reconcile } from "solid-js/store"
import { Schema } from "effect"
import { MenuItem, Server, type ServerEntry } from "@opencode/plugin/gui"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import {
  canAuthenticatePluginServer,
  createPluginServerState,
  selectPluginStatus,
  transitionPluginServer,
  type PluginEntrySnapshot,
  type PluginServerEvent,
} from "@/runtime/server/plugin-machine"
import type { ServerConnection } from "@/runtime/server/registry"
import { usePluginHost } from "./host"
import { renamedFrom } from "./stores"

/** A server a plugin contributes. `key` is `${plugin}:${entry.id}`. */
export type PluginServer = { readonly key: string; readonly plugin: string; readonly entry: ServerEntry }

// The last complete inventory of each plugin that contributes servers, without endpoints or credentials.
const Inventories = Schema.Record(
  Schema.String,
  Schema.mutableKey(
    Persistence.struct({
      order: Schema.Finite,
      servers: Persistence.array(
        Persistence.struct({
          id: Schema.String,
          name: Schema.String,
          label: Persistence.optional(Schema.String),
          listed: Persistence.optional(Schema.Boolean),
        }),
      ),
    }),
  ),
)

const ServersContext = createContext<ReturnType<typeof createPluginServers>>()

export function usePluginServers() {
  const value = useContext(ServersContext)

  if (!value) throw new Error("Plugin servers are unavailable")

  return value
}

/** Collects Server contributions, and reports to the host's startup gate once they are known. */
export function PluginServersProvider(props: ParentProps) {
  return <ServersContext.Provider value={createPluginServers()}>{props.children}</ServersContext.Provider>
}

function createPluginServers() {
  const host = usePluginHost()

  const [known, setKnown, , knownReady] = persisted(
    { ...Persist.global("plugin.servers"), copyFrom: [renamedFrom(Persist.global("extension.servers"))] },
    Inventories,
    {},
  )

  // A failed read settles the inventory too: startup then shows only the servers that report.
  const settled = () => host.gate({ type: "inventory.settled" })
  void Promise.resolve(knownReady.promise).then(settled, settled)

  const sources = createMemo(() => host.items(Server).toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0)))

  // Startup waits once for every source to report or for its main entry to fail; one that reloads later does not hide
  // the app again.
  createRenderEffect(() => {
    if (host.ready() && sources().every((item) => item.value.ready || host.mainFailed(item.plugin)))
      host.gate({ type: "sources.settled" })
  })

  // Only a ready source reports its complete inventory. One that reloads, fails or has not started keeps its last
  // inventory as stopped entries, so its servers' tabs, drafts and routes outlive the outage.
  const available = createMemo(() => sources().filter((item) => item.value.ready))
  createEffect(() => {
    if (!knownReady()) return

    for (const item of available()) {
      const inventory = {
        order: item.value.order ?? 0,
        servers: item.value.entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          label: entry.label,
          listed: entry.listed,
        })),
      }

      if (JSON.stringify(known[item.plugin]) !== JSON.stringify(inventory)) setKnown(item.plugin, reconcile(inventory))
    }
  })

  const entries = createMemo(() => {
    const live = available()
    const down = Object.entries(known).filter(([plugin]) => !live.some((item) => item.plugin === plugin))

    return [
      ...live.map((item) => ({ plugin: item.plugin, order: item.value.order ?? 0, entries: item.value.entries })),
      ...down.map(([plugin, inventory]) => ({
        plugin,
        order: inventory.order,
        entries: inventory.servers.map((server): ServerEntry => ({ ...server, state: "stopped" })),
      })),
    ]
      .toSorted((a, b) => a.order - b.order)
      .flatMap((group) =>
        group.entries.map(
          (entry): PluginServer => ({ key: `${group.plugin}:${entry.id}`, plugin: group.plugin, entry }),
        ),
      )
  })

  // Routes key on the connection object. Keep one per key across entry updates so reconnecting
  // never unmounts an open conversation or composer.
  const connections = new Map<string, ReturnType<typeof connection>>()

  const list = createMemo(() => {
    const listed = entries().filter((item) => item.entry.listed !== false)
    const keys = new Set(listed.map((item) => item.key))
    connections.forEach((item, key) => {
      if (keys.has(key)) return
      item.dispose()
      connections.delete(key)
    })

    return listed.map((item) => {
      const existing = connections.get(item.key)

      if (existing) {
        existing.update(item)

        return existing.value
      }

      const created = connection(item)
      connections.set(item.key, created)

      return created.value
    })
  })

  onCleanup(() => connections.forEach((item) => item.dispose()))

  return {
    ready: host.serversReady,
    /** Contributed servers the app lists, as stable connections. */
    list,
    /**
     * Every contributed server, including those settings lists before they are ready and those of a plugin
     * that is down. A server leaves only when its ready plugin stops reporting it.
     */
    entries,
    entry: (key: string) => entries().find((item) => item.key === key),
  }
}

function connection(initial: PluginServer) {
  const [current, setCurrent] = createSignal(initial)
  const [machine, setMachine] = createSignal(createPluginServerState(snapshot(initial.entry)))
  const entry = () => current().entry
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: PluginServerEvent) => {
    const result = transitionPluginServer(untrack(machine), event)
    setMachine(result.state)

    result.effects.forEach((effect) => {
      if (effect.type === "timeout.cancel") return clearTimeout(timer)

      // Out of the update that reported the server ready: the callbacks navigate.
      if (effect.type === "notify.connected") return queueMicrotask(() => effect.callbacks.forEach((run) => run()))

      timer = setTimeout(() => dispatch({ type: "connect.timed-out", attempt: effect.attempt }), effect.timeoutMs)
      const settled = (ready: boolean) => dispatch({ type: "connect.settled", attempt: effect.attempt, ready })
      void Promise.try(() => untrack(entry).connect?.() ?? false).then(settled, () => settled(false))
    })
  }

  const value: ServerConnection.Plugin = {
    type: "plugin",
    key: initial.key,
    plugin: initial.plugin,
    get displayName() {
      return entry().name
    },
    get label() {
      return entry().label
    },
    get status() {
      return selectPluginStatus(machine())
    },
    get managed() {
      return !!entry().reconnect
    },
    // Resolved per call: the connection outlives a reload of the plugin that provides it.
    get reconnect() {
      if (!entry().reconnect) return undefined

      return (signal: AbortSignal) => {
        const status = selectPluginStatus(untrack(machine))

        return (
          entry().reconnect?.(signal) ??
          (status.type === "ready" ? Promise.resolve(status.http) : Promise.reject(new Error("Server is not ready")))
        )
      }
    },
    authenticate: (onConnected) => {
      if (!canAuthenticatePluginServer(untrack(machine))) return false
      dispatch({ type: "authenticate", onConnected })

      return true
    },
    connect: () => entry().connect?.() ?? Promise.resolve(entry().state === "ready"),
  }

  return {
    update: (server: PluginServer) =>
      batch(() => {
        setCurrent(server)
        dispatch({ type: "entry.updated", entry: snapshot(server.entry) })
      }),
    dispose: () => dispatch({ type: "disposed" }),
    value,
  }
}

function snapshot(entry: ServerEntry): PluginEntrySnapshot {
  return { state: entry.state, http: entry.http }
}

/** MenuItem "server.row" contributions that apply to a server. */
export function useServerRowItems(server: () => string) {
  const host = usePluginHost()

  return createMemo(() =>
    host
      .list(MenuItem)
      .flatMap((item) => (item.menu === "server.row" && (item.when?.(server()) ?? true) ? [item] : []))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  )
}

/** MenuItem "server.add" contributions, in order. */
export function useServerAddItems() {
  const host = usePluginHost()

  return createMemo(() =>
    host
      .list(MenuItem)
      .flatMap((item) => (item.menu === "server.add" ? [item] : []))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  )
}
