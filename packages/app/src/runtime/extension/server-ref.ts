import type { ServerRef } from "@opencode/gui-extensions/sdk"
import { useServer } from "@/runtime/server/current"
import { ServerConnection, serverName } from "@/runtime/server/registry"

/** The route's server as extensions see it: each read follows the route's live server controller. */
export function createRouteServerRef() {
  const server = useServer()

  const ref: ServerRef = {
    get id() {
      return server.key
    },
    get name() {
      return serverName(server.conn) || server.key
    },
    get url() {
      return server.ctx.sdk.url
    },
    get password() {
      return server.conn.http.password
    },
    get client() {
      return server.ctx.sdk.api
    },
    get data() {
      return server.ctx.data
    },
    get local() {
      return server.isLocal
    },
    get builtin() {
      return ServerConnection.builtin(server.conn)
    },
    get compatible() {
      return !server.health?.incompatible
    },
    get connected() {
      return server.ctx.sdk.connection.status() === "connected"
    },
  }

  return ref
}
