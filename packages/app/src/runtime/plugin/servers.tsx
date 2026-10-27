import { createContext, createEffect, createMemo, createSignal, useContext, type ParentProps } from "solid-js"
import { reconcile } from "solid-js/store"
import { Schema } from "effect"
import { MenuItem, Server, type ServerEntry } from "@opencode/plugin/gui"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import type { ServerConnection } from "@/runtime/server/registry"
import { usePluginHost } from "./host"
import { renamedFrom } from "./stores"

/** A server a plugin contributes. `key` is `${plugin}:${entry.id}`. */
export type PluginServer = { readonly key: string; readonly plugin: string; readonly entry: ServerEntry }

// Endpoint of a contributed server before its plugin reports one.
const offline = { url: "http://127.0.0.1:0" }

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

/** Collects Server contributions. `failed` reports plugins whose main entry failed, so startup stops waiting for them. */
export function PluginServersProvider(props: ParentProps<{ failed: (plugin: string) => boolean }>) {
  return <ServersContext.Provider value={createPluginServers(props.failed)}>{props.children}</ServersContext.Provider>
}

function createPluginServers(failed: (plugin: string) => boolean) {
  const host = usePluginHost()

  const [known, setKnown, , knownReady] = persisted(
    { ...Persist.global("plugin.servers"), copyFrom: [renamedFrom(Persist.global("extension.servers"))] },
    Inventories,
    {},
  )

  const sources = createMemo(() => host.items(Server).toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0)))
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
  const connections = new Map<string, { update: (server: PluginServer) => void; value: ServerConnection.Plugin }>()

  const list = createMemo(() => {
    const listed = entries().filter((item) => item.entry.listed !== false)
    const keys = new Set(listed.map((item) => item.key))
    connections.forEach((_, key) => {
      if (!keys.has(key)) connections.delete(key)
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

  // Startup waits for every source once; a source that reloads later does not hide the app again.
  const ready = createMemo<boolean>(
    (previous) =>
      previous || (knownReady() && host.ready() && sources().every((item) => item.value.ready || failed(item.plugin))),
    false,
  )

  return {
    ready,
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
  const entry = () => current().entry

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
    get state() {
      return entry().state
    },
    get connecting() {
      return entry().state === "starting"
    },
    get authenticationRequired() {
      return entry().state === "auth"
    },
    get managed() {
      return !!entry().reconnect
    },
    get http() {
      return entry().http ?? offline
    },
    // Resolved per call: the connection outlives a reload of the plugin that provides it.
    get reconnect() {
      if (!entry().reconnect) return undefined

      return (signal: AbortSignal) => entry().reconnect?.(signal) ?? Promise.resolve(entry().http ?? offline)
    },
    connect: () => entry().connect?.() ?? Promise.resolve(entry().state === "ready"),
  }

  return { update: (server: PluginServer) => setCurrent(server), value }
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
