import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { errorMessage } from "../util/error"
import { createSimpleContext } from "./helper"
import { useLog } from "./log"

export type ClientConnectionStatus = "connected" | "connecting" | "reconnecting"
export type ClientConnectionEvent = {
  readonly type: "client.connection"
  readonly created: number
  readonly data: {
    readonly status: "connecting" | "connected" | "disconnected" | "reconnecting"
    readonly attempt: number
    readonly error?: string
  }
}

type ManagedService = {
  reconnect: (signal: AbortSignal) => Promise<{ api: OpenCodeClient }>
  restart: () => Promise<void>
}

type ClientEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }
const connectTimeout = 2_000
const connectionHistoryLimit = 50

export const { use: useClient, provider: ClientProvider } = createSimpleContext({
  name: "Client",
  init: (props: { api: OpenCodeClient; service?: ManagedService }) => {
    const log = useLog({ component: "client" })
    const abort = new AbortController()
    const history: ClientConnectionEvent[] = []
    let api = props.api
    const events = createGlobalEmitter<ClientEventMap>()
    const [connection, setConnection] = createStore<{
      status: ClientConnectionStatus
      attempt: number
      error?: string
    }>({
      status: "connecting",
      attempt: 0,
    })
    let stream: AbortController | undefined

    function record(status: ClientConnectionEvent["data"]["status"], attempt: number, error?: string) {
      history.push({ type: "client.connection", created: Date.now(), data: { status, attempt, error } })
      if (history.length > connectionHistoryLimit) history.shift()
    }

    async function connect(signal: AbortSignal, attempt: number) {
      let connectedAt: number | undefined

      // Bound the initial handshake and tie this request to the stream lifetime.
      const request = new AbortController()
      const cancel = () => request.abort(signal.reason)
      const timeout = setTimeout(() => request.abort(new Error("Timed out connecting to server")), connectTimeout)
      signal.addEventListener("abort", cancel, { once: true })

      try {
        // Open the event stream and validate its initial handshake.
        record(attempt === 0 ? "connecting" : "reconnecting", attempt)
        log.info("event stream connecting", { attempt })

        const iterator = api.event.subscribe({ signal: request.signal })[Symbol.asyncIterator]()
        const first = await iterator.next()

        if (signal.aborted) return { error: undefined, connectedAt }
        if (first.done) {
          const error =
            request.signal.reason instanceof Error ? request.signal.reason : new Error("Event stream disconnected")
          return { error, connectedAt }
        }
        if (first.value.type !== "server.connected")
          return { error: new Error("Event stream did not start with server.connected"), connectedAt }

        // Publish the connected state before forwarding live events.
        clearTimeout(timeout)
        record("connected", attempt)
        connectedAt = Date.now()
        log.info("event stream connected")
        events.emit(first.value.type, first.value)
        setConnection({ status: "connected", attempt: 0, error: undefined })

        // Forward events until the stream closes or this connection is cancelled.
        while (!signal.aborted) {
          const event = await iterator.next()

          if (signal.aborted) return { error: undefined, connectedAt }
          if (event.done) return { error: new Error("Event stream disconnected"), connectedAt }

          if ("durable" in event.value)
            log.debug("event", {
              type: event.value.type,
              aggregateID: event.value.durable.aggregateID,
              seq: event.value.durable.seq,
            })

          events.emit(event.value.type, event.value)
        }

        return { error: undefined, connectedAt }
      } catch (error) {
        return { error, connectedAt }
      } finally {
        request.abort()
        clearTimeout(timeout)
        signal.removeEventListener("abort", cancel)
      }
    }

    function start() {
      stream?.abort()
      const controller = new AbortController()
      stream = controller
      void (async () => {
        let attempt = 0
        while (!abort.signal.aborted && !controller.signal.aborted) {
          const result = await connect(controller.signal, attempt)
          if (abort.signal.aborted || controller.signal.aborted) return
          if (result.connectedAt !== undefined && Date.now() - result.connectedAt >= 1_000) attempt = 0
          attempt += 1
          const message = errorMessage(result.error)
          record("disconnected", attempt, message)
          log.info("event stream disconnected", {
            attempt,
            error: message,
          })
          setConnection({ status: "reconnecting", attempt, error: message })
          // Re-resolve the transport before retrying: the server may have
          // moved (service restarted on a new port) or need starting. Static
          // transports (--server, standalone) resolve to the same address.
          if (props.service) {
            const next = await props.service.reconnect(controller.signal).catch((error) => {
              if (!controller.signal.aborted)
                log.info("server resolution failed", {
                  attempt,
                  error: errorMessage(error),
                })
            })
            if (abort.signal.aborted || controller.signal.aborted) return
            if (next) {
              api = next.api
              if (attempt === 1) continue
            }
          }
          await wait(1_000, controller.signal)
        }
      })()
    }

    onMount(start)
    onCleanup(() => {
      abort.abort()
      stream?.abort()
      events.clear()
    })

    return {
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
        internal: {
          history() {
            return history.slice()
          },
        },
      },
      restart: props.service?.restart,
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
