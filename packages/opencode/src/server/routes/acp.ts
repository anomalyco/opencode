import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ACP } from "@/acp/agent"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Log } from "@/util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "acp-websocket" })

function websocketStream(ws: { send: (data: string | ArrayBuffer | Uint8Array) => void }) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      ;(ws.send as (d: Uint8Array) => void)(chunk)
    },
  })

  return {
    stream: ndJsonStream(writable, readable),
    enqueue(data: string | ArrayBuffer | Buffer) {
      const bytes =
        typeof data === "string"
          ? new TextEncoder().encode(data)
          : new Uint8Array(data as ArrayBuffer)
      controller?.enqueue(bytes)
    },
    close() {
      controller?.close()
    },
    error(err: unknown) {
      controller?.error(err)
    },
  }
}

export const AcpRoutes = lazy(() =>
  new Hono().get(
    "/",
    upgradeWebSocket((c) => {
      const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
      const directory = (() => {
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      })()

      let enqueue: ((data: string | ArrayBuffer | Buffer) => void) | undefined
      let closeStream: (() => void) | undefined
      let errorStream: ((err: unknown) => void) | undefined

      return {
        onOpen(_event, ws) {
          process.env.OPENCODE_CLIENT = "acp"
          const { stream, enqueue: eq, close: cl, error: err } = websocketStream(
            ws as { send: (data: string | ArrayBuffer | Uint8Array) => void },
          )
          enqueue = eq
          closeStream = cl
          errorStream = err

          Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              const baseUrl = new URL(c.req.url).origin
              const sdk = createOpencodeClient({ baseUrl })
              const agent = await ACP.init({ sdk })

              new AgentSideConnection((conn) => {
                return agent.create(conn, { sdk })
              }, stream)

              log.info("acp websocket connected", { directory })
            },
          }).catch((err) => {
            log.error("acp websocket setup failed", { error: err, directory })
            errorStream?.(err)
            ws.close()
          })
        },
        onMessage(evt) {
          const data = evt.data
          if (data instanceof Blob) {
            data.arrayBuffer().then((buf) => enqueue?.(buf))
          } else {
            enqueue?.(data as string | ArrayBuffer | Buffer)
          }
        },
        onClose() {
          closeStream?.()
        },
      }
    }),
  ),
)
