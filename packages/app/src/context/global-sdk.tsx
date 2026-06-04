import type { GlobalEvent } from "@opencode-ai/sdk/v2/client"
import { createContext, createEffect, createSignal, getOwner, onCleanup, useContext, type ParentProps } from "solid-js"
import { createGlobalEmitter, type GlobalEmitter } from "@solid-primitives/event-bus"
import z from "zod"
import { createSdkForServer } from "@/utils/server"
import { domainFromIntegration, type DomainId } from "@/pages/layout/extra-agents"
import { useLanguage } from "./language"
import { usePlatform } from "./platform"
import { useServer } from "./server"

const abortError = z.object({
  name: z.literal("AbortError"),
})

type EventMap = { [key: string]: GlobalEvent["payload"] }
type DomainEmitter = GlobalEmitter<EventMap>
type DomainEvent = { name: string; details: GlobalEvent["payload"]; domain: DomainId }
type DomainListener = (event: DomainEvent) => void

type Value = {
  url: string
  client: ReturnType<typeof createSdkForServer>
  version: number
  createClient(
    opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">,
  ): ReturnType<typeof createSdkForServer>
  forDomain(domain: DomainId): Runtime
  eventFor(domain: DomainId): DomainEmitter
  listenAll(listener: DomainListener): VoidFunction
}

type Runtime = {
  url: string
  client: ReturnType<typeof createSdkForServer>
  version: number
  createClient(
    opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">,
  ): ReturnType<typeof createSdkForServer>
  event: DomainEmitter
}

const GlobalSDKContext = createContext<Value>()

