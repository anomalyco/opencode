import { useSshServers } from "./context"
import { useSshReconnect } from "./reconnect"
import type { ServerConnection } from "@/runtime/server/registry"

export function useSshAuthenticate() {
  const ssh = useSshServers()
  const reconnect = useSshReconnect()
  return (server: ServerConnection.Any, onConnected?: () => void) => {
    if (server.type !== "ssh" || !server.authenticationRequired) return false
    const item = ssh.data?.servers.find((item) => item.config.id === server.id)
    if (!item) return false
    reconnect.start(item.config, onConnected)
    return true
  }
}
