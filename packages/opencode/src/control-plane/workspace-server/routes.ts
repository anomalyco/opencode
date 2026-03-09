import { GlobalBus } from "../../bus/global"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

export function WorkspaceServerRoutes() {
  return new Hono().get("/event", async (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")
    return streamSSE(c, async (stream) => {
      let done = false
      let resolveStream: (() => void) | undefined

      const cleanup = () => {
        if (done) return
        done = true
        clearInterval(heartbeat)
        GlobalBus.off("event", handler)
        resolveStream?.()
      }

      const send = async (event: unknown) => {
        try {
          await stream.writeSSE({
            data: JSON.stringify(event),
          })
        } catch {
          cleanup()
        }
      }
      const handler = async (event: { directory?: string; payload: unknown }) => {
        await send(event.payload)
      }
      GlobalBus.on("event", handler)
      await send({ type: "server.connected", properties: {} })
      const heartbeat = setInterval(() => {
        void send({ type: "server.heartbeat", properties: {} })
      }, 10_000)

      await new Promise<void>((resolve) => {
        resolveStream = resolve
        stream.onAbort(cleanup)
      })
    })
  })
}