export function GlobalSDKProvider(props: ParentProps) {
  const language = useLanguage()
  const server = useServer()
  const platform = usePlatform()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSDK must be created within owner")
  if (!server.current) throw new Error(language.t("error.globalSDK.noServerAvailable"))

  const emitterByDomain = new Map<DomainId, DomainEmitter>()
  type ListenAllEntry = { cb: DomainListener }
  const listenAllEntries = new Set<ListenAllEntry>()

  const ensureEmitter = (domain: DomainId): DomainEmitter => {
    const existing = emitterByDomain.get(domain)
    if (existing) return existing
    const created = createGlobalEmitter<EventMap>()
    emitterByDomain.set(domain, created)
    return created
  }

  ensureEmitter(domainFromIntegration(server.current.integration))

  const currentDomain = () => server.domain
  const streams = new Map<DomainId, { url: string; stop: () => void }>()

  const createRuntime = (conn: NonNullable<typeof server.current>, version: number, domain: DomainId): Runtime => ({
    url: conn.http.url,
    client: createSdkForServer({
      server: conn.http,
      fetch: platform.fetch,
      throwOnError: true,
    }),
    version,
    createClient(opts) {
      return createSdkForServer({
        server: conn.http,
        fetch: platform.fetch,
        ...opts,
      })
    },
    event: ensureEmitter(domain),
  })

  const [state, setState] = createSignal<Partial<Record<DomainId, Runtime>>>({
    [currentDomain()]: createRuntime(server.current, 0, currentDomain()),
  })

  const runtimeFor = (domain: DomainId) => {
    const existing = state()[domain]
    if (existing) return existing
    const conn = server.currentFor(domain)
    if (!conn) throw new Error(language.t("error.globalSDK.serverNotAvailable"))
    return createRuntime(conn, 0, domain)
  }

  const runtime = () => runtimeFor(currentDomain())

  const value: Value = {
    get url() {
      return runtime().url
    },
    get client() {
      return runtime().client
    },
    get version() {
      return runtime().version
    },
    createClient(opts) {
      return runtime().createClient(opts)
    },
    forDomain(domain) {
      return runtimeFor(domain)
    },
    eventFor(domain) {
      return ensureEmitter(domain)
    },
    listenAll(listener) {
      const entry: ListenAllEntry = { cb: listener }
      listenAllEntries.add(entry)
      return () => {
        listenAllEntries.delete(entry)
      }
    },
  }

  createEffect(() => {
    const conns = new Map<DomainId, NonNullable<ReturnType<typeof server.currentFor>>>()
    for (const item of server.list) {
      conns.set(domainFromIntegration(item.integration), item)
    }
    const current = server.current
    if (current) conns.set(currentDomain(), current)

    for (const [domain, conn] of conns) {
      const url = conn.http.url
      const existing = streams.get(domain)
      if (existing?.url === url) continue
      existing?.stop()

      const abort = new AbortController()
      const eventFetch = (() => {
        if (!platform.fetch) return
        try {
          const parsed = new URL(url)
          const loopback =
            parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1"
          if (parsed.protocol === "http:" && !loopback) return platform.fetch
        } catch {
          return
        }
      })()
      const eventSdk = createSdkForServer({ signal: abort.signal, fetch: eventFetch, server: conn.http })
      const next = (state()[domain]?.version ?? 0) + 1
      setState((prev) => ({ ...prev, [domain]: createRuntime(conn, next, domain) }))
      const domainEmitter = ensureEmitter(domain)

      type Queued = { directory: string; payload: GlobalEvent["payload"] }
      const FLUSH_FRAME_MS = 16
      const FLUSH_BUDGET_MS = 6
      const FLUSH_EVENT_LIMIT = 12
      const STREAM_YIELD_MS = 8
      const RECONNECT_DELAY_MS = 250
      const HEARTBEAT_TIMEOUT_MS = 15_000
      let queue: Queued[] = []
      let buffer: Queued[] = []
      let flushing: Queued[] | undefined
      let flushIndex = 0
      let flushSkip: Set<string> | undefined
      const coalesced = new Map<string, number>()
      const stale = new Set<string>()
      let timer: ReturnType<typeof setTimeout> | undefined
      let last = 0
      let streamErrorLogged = false
      let attempt: AbortController | undefined
      let lastEventAt = Date.now()
      let heartbeat: ReturnType<typeof setTimeout> | undefined
      // Suppress error logs during the cold-start race where extra-agent
      // backends are still spawning. Once the stream has yielded at least
      // one event we know the server is reachable, so subsequent failures
      // are worth logging immediately.
      let everConnected = false
      let failedAttempts = 0
      const LOG_ERROR_AFTER_FAILED_ATTEMPTS = 4

      const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
      const aborted = (error: unknown) => abortError.safeParse(error).success
      const deltaKey = (directory: string, messageID: string, partID: string) => `${directory}:${messageID}:${partID}`
      const key = (directory: string, payload: GlobalEvent["payload"]) => {
        if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`
        if (payload.type === "lsp.updated") return `lsp.updated:${directory}`
        if (payload.type === "message.part.updated") {
          const part = payload.properties.part
          return `message.part.updated:${directory}:${part.messageID}:${part.id}`
        }
      }
      const urgent = (payload: GlobalEvent["payload"]) =>
        payload.type === "question.asked" || payload.type === "permission.asked"
      const prioritize = (events: Queued[]) => {
        if (events.length < 2) return events
        let found = false
        for (const event of events) {
          if (urgent(event.payload)) {
            found = true
            break
          }
        }
        if (!found) return events
        const next: Queued[] = []
        for (const event of events) {
          if (urgent(event.payload)) next.push(event)
        }
        for (const event of events) {
          if (!urgent(event.payload)) next.push(event)
        }
        return next
      }
      const dispatch = (event: Queued) => {
        if (flushSkip && event.payload.type === "message.part.delta") {
          const props = event.payload.properties
          if (flushSkip.has(deltaKey(event.directory, props.messageID, props.partID))) {
            return
          }
        }
        // The per-domain emitter's `emit` drives `.on(key)` subscribers
        // (see `SDKProvider`, `quick-assistant.tsx`). `listenAll`
        // subscribers are dispatched directly below because the emitter's
        // global `.listen` callback was observed to go silent for
        // extra-agent domains (even though `emit` ran), which would drop
        // every message/part update for those domains.
        domainEmitter.emit(event.directory, event.payload)
        for (const entry of listenAllEntries) {
          try {
            entry.cb({ name: event.directory, details: event.payload, domain })
          } catch (err) {
            console.error(`[global-sdk] listenAll cb failed error=${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
      const flush = (drain = false) => {
        if (timer) clearTimeout(timer)
        timer = undefined
        if (!flushing) {
          if (queue.length === 0) return
          const events = queue
          flushSkip = stale.size > 0 ? new Set(stale) : undefined
          queue = buffer
          buffer = events
          queue.length = 0
          coalesced.clear()
          stale.clear()
          flushing = prioritize(events)
          flushIndex = 0
        }

        last = Date.now()
        const start = performance.now()
        let dispatched = 0
        const events = flushing
        while (flushIndex < events.length) {
          dispatch(events[flushIndex])
          flushIndex++
          dispatched++
          if (!drain && (dispatched >= FLUSH_EVENT_LIMIT || performance.now() - start >= FLUSH_BUDGET_MS)) {
            timer = setTimeout(() => flush(), 0)
            return
          }
        }
        buffer.length = 0
        flushing = undefined
        flushIndex = 0
        flushSkip = undefined
        if (queue.length > 0) schedule()
      }
      const schedule = () => {
        if (timer) return
        const elapsed = Date.now() - last
        timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
      }
      const resetHeartbeat = () => {
        lastEventAt = Date.now()
        if (heartbeat) clearTimeout(heartbeat)
        heartbeat = setTimeout(() => attempt?.abort(), HEARTBEAT_TIMEOUT_MS)
      }
      const clearHeartbeat = () => {
        if (!heartbeat) return
        clearTimeout(heartbeat)
        heartbeat = undefined
      }
      const onVisibility = () => {
        if (typeof document === "undefined") return
        if (document.visibilityState !== "visible") return
        if (Date.now() - lastEventAt < HEARTBEAT_TIMEOUT_MS) return
        attempt?.abort()
      }
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility)

      void (async () => {
        while (!abort.signal.aborted) {
          attempt = new AbortController()
          lastEventAt = Date.now()
          const onAbort = () => attempt?.abort()
          abort.signal.addEventListener("abort", onAbort)
          try {
            const events = await eventSdk.global.event({
              signal: attempt.signal,
              onSseError: (error) => {
                if (aborted(error) || streamErrorLogged) return
                streamErrorLogged = true
              },
            })
            let yielded = Date.now()
            resetHeartbeat()
            for await (const event of events.stream) {
              resetHeartbeat()
              streamErrorLogged = false
              everConnected = true
              failedAttempts = 0
              const directory = event.directory ?? "global"
              const payload = event.payload
              const k = key(directory, payload)
              if (k) {
                const i = coalesced.get(k)
                if (i !== undefined) {
                  queue[i] = { directory, payload }
                  if (payload.type === "message.part.updated") {
                    const part = payload.properties.part
                    stale.add(deltaKey(directory, part.messageID, part.id))
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
            if (
              !aborted(error) &&
              !streamErrorLogged &&
              (everConnected || failedAttempts >= LOG_ERROR_AFTER_FAILED_ATTEMPTS)
            ) {
              streamErrorLogged = true
            }
          } finally {
            abort.signal.removeEventListener("abort", onAbort)
            attempt = undefined
            clearHeartbeat()
            failedAttempts++
          }
          if (abort.signal.aborted) return
          await wait(RECONNECT_DELAY_MS)
        }
      })().finally(() => flush(true))

      streams.set(domain, {
        url,
        stop: () => {
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility)
          abort.abort()
          flush(true)
        },
      })
    }

    for (const [domain, stream] of Array.from(streams.entries())) {
      if (conns.has(domain)) continue
      stream.stop()
      streams.delete(domain)
    }
  })

  onCleanup(() => {
    for (const stream of streams.values()) stream.stop()
    streams.clear()
    listenAllEntries.clear()
    for (const emitter of emitterByDomain.values()) emitter.clear()
    emitterByDomain.clear()
  })

  return <GlobalSDKContext.Provider value={value}>{props.children}</GlobalSDKContext.Provider>
}

export function useGlobalSDK() {
  const value = useContext(GlobalSDKContext)
  if (!value) throw new Error("useGlobalSDK must be used within GlobalSDKProvider")
  return value
}
