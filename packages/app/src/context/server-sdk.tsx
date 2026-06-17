import type { Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { makeEventListener } from "@solid-primitives/event-listener"
import { type Accessor, batch, createMemo, onCleanup, onMount } from "solid-js"
import { createSdkForServer } from "@/utils/server"
import { useLanguage } from "./language"
import { usePlatform } from "./platform"
import { ServerConnection, useServer } from "./server"
import { createRefCountMap } from "@/utils/refcount"
import { useGlobal } from "./global"
import { ServerScope } from "@/utils/server-scope"

const isAbortError = (error: unknown) =>
  error !== null && typeof error === "object" && "name" in error && error.name === "AbortError"

const isStreamClosed = (error: unknown, signal?: AbortSignal) => isAbortError(error) || signal?.aborted === true
type QueuedServerEvent = { directory: string; payload: Event }

const deltaKey = (directory: string, messageID: string, partID: string) => `${directory}:${messageID}:${partID}`

export function coalesceServerEvents(events: QueuedServerEvent[], stale?: Set<string>) {
  const output: QueuedServerEvent[] = []
  const deltas = new Map<string, number>()
  events.forEach((event) => {
    if (stale && event.payload.type === "message.part.delta") {
      const props = event.payload.properties
      if (stale.has(deltaKey(event.directory, props.messageID, props.partID))) return
    }
    if (event.payload.type !== "message.part.delta") {
      deltas.clear()
      output.push(event)
      return
    }
    const props = event.payload.properties
    const id = `${deltaKey(event.directory, props.messageID, props.partID)}:${props.field}`
    const index = deltas.get(id)
    const existing = index === undefined ? undefined : output[index]
    if (!existing || existing.payload.type !== "message.part.delta") {
      deltas.set(id, output.length)
      output.push({
        directory: event.directory,
        payload: { ...event.payload, properties: { ...props } },
      })
      return
    }
    existing.payload.properties.delta += props.delta
  })
  return output
}

export function resumeStreamAfterPageShow(event: PageTransitionEvent, start: () => unknown) {
  if (!event.persisted) return
  start()
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope) {
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

  const eventSdk = createSdkForServer({
    signal: abort.signal,
    fetch: eventFetch,
    server: server.http,
  })
  const emitter = createGlobalEmitter<{
    [key: string]: Event
  }>()

  type Queued = QueuedServerEvent
  const FLUSH_FRAME_MS = 16
  const STREAM_YIELD_MS = 8
  const RECONNECT_DELAY_MS = 250

  let queue: Queued[] = []
  let buffer: Queued[] = []
  const coalesced = new Map<string, number>()
  const staleDeltas = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0

  const key = (directory: string, payload: Event) => {
    if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`
    if (payload.type === "lsp.updated") return `lsp.updated:${directory}`
    if (payload.type === "message.part.updated") {
      const part = payload.properties.part
      return `message.part.updated:${directory}:${part.messageID}:${part.id}`
    }
  }

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined

    if (queue.length === 0) return

    const events = queue
    const skip = staleDeltas.size > 0 ? new Set(staleDeltas) : undefined
    queue = buffer
    buffer = events
    queue.length = 0
    coalesced.clear()
    staleDeltas.clear()

    last = Date.now()
    const output = coalesceServerEvents(events, skip)
    batch(() => {
      output.forEach((event) => emitter.emit(event.directory, event.payload))
    })

    buffer.length = 0
  }

  const schedule = () => {
    if (timer) return
    const elapsed = Date.now() - last
    timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
  }

  let streamErrorLogged = false
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  let attempt: AbortController | undefined
  let run: Promise<void> | undefined
  let started = false
  let generation = 0
  const HEARTBEAT_TIMEOUT_MS = 15_000
  let lastEventAt = Date.now()
  let heartbeat: ReturnType<typeof setTimeout> | undefined
  const resetHeartbeat = () => {
    lastEventAt = Date.now()
    if (heartbeat) clearTimeout(heartbeat)
    heartbeat = setTimeout(() => {
      attempt?.abort()
    }, HEARTBEAT_TIMEOUT_MS)
  }
  const clearHeartbeat = () => {
    if (!heartbeat) return
    clearTimeout(heartbeat)
    heartbeat = undefined
  }

  const start = () => {
    if (started) return run
    started = true
    const active = ++generation
    const previous = run
    const current = (async () => {
      if (previous) await previous
      // oxlint-disable-next-line no-unmodified-loop-condition -- `started` is set to false by stop() which also aborts; both flags are checked to allow graceful exit
      while (!abort.signal.aborted && started && generation === active) {
        attempt = new AbortController()
        lastEventAt = Date.now()
        const onAbort = () => {
          attempt?.abort()
        }
        abort.signal.addEventListener("abort", onAbort)
        try {
          const events = await eventSdk.global.event({
            signal: attempt.signal,
            onSseError: (error) => {
              if (isStreamClosed(error, attempt?.signal)) return
              if (streamErrorLogged) return
              streamErrorLogged = true
              console.error("[global-sdk] event stream error", {
                url: server.http.url,
                fetch: eventFetch ? "platform" : "webview",
                error,
              })
            },
          })
          let yielded = Date.now()
          resetHeartbeat()
          for await (const event of events.stream) {
            resetHeartbeat()
            streamErrorLogged = false
            const directory = event.directory ?? "global"
            if (event.payload.type === "sync") {
              continue
            }

            const payload = event.payload as Event

            const k = key(directory, payload)
            if (k) {
              const i = coalesced.get(k)
              if (i !== undefined) {
                queue[i] = { directory, payload }
                if (payload.type === "message.part.updated") {
                  const part = payload.properties.part
                  staleDeltas.add(deltaKey(directory, part.messageID, part.id))
                }
                continue
              }
              coalesced.set(k, queue.length)
            }
            queue.push({ directory, payload })
            schedule()

            if (Date.now() - yielded < STREAM_YIELD_MS) continue
            yielded = Date.now()
            await wait(0)
          }
        } catch (error) {
          if (!isStreamClosed(error, attempt?.signal) && !streamErrorLogged) {
            streamErrorLogged = true
            console.error("[global-sdk] event stream failed", {
              url: server.http.url,
              fetch: eventFetch ? "platform" : "webview",
              error,
            })
          }
        } finally {
          abort.signal.removeEventListener("abort", onAbort)
          attempt = undefined
          clearHeartbeat()
        }

        if (abort.signal.aborted || !started || generation !== active) return
        await wait(RECONNECT_DELAY_MS)
      }
    })().finally(() => {
      if (run !== current) return
      run = undefined
      flush()
    })
    run = current
    return run
  }

  const stop = () => {
    started = false
    generation++
    attempt?.abort()
    clearHeartbeat()
  }

  onMount(() => {
    makeEventListener(window, "pagehide", stop)
    makeEventListener(window, "pageshow", (event) => resumeStreamAfterPageShow(event, start))
    makeEventListener(document, "visibilitychange", () => {
      if (document.visibilityState !== "visible") return
      if (!started) return
      if (Date.now() - lastEventAt < HEARTBEAT_TIMEOUT_MS) return
      attempt?.abort()
    })
  })

  onCleanup(() => {
    stop()
    abort.abort()
    flush()
  })

  const sdk = createSdkForServer({
    server: server.http,
    fetch: platform.fetch,
    throwOnError: true,
  })

  return {
    scope,
    url: server.http.url,
    client: sdk,
    event: {
      on: emitter.on.bind(emitter),
      listen: emitter.listen.bind(emitter),
      start,
    },
    createClient(opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">) {
      return createSdkForServer({
        server: server.http,
        fetch: platform.fetch,
        ...opts,
      })
    },
  }
}

type ServerSDKBase = ReturnType<typeof createServerSdkContextBase>
export type ServerSDK = ServerSDKBase & {
  createDirSdkContext: (directory: string) => ReturnType<typeof createDirSdkContext>
}

export function createServerSdkContext(server: ServerConnection.Any, scope: ServerScope): ServerSDK {
  const sdk = createServerSdkContextBase(server, scope)
  return Object.assign(sdk, {
    createDirSdkContext: createRefCountMap((dir) => createDirSdkContext(dir, sdk)),
  })
}

export const { use: useServerSDK, provider: ServerSDKProvider } = createSimpleContext({
  name: "ServerSDK",
  // Returns an accessor so the resolved server can change reactively (e.g. a
  // /new-session draft retargeting its server) without re-instantiating the subtree.
  init: (props: { server?: Accessor<ServerConnection.Any | undefined> }) => {
    const global = useGlobal()
    const language = useLanguage()
    const server = useServer()

    return createMemo<ServerSDK>(() => {
      const conn = props.server?.() ?? server.current
      if (!conn) throw new Error(language.t("error.serverSDK.noServerAvailable"))
      return global.createServerCtx(conn).sdk
    })
  },
})

type SDKEventMap = {
  [key in Event["type"]]: Extract<Event, { type: key }>
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase) {
  const client = serverSDK.createClient({
    directory,
    throwOnError: true,
  })

  const emitter = createGlobalEmitter<SDKEventMap>()

  const unsub = serverSDK.event.on(directory, (event) => {
    emitter.emit(event.type, event)
  })
  onCleanup(unsub)

  return {
    scope: serverSDK.scope,
    directory,
    client,
    event: emitter,
    get url() {
      return serverSDK.url
    },
    createClient(opts: Parameters<typeof serverSDK.createClient>[0]) {
      return serverSDK.createClient(opts)
    },
  }
}
