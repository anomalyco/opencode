import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import type { Event } from "@/types"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { makeEventListener } from "@solid-primitives/event-listener"
import { type Accessor, batch, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createApiForServer, type ServerApi } from "@/utils/server"
import { usePlatform } from "./platform"
import { ServerConnection } from "./servers"
import { createRefCountMap } from "@/utils/refcount"
import { ServerScope } from "@/utils/server-scope"
import { useServer } from "./server"

export type ServerEvent = Event & { id?: string; current?: OpenCodeEvent }
type QueuedServerEvent = { directory: string; payload: ServerEvent }
type CurrentDelta = Extract<
  OpenCodeEvent,
  { type: "session.text.delta" | "session.reasoning.delta" | "session.tool.input.delta" | "session.compaction.delta" }
>

export function adaptServerEvent(event: OpenCodeEvent): ServerEvent {
  return { id: event.id, type: event.type, properties: event.data, current: event } as ServerEvent
}

export function enqueueServerEvent(queue: QueuedServerEvent[], event: QueuedServerEvent) {
  queue.push(event)
  return true
}

export function coalesceServerEvents(events: QueuedServerEvent[]) {
  const output: QueuedServerEvent[] = []
  events.forEach((event) => {
    const current = currentDelta(event.payload.current)
    if (current) {
      const previous = output[output.length - 1]
      const prior = currentDelta(previous?.payload.current)
      if (
        previous &&
        prior &&
        previous.directory === event.directory &&
        currentDeltaKey(prior) === currentDeltaKey(current)
      ) {
        const fragment = currentDeltaFragment(prior) + currentDeltaFragment(current)
        const data =
          current.type === "session.compaction.delta"
            ? { ...current.data, text: fragment }
            : { ...current.data, delta: fragment }
        output[output.length - 1] = {
          directory: event.directory,
          payload: {
            ...event.payload,
            properties: data,
            current: { ...current, data } as CurrentDelta,
          } as ServerEvent,
        }
        return
      }
      output.push(event)
      return
    }
    output.push(event)
  })
  return output
}

function currentDelta(event: OpenCodeEvent | undefined): CurrentDelta | undefined {
  if (
    event?.type === "session.text.delta" ||
    event?.type === "session.reasoning.delta" ||
    event?.type === "session.tool.input.delta" ||
    event?.type === "session.compaction.delta"
  )
    return event
}

function currentDeltaKey(event: CurrentDelta) {
  if (event.type === "session.tool.input.delta")
    return `${event.type}:${event.data.sessionID}:${event.data.assistantMessageID}:${event.data.id}`
  if (event.type === "session.compaction.delta") return `${event.type}:${event.data.sessionID}`
  return `${event.type}:${event.data.sessionID}:${event.data.assistantMessageID}:${event.data.ordinal}`
}

function currentDeltaFragment(event: CurrentDelta) {
  return event.type === "session.compaction.delta" ? event.data.text : event.data.delta
}

export function resumeStreamAfterPageShow(event: PageTransitionEvent, start: () => unknown) {
  if (!event.persisted) return
  start()
}

