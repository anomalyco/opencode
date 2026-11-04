import { Show, type ParentProps } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { ServerConnection } from "./registry"
import { useGlobal, type ServerCtx } from "./runtime"

const context = createSimpleContext({
  name: "Server",
  init: (props: { conn: ServerConnection.Any; ctx: ServerCtx }) => {
    const conn = props.conn
    const key = ServerConnection.key(conn)

    const global = useGlobal()

    return {
      conn,
      key,
      get isLocal() {
        return props.ctx.isLocal
      },
      ctx: props.ctx,
      get health() {
        return global.servers.health[key]
      },
    }
  },
})

export const useServer = context.use

// Keyed by controller: children unmount while the server rejects our credentials, and remount with the controller its
// new credentials start.
export function ServerProvider(props: ParentProps<{ conn: ServerConnection.Any }>) {
  const global = useGlobal()

  return (
    <Show when={global.serverCtx(ServerConnection.key(props.conn))} keyed>
      {(ctx) => (
        <context.provider conn={props.conn} ctx={ctx}>
          {props.children}
        </context.provider>
      )}
    </Show>
  )
}

export const useData = () => {
  const server = useServer()

  return server.ctx.data
}
