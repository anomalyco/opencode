import { createSimpleContext } from "@opencode/ui/context"
import { ServerConnection } from "./registry"
import type { ServerHealth } from "./health-machine"
import type { ServerCtx } from "./runtime"

// Takes the server's health as a prop rather than reading `useGlobal`, so this module doesn't import `./runtime`,
// which imports modules that call `useServer`. `ServerProvider` in `./runtime` provides it.
const context = createSimpleContext({
  name: "Server",
  init: (props: { conn: ServerConnection.Any; ctx: ServerCtx; health: ServerHealth | undefined }) => {
    const conn = props.conn
    const key = ServerConnection.key(conn)

    return {
      conn,
      key,
      get isLocal() {
        return props.ctx.isLocal
      },
      ctx: props.ctx,
      get health() {
        return props.health
      },
    }
  },
})

export const useServer = context.use

export const ServerContextProvider = context.provider

export const useData = () => {
  const server = useServer()

  return server.ctx.data
}