type ServerEventEmitter = ReturnType<typeof createGlobalEmitter<{ [key: string]: ServerEvent }>>
export type ServerConnectionStatus = "connecting" | "connected" | "reconnecting"
type ServerSDKBase = {
  server: ServerConnection.Any
  scope: ServerScope
  url: string
  api: ServerApi
  connection: {
    status: Accessor<ServerConnectionStatus>
    attempt: Accessor<number>
    error: Accessor<string | undefined>
  }
  event: {
    on: ServerEventEmitter["on"]
    listen: ServerEventEmitter["listen"]
  }
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope): ServerSDKBase {
  const platform = usePlatform()
  const abort = new AbortController()

  const eventFetch = (() => {
    if (!platform.fetch || !server) return
    try {
      const url = new URL(server.http.url)
      const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
      if (url.protocol === "http:" && !loopback) return platform.fetch
    } catch {
      return
    }
  })()

  const eventApi = createApiForServer({ server: server.http, fetch: eventFetch })
  const emitter = createGlobalEmitter<{
    [key: string]: ServerEvent
  }>()

  type Queued = QueuedServerEvent
  const FLUSH_FRAME_MS = 16
  const STREAM_YIELD_MS = 8
  const CONNECT_TIMEOUT_MS = 2_000
  const RECONNECT_DELAY_MS = 1_000

  let queue: Queued[] = []
  let buffer: Queued[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0

  function flush() {
    if (timer) clearTimeout(timer)
    timer = undefined

    if (queue.length === 0) return

    const events = queue
    queue = buffer
    buffer = events
    queue.length = 0

    last = Date.now()
    const output = coalesceServerEvents(events)
    batch(() => {
      output.forEach((event) => emitter.emit(event.directory, event.payload))
    })

    buffer.length = 0
  }

  function schedule() {
    if (timer) return
    const elapsed = Date.now() - last
    timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
  }

  function publish(event: OpenCodeEvent) {
    const directory = event.location?.directory ?? "global"
    if (enqueueServerEvent(queue, { directory, payload: adaptServerEvent(event) })) schedule()
  }

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
  let attempt: AbortController | undefined
  let run: Promise<void> | undefined
  let started = false
  let generation = 0
  const [connection, setConnection] = createStore<{
    status: ServerConnectionStatus
    attempt: number
    error?: string
  }>({ status: "connecting", attempt: 0 })

  async function connect(signal: AbortSignal): Promise<{ error: unknown; connectedAt: number | undefined }> {
    let connectedAt: number | undefined

    // Bound the initial handshake and tie this request to the stream lifetime.
    const request = new AbortController()
    const cancel = () => request.abort(signal.reason)
    const timeout = setTimeout(() => request.abort(new Error("Timed out connecting to server")), CONNECT_TIMEOUT_MS)
    signal.addEventListener("abort", cancel, { once: true })

    try {
      // Open the event stream and validate its initial handshake.
      const iterator = eventApi.event.subscribe({ signal: request.signal })[Symbol.asyncIterator]()
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
      publish(first.value)
      connectedAt = Date.now()
      setConnection({ status: "connected", attempt: 0, error: undefined })

      // Forward events until the stream closes or this connection is cancelled.
      let yielded = Date.now()
      while (!signal.aborted) {
        const event = await iterator.next()
        if (signal.aborted) return { error: undefined, connectedAt }
        if (event.done) return { error: new Error("Event stream disconnected"), connectedAt }
        publish(event.value)
        if (Date.now() - yielded < STREAM_YIELD_MS) continue
        yielded = Date.now()
        await wait(0, signal)
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

  async function runStream(active: number) {
    let retries = 0
    // oxlint-disable-next-line no-unmodified-loop-condition -- stop() changes the lifecycle flags and aborts the active request
    while (!abort.signal.aborted && started && generation === active) {
      setConnection({ status: retries === 0 ? "connecting" : "reconnecting", attempt: retries, error: undefined })
      const controller = new AbortController()
      attempt = controller
      const onAbort = () => controller.abort()
      abort.signal.addEventListener("abort", onAbort)
      const result = await connect(controller.signal)
      abort.signal.removeEventListener("abort", onAbort)

      if (abort.signal.aborted || !started || generation !== active) {
        if (attempt === controller) attempt = undefined
        return
      }
      if (result.connectedAt !== undefined && Date.now() - result.connectedAt >= 1_000) retries = 0
      retries += 1
      const message =
        result.error === undefined
          ? undefined
          : result.error instanceof Error
            ? result.error.message
            : String(result.error)
      console.info("[global-sdk] event stream disconnected", {
        url: server.http.url,
        fetch: eventFetch ? "platform" : "webview",
        attempt: retries,
        error: message,
      })
      setConnection({ status: "reconnecting", attempt: retries, error: message })
      await wait(RECONNECT_DELAY_MS, controller.signal)
      if (attempt === controller) attempt = undefined
    }
  }

  function start() {
    if (started) return run
    started = true
    const active = ++generation
    const previous = run
    const current = (async () => {
      if (previous) await previous
      await runStream(active)
    })().finally(() => {
      if (run !== current) return
      run = undefined
      flush()
    })
    run = current
    return run
  }

  function stop() {
    started = false
    generation++
    attempt?.abort()
  }

  onMount(() => {
    makeEventListener(window, "pagehide", stop)
    makeEventListener(window, "pageshow", (event) => resumeStreamAfterPageShow(event, start))
    void start()
  })

  onCleanup(() => {
    stop()
    abort.abort()
    if (timer) clearTimeout(timer)
    timer = undefined
    queue = []
    buffer = []
    emitter.clear()
  })

  const api = createApiForServer({ server: server.http, fetch: platform.fetch })

  return {
    server,
    scope,
    url: server.http.url,
    api,
    connection: {
      status: () => connection.status,
      attempt: () => connection.attempt,
      error: () => connection.error,
    },
    event: {
      on: emitter.on.bind(emitter),
      listen: emitter.listen.bind(emitter),
    },
  }
}

export type ServerSDK = ServerSDKBase & {
  ensureDirSdkContext: (directory: string) => ReturnType<typeof createDirSdkContext>
}

export function createServerSdkContext(server: ServerConnection.Any, scope: ServerScope): ServerSDK {
  const sdk = createServerSdkContextBase(server, scope)
  return Object.assign(sdk, {
    ensureDirSdkContext: createRefCountMap((dir) => createDirSdkContext(dir, sdk)),
  })
}

export const useServerSDK = () => {
  const server = useServer()
  return server.ctx.sdk
}

type SDKEventMap = {
  [key in Event["type"]]: Extract<ServerEvent, { type: key }>
}

export type DirectorySDK = {
  scope: ServerScope
  directory: string
  api: ServerApi
  event: ReturnType<typeof createGlobalEmitter<SDKEventMap>>
  readonly url: string
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase): DirectorySDK {
  const emitter = createGlobalEmitter<SDKEventMap>()

  const unsub = serverSDK.event.on(directory, (event) => {
    emitter.emit(event.type, event)
  })
  onCleanup(unsub)

  return {
    scope: serverSDK.scope,
    directory,
    api: serverSDK.api,
    event: emitter,
    get url() {
      return serverSDK.url
    },
  }
}
