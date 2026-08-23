import { createEffect, type Accessor } from "solid-js"
import type { ServerConnectionStatus } from "../client"

export function createConnectionSync(input: {
  status: Accessor<ServerConnectionStatus>
  invalidate: () => void
  connected: (info: { reconnect: boolean }) => void
}) {
  createEffect(() => {
    if (input.status() === "connected") return
    input.invalidate()
  })

  let connectedOnce = false
  function handleEvent(event: { type: string }) {
    if (event.type !== "server.connected") return
    input.connected({ reconnect: connectedOnce })
    connectedOnce = true
  }

  return { handleEvent }
}
