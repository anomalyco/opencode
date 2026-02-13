import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup } from "solid-js"
import { usePlatform } from "./platform"
import { useServer } from "./server"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const abort = new AbortController()

    const password = typeof window === "undefined" ? undefined : window.__OPENCODE__?.serverPassword

    const auth = (() => {
      if (!password) return
      if (!server.isLocal()) return
      return {
        Authorization: `Basic ${btoa(`opencode:${password}`)}`,
      }
    })()

    const eventFetch = (() => {
      if (!platform.fetch) return
      try {
        const url = new URL(server.url)
        const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
        if (url.protocol === "http:" && !loopback) return platform.fetch
      } catch {
        return
      }
    })()

    const eventSdk = createOpencodeClient({
      baseUrl: server.url,
      signal: abort.signal,
      fetch: eventFetch,
      headers: eventFetch ? undefined : auth,
    })
    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    type Queued = { directory: string; payload: Event }
    const FLUSH_FRAME_MS = 16
    const STREAM_YIELD_MS = 8
    const RECONNECT_DELAY_MS = 250

    let queue: Queued[] = []
    let buffer: Queued[] = []
    const coalesced = new Map<string, number>()
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
      queue = buffer
      buffer = events
      queue.length = 0
      coalesced.clear()

      last = Date.now()
      batch(() => {
        for (const event of events) {
          emitter.emit(event.directory, event.payload)
        }
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

    void (async () => {
      while (!abort.signal.aborted) {
        try {
          const events = await eventSdk.global.event({
            onSseError: (error) => {
              if (streamErrorLogged) return
              streamErrorLogged = true
              console.error("[global-sdk] event stream error", {
                url: server.url,
                fetch: eventFetch ? "platform" : "webview",
                error,
              })
            },
          })
          let yielded = Date.now()
          for await (const event of events.stream) {
            streamErrorLogged = false
            const directory = event.directory ?? "global"
            const payload = event.payload
            const k = key(directory, payload)
            if (k) {
              const i = coalesced.get(k)
              if (i !== undefined) {
                queue[i] = { directory, payload }
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
          if (!streamErrorLogged) {
            streamErrorLogged = true
            console.error("[global-sdk] event stream failed", {
              url: server.url,
              fetch: eventFetch ? "platform" : "webview",
              error,
            })
          }
        }

        if (abort.signal.aborted) return
        await wait(RECONNECT_DELAY_MS)
      }
    })().finally(flush)

    onCleanup(() => {
      abort.abort()
      flush()
    })

    const sdk = createOpencodeClient({
      baseUrl: server.url,
      fetch: platform.fetch,
      throwOnError: true,
    })

    return { url: server.url, client: sdk, event: emitter }
  },
})
