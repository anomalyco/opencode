import { createSimpleContext } from "@opencode-ai/ui/context"
import { ServerConnection } from "./servers"
import { useGlobal } from "./global"

// Must be keyed for now
export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: { conn: ServerConnection.Any }) => {
    const conn = props.conn
    const key = ServerConnection.key(conn)

    const global = useGlobal()

    return {
      conn,
      key,
      isLocal: ServerConnection.local(props.conn),
      ctx: global.ensureServerCtx(conn),
      get health() {
        return global.servers.health[key]
      },
    }
  },
})
