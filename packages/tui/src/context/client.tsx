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

export type EventInterest = {
  readonly location?: {
    readonly directory: string
    readonly workspace?: string
  }
  readonly sessions?: ReadonlyArray<string>
}

type ClientEventMap = { [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }
const connectTimeout = 2_000
const connectionHistoryLimit = 50

function interestEqual(left?: EventInterest, right?: EventInterest) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.location?.directory !== right.location?.directory) return false
  if (left.location?.workspace !== right.location?.workspace) return false
  const a = left.sessions ?? []
  const b = right.sessions ?? []
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function subscribeInput(interest?: EventInterest) {
  if (!interest) return undefined
  return {
    ...(interest.location ? { location: interest.location } : {}),
    ...(interest.sessions && interest.sessions.length > 0 ? { session: [...interest.sessions] } : {}),
  }
}

export const { use: useClient, provider: ClientProvider } = createSimpleContext({
  name: "Client",
  init: (props: { api: OpenCodeClient; service?: ManagedService; interest?: EventInterest }) => {
    const log = useLog({ component: "client" })
    const abort = new AbortController()
    const history: ClientConnectionEvent[] = []
    let api = props.api
    let interest = props.interest
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

    function start() {
      stream?.abort()
      const controller = new AbortController()
      stream = controller
      void (async () => {
        let attempt = 0
        while (!abort.signal.aborted && !controller.signal.aborted) {
          let connectedAt: number | undefined
          const request = new AbortController()
          const cancel = () => request.abort(controller.signal.reason)
          const timeout = setTimeout(() => request.abort(new Error("Timed out connecting to server")), connectTimeout)
          controller.signal.addEventListener("abort", cancel, { once: true })
          const error = await (async () => {
            record(attempt === 0 ? "connecting" : "reconnecting", attempt)
            log.info("event stream connecting", { attempt })
            const iterator = api.event
              .subscribe(subscribeInput(interest), { signal: request.signal })
              [Symbol.asyncIterator]()
            const first = await iterator.next()
            if (abort.signal.aborted || controller.signal.aborted) return undefined
            if (first.done)
              return request.signal.reason instanceof Error
                ? request.signal.reason
                : new Error("Event stream disconnected")
            if (first.value.type !== "server.connected")
              return new Error("Event stream did not start with server.connected")
            clearTimeout(timeout)
            record("connected", attempt)
            connectedAt = Date.now()
            log.info("event stream connected")
            events.emit(first.value.type, first.value)
            setConnection({ status: "connected", attempt: 0, error: undefined })
            while (!abort.signal.aborted && !controller.signal.aborted) {
              const event = await iterator.next()
              if (abort.signal.aborted || controller.signal.aborted) return undefined
              if (event.done) return new Error("Event stream disconnected")
              if ("durable" in event.value)
                log.debug("event", {
                  type: event.value.type,
                  aggregateID: event.value.durable.aggregateID,
                  seq: event.value.durable.seq,
                })
              events.emit(event.value.type, event.value)
            }
            return undefined
          })()
            .catch((error) => error)
            .finally(() => {
              request.abort()
              clearTimeout(timeout)
              controller.signal.removeEventListener("abort", cancel)
            })
          if (abort.signal.aborted || controller.signal.aborted) return
          if (connectedAt !== undefined && Date.now() - connectedAt >= 1_000) attempt = 0
          attempt += 1
          const message = errorMessage(error)
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
        scope(next: EventInterest) {
          if (interestEqual(interest, next)) return
          interest = next
          start()
        },
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
