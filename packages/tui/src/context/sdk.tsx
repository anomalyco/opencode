import type { OpenCodeClient } from "@opencode-ai/client/promise"
import type { OpencodeClient, V2Event } from "@opencode-ai/sdk/v2"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export type SDKConnectionStatus = "connected" | "connecting"

type SDKEventMap = { [Type in V2Event["type"]]: Extract<V2Event, { type: Type }> }
const connectTimeout = 2_000

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    client: OpencodeClient
    api: OpenCodeClient
    discover?: () => Promise<{ client: OpencodeClient; api: OpenCodeClient }>
  }) => {
    const abort = new AbortController()
    let client = props.client
    let api = props.api
    const events = createGlobalEmitter<SDKEventMap>()
    const [connection, setConnection] = createStore<{
      status: SDKConnectionStatus
      attempt: number
      error?: string
      connectedOnce: boolean
    }>({
      status: "connecting",
      attempt: 0,
      connectedOnce: false,
    })
    let stream: AbortController | undefined

    function start() {
      stream?.abort()
      const controller = new AbortController()
      let connected!: () => void
      const ready = new Promise<void>((resolve) => {
        connected = resolve
      })
      stream = controller
      void (async () => {
        let attempt = 0
        while (!abort.signal.aborted && !controller.signal.aborted) {
          const connection = new AbortController()
          const cancel = () => connection.abort(controller.signal.reason)
          const timeout = setTimeout(
            () => connection.abort(new Error("Timed out connecting to server")),
            connectTimeout,
          )
          controller.signal.addEventListener("abort", cancel, { once: true })
          const error = await (async () => {
            const response = await client.v2.event.subscribe({
              signal: connection.signal,
              sseMaxRetryAttempts: 0,
              throwOnError: true,
            })
            const iterator = response.stream[Symbol.asyncIterator]()
            const first = await iterator.next()
            if (abort.signal.aborted || controller.signal.aborted) return
            if (first.done)
              return connection.signal.reason instanceof Error
                ? connection.signal.reason
                : new Error("Event stream disconnected")
            if (first.value.type !== "server.connected") return new Error("Event stream did not start with server.connected")
            clearTimeout(timeout)
            attempt = 0
            events.emit(first.value.type, first.value)
            setConnection({ status: "connected", attempt: 0, error: undefined, connectedOnce: true })
            connected()
            while (!abort.signal.aborted && !controller.signal.aborted) {
              const event = await iterator.next()
              if (abort.signal.aborted || controller.signal.aborted) return
              if (event.done) return new Error("Event stream disconnected")
              events.emit(event.value.type, event.value)
            }
          })()
            .catch((error) => error)
            .finally(() => {
              clearTimeout(timeout)
              controller.signal.removeEventListener("abort", cancel)
            })
          if (abort.signal.aborted || controller.signal.aborted) return
          attempt += 1
          // Re-resolve the transport before retrying: the server may have
          // moved (service restarted on a new port) or need starting. Static
          // transports (--server, standalone) resolve to the same address.
          if (props.discover) {
            const next = await props.discover().catch(() => undefined)
            if (abort.signal.aborted || controller.signal.aborted) return
            if (next) {
              client = next.client
              api = next.api
            }
          }
          setConnection({
            status: "connecting",
            attempt,
            error: error instanceof Error ? error.message : String(error),
          })
          await wait(250, controller.signal)
        }
      })()
      return ready
    }

    onMount(() => void start())
    onCleanup(() => {
      abort.abort()
      stream?.abort()
      events.clear()
    })

    return {
      get client() {
        return client
      },
      get api() {
        return api
      },
      event: {
        on: events.on,
        listen: events.listen,
      },
      connection: {
        status() {
          return connection.status
        },
        attempt() {
          return connection.attempt
        },
        error() {
          return connection.error
        },
        connectedOnce() {
          return connection.connectedOnce
        },
      },
    }
  },
})

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}
