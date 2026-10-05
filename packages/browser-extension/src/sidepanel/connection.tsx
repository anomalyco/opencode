// The opencode client, live event stream, and data store for one server URL and password.
import { OpenCode, type OpenCodeEvent } from "@opencode/client/promise"
import { createClientConnection, createData } from "@opencode/client/solid"
import { createContext, createEffect, onCleanup, useContext, type ParentProps } from "solid-js"
import type { ServiceInfo } from "../shared/protocol"
import type { Background } from "./port"
import { toastError } from "./format"

type EventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }

function createServer(info: ServiceInfo, background: Background) {
  const api = OpenCode.make({
    baseUrl: info.url,
    headers: { Authorization: `Basic ${btoa(`opencode:${info.password}`)}` },
  })
  const typed = new Map<string, Set<(event: OpenCodeEvent) => void>>()
  const all = new Set<(event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void>()
  onCleanup(() => {
    typed.clear()
    all.clear()
  })
  const event = {
    on<Type extends OpenCodeEvent["type"]>(type: Type, handler: (event: EventMap[Type]) => void) {
      const set = typed.get(type) ?? new Set()
      typed.set(type, set)
      const listener = handler as (event: OpenCodeEvent) => void
      set.add(listener)
      return () => void set.delete(listener)
    },
    listen(handler: (event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void) {
      all.add(handler)
      return () => void all.delete(handler)
    },
  }
  const connection = createClientConnection(api, {
    flushInterval: 16,
    pageLifecycle: true,
    onEvent(details) {
      typed.get(details.type)?.forEach((handler) => handler(details))
      all.forEach((handler) => handler({ name: details.type, details }))
    },
  })
  const data = createData({
    api: () => api,
    directory: "",
    event,
    connection,
    onError: toastError("Couldn't refresh opencode data"),
  })

  // Remote reads: the server's own directory is where a new conversation starts, and the project list
  // fills the directory picker.
  createEffect(() => {
    if (connection.status() !== "connected") return
    void data.location.syncInfo().catch(toastError("Couldn't load the home directory"))
    void data.project.sync().catch(toastError("Couldn't load projects"))
  })

  return { api, data, connection, info, background }
}

export type Server = ReturnType<typeof createServer>

const ServerContext = createContext<Server>()

export function ServerProvider(props: ParentProps<{ info: ServiceInfo; background: Background }>) {
  // Keyed by URL and password above, so the props are fixed for this provider's lifetime.
  const server = createServer(props.info, props.background)
  return <ServerContext.Provider value={server}>{props.children}</ServerContext.Provider>
}

export function useServer() {
  const server = useContext(ServerContext)
  if (!server) throw new Error("useServer must be used within ServerProvider")
  return server
}
