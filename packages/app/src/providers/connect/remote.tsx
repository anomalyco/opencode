import { ServerConnection, serverName } from "@/runtime/server/registry"

export function authServerName(server: ServerConnection.Any) {
  if (ServerConnection.builtin(server)) return undefined

  if (server.type === "http" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(server.http.url).hostname))
    return undefined

  return serverName(server)
}
