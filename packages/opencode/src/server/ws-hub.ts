/**
 * WsHub — shared in-process WebSocket connection registry
 * Implements the Effect reactive store for broadcasting state deltas (COB-38)
 */

import type { ServerWebSocket } from "bun"
import { Log } from "@/util/log"
import { encodeFrame } from "@/util/frame"

const log = Log.create({ service: "ws-hub" })

interface Conn {
  ws: ServerWebSocket<unknown>
}

const conns = new Set<Conn>()

export const WsHub = {
  add(conn: Conn): () => void {
    conns.add(conn)
    return () => conns.delete(conn)
  },
  broadcast(event: { type: string; properties: unknown }): void {
    const frame = encodeFrame(event)
    for (const conn of conns) {
      try {
        conn.ws.send(frame)
      } catch (err) {
        log.error("ws-hub send failed", { err })
      }
    }
  },
  get size(): number {
    return conns.size
  },
}
