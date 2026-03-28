import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import type { ServerWebSocket } from "bun"
import { Log } from "@/util/log"
import { WsHub } from "../ws-hub"
import { encodeFrame } from "@/util/frame"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "ws-event" })

/**
 * WebSocket binary diff stream — COB-38
 *
 * Wire format: COB-37 §3 binary frame protocol
 *   [1] version=0x01 | [1] flags=0x00 | [2] type_len LE | [type_len] UTF-8 type | [rest] msgpack props
 *
 * Each message is a state delta — never a full snapshot (zero-bloat).
 * Feature flag: OPENCODE_WS_SYNC=1
 */

export const WsEventRoutes = lazy(() =>
  new Hono().get(
    "/ws-event",
    upgradeWebSocket((_c) => {
      let remove: (() => void) | undefined

      return {
        onOpen(_event, socket) {
          const raw = socket.raw as ServerWebSocket<unknown>
          remove = WsHub.add({ ws: raw })
          log.info("ws-event connected", { total: WsHub.size })

          // Send connected handshake
          raw.send(encodeFrame({ type: "server.connected", properties: { created: Date.now() } }))
        },

        onClose() {
          log.info("ws-event disconnected")
          remove?.()
          remove = undefined
        },

        onError(_event, socket) {
          log.error("ws-event error")
          remove?.()
          remove = undefined
          try { socket.close() } catch {}
        },
      }
    }),
  ),
)
