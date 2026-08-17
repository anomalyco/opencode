import { Buffer } from "node:buffer"
import { Effect } from "effect"

interface ConnectionData {
  readonly id: number
}

export interface WebSocketServerState {
  readonly headers: Array<Record<string, string>>
  readonly messages: string[]
  opens: number
  closes: number
  pongs: number
}

export interface WebSocketServerFixture {
  readonly url: string
  readonly state: WebSocketServerState
}

export interface WebSocketServerOptions {
  readonly upgrade?: (request: Request) => boolean
  readonly open?: (socket: Bun.ServerWebSocket<ConnectionData>) => void
  readonly message?: (socket: Bun.ServerWebSocket<ConnectionData>, message: string | Buffer) => void
}

export const makeWebSocketServer = (options: WebSocketServerOptions = {}) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state: WebSocketServerState = { headers: [], messages: [], opens: 0, closes: 0, pongs: 0 }
      let connection = 0
      const server = Bun.serve<ConnectionData>({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request, server) {
          state.headers.push(Object.fromEntries(request.headers.entries()))
          if ((options.upgrade?.(request) ?? true) && server.upgrade(request, { data: { id: connection++ } }))
            return undefined
          return new Response("WebSocket upgrade required", {
            status: 426,
            headers: { "x-upgrade-rejected": "true" },
          })
        },
        websocket: {
          open(socket) {
            state.opens++
            options.open?.(socket)
          },
          message(socket, message) {
            const text = typeof message === "string" ? message : message.toString()
            state.messages.push(text)
            options.message?.(socket, message)
          },
          close() {
            state.closes++
          },
          pong() {
            state.pongs++
          },
        },
      })
      return {
        server,
        fixture: {
          url: `${server.url.toString().replace(/^http/, "ws")}responses`,
          state,
        } satisfies WebSocketServerFixture,
      }
    }),
    ({ server }) => Effect.promise(() => server.stop(true)),
  ).pipe(Effect.map((item) => item.fixture))
