import { createContext, createMemo, Show, useContext, type ParentProps } from "solid-js"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"

// Stories render without a connected server by default: no location has synced integrations or usage limits yet.
const fallbackData = {
  session: {
    get: () => undefined,
    list: () => [],
    form: {
      reply: async () => {},
      cancel: async () => {},
    },
  },
  location: {
    default: () => ({ directory: "/tmp/story" }),
    syncInfo: async () => {},
    agent: {
      list: () => undefined,
      sync: async () => {},
      invalidate: () => {},
    },
    provider: {
      list: () => undefined,
      sync: async () => {},
      invalidate: () => {},
    },
    model: {
      list: () => undefined,
      sync: async () => {},
      invalidate: () => {},
    },
    integration: {
      list: () => undefined,
      sync: async () => {},
      invalidate: () => {},
    },
    mcp: {
      server: {
        list: () => undefined,
        sync: async () => {},
      },
    },
    usage: {
      limits: () => undefined,
      sync: async () => {},
      invalidate: () => {},
    },
  },
}

type ActiveServerValue = {
  conn: ServerConnection.Any
  key: ServerConnection.Key
  isLocal: boolean
  ctx: ServerCtx
  readonly health: ReturnType<typeof useGlobal>["servers"]["health"][ServerConnection.Key]
}

const ServerContext = createContext<ActiveServerValue>()

export function useServer() {
  const active = useContext(ServerContext)

  if (active) return active

  return { ctx: { data: fallbackData } }
}

export function useData() {
  return useServer().ctx.data
}

export function ServerProvider(props: ParentProps<{ conn?: ServerConnection.Any }>) {
  if (!props.conn) return props.children
  const conn = props.conn

  const global = useGlobal()

  const key = ServerConnection.key(conn)

  const ctx = createMemo<ServerCtx>(
    (previous) => (global.servers.health[key]?.healthy ? global.serverCtx(key) : undefined) ?? previous,
    global.ensureServerCtx(conn),
  )

  return (
    <Show when={ctx()} keyed>
      {(resolved) => (
        <ServerContext.Provider
          value={{
            conn,
            key,
            isLocal: ServerConnection.local(conn),
            ctx: resolved,
            get health() {
              return global.servers.health[key]
            },
          }}
        >
          {props.children}
        </ServerContext.Provider>
      )}
    </Show>
  )
}
