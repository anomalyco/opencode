import type { Event } from "@opencode-ai/sdk/v2/client"
import {
  createContext,
  createEffect,
  createSignal,
  getOwner,
  on,
  onCleanup,
  useContext,
  type ParentProps,
} from "solid-js"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import z from "zod"
import { createSdkForServer } from "@/utils/server"
import { useLanguage } from "./language"
import { usePlatform } from "./platform"
import { useServer } from "./server"

const abortError = z.object({
  name: z.literal("AbortError"),
})

type Value = {
  url: string
  client: ReturnType<typeof createSdkForServer>
  event: ReturnType<typeof createGlobalEmitter<{ [key: string]: Event }>>
  version: number
  createClient(
    opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">,
  ): ReturnType<typeof createSdkForServer>
}

const GlobalSDKContext = createContext<Value>()

export function GlobalSDKProvider(props: ParentProps) {
  const language = useLanguage()
  const server = useServer()
  const platform = usePlatform()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSDK must be created within owner")
  if (!server.current) throw new Error(language.t("error.globalSDK.noServerAvailable"))

  const emitter = createGlobalEmitter<{ [key: string]: Event }>()
  const [state, setState] = createSignal<Value>({
    url: server.current.http.url,
    client: createSdkForServer({
      server: server.current.http,
      fetch: platform.fetch,
      throwOnError: true,
    }),
    event: emitter,
    version: 0,
    createClient(opts) {
      // Consumers often memoize createClient(); touching version makes those memos rerun
      // when the active server changes without remounting the provider tree.
      state().version
      const active = server.current
      if (!active) throw new Error(language.t("error.globalSDK.serverNotAvailable"))
      return createSdkForServer({
        server: active.http,
        fetch: platform.fetch,
        ...opts,
      })
    },
  })

  const value: Value = {
    get url() {
      return state().url
    },
    get client() {
      return state().client
    },
    get event() {
      return emitter
    },
    get version() {
      return state().version
    },
    createClient(opts) {
      // Consumers often memoize createClient(); touching version makes those memos rerun
      // when the active server changes without remounting the provider tree.
      state().version
      const active = server.current
      if (!active) throw new Error(language.t("error.globalSDK.serverNotAvailable"))
      return createSdkForServer({
        server: active.http,
        fetch: platform.fetch,
        ...opts,
      })
    },
  }

  createEffect(
    on(
      () => server.key,
      () => {
        const current = server.current
        if (!current) return

        const abort = new AbortController()
        const url = current.http.url
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

        const eventSdk = createSdkForServer({
          signal: abort.signal,
          fetch: eventFetch,
          server: current.http,
        })
        const client = createSdkForServer({
          server: current.http,
          fetch: platform.fetch,
          throwOnError: true,
        })

        const next = state().version + 1
        setState({
          url,
          client,
          event: emitter,
          version: next,
          createClient: value.createClient,
        })

        type Queued = { directory: string; payload: Event }
        const FLUSH_FRAME_MS = 16
        const STREAM_YIELD_MS = 8
        const RECONNECT_DELAY_MS = 250
        const HEARTBEAT_TIMEOUT_MS = 15_000
        let queue: Queued[] = []
        let buffer: Queued[] = []
        const coalesced = new Map<string, number>()
        const stale = new Set<string>()
        let timer: ReturnType<typeof setTimeout> | undefined
        let last = 0
        let streamErrorLogged = false
        let attempt: AbortController | undefined
        let lastEventAt = Date.now()
        let heartbeat: ReturnType<typeof setTimeout> | undefined

        const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
        const aborted = (error: unknown) => abortError.safeParse(error).success
        const deltaKey = (directory: string, messageID: string, partID: string) => `${directory}:${messageID}:${partID}`
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
          const skip = stale.size > 0 ? new Set(stale) : undefined
          queue = buffer
          buffer = events
          queue.length = 0
          coalesced.clear()
          stale.clear()
          last = Date.now()
          for (const event of events) {
            if (skip && event.payload.type === "message.part.delta") {
              const props = event.payload.properties
              if (skip.has(deltaKey(event.directory, props.messageID, props.partID))) continue
            }
            emitter.emit(event.directory, event.payload)
          }
          buffer.length = 0
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
                  console.error("[global-sdk] event stream error", {
                    url,
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
              if (!aborted(error) && !streamErrorLogged) {
                streamErrorLogged = true
                console.error("[global-sdk] event stream failed", {
                  url,
                  fetch: eventFetch ? "platform" : "webview",
                  error,
                })
              }
            } finally {
              abort.signal.removeEventListener("abort", onAbort)
              attempt = undefined
              clearHeartbeat()
            }
            if (abort.signal.aborted) return
            await wait(RECONNECT_DELAY_MS)
          }
        })().finally(flush)

        const onVisibility = () => {
          if (typeof document === "undefined") return
          if (document.visibilityState !== "visible") return
          if (Date.now() - lastEventAt < HEARTBEAT_TIMEOUT_MS) return
          attempt?.abort()
        }
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility)

        onCleanup(() => {
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility)
          abort.abort()
          flush()
        })
      },
    ),
  )

  return <GlobalSDKContext.Provider value={value}>{props.children}</GlobalSDKContext.Provider>
}

export function useGlobalSDK() {
  const value = useContext(GlobalSDKContext)
  if (!value) throw new Error("useGlobalSDK must be used within GlobalSDKProvider")
  return value
}
