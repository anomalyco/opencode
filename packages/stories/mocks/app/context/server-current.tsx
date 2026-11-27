import { createContext, useContext, type ParentProps } from "solid-js"
import { ServerConnection } from "@/runtime/server/registry"
import type { ServerCtx, useGlobal } from "@/runtime/server/runtime"

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

const fallbackHandoff = {
  get: () => undefined,
  held: () => false,
  forSession: () => ({ set() {}, hold() {}, settle() {}, clear() {} }),
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

  return { ctx: { data: fallbackData, handoff: fallbackHandoff } }
}

export function useData() {
  return useServer().ctx.data
}

// The real `ServerProvider` in `@/runtime/server/runtime` resolves the controller and provides it through this.
export function ServerContextProvider(
  props: ParentProps<{ conn: ServerConnection.Any; ctx: ServerCtx; health: ActiveServerValue["health"] }>,
) {
  const conn = props.conn
  const key = ServerConnection.key(conn)

  return (
    <ServerContext.Provider
      value={{
        conn,
        key,
        isLocal: ServerConnection.local(conn),
        ctx: props.ctx,
        get health() {
          return props.health
        },
      }}
    >
      {props.children}
    </ServerContext.Provider>
  )
}
