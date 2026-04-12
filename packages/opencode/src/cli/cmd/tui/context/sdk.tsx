import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { GlobalEvent, Event } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, createSignal, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()
    const [connectionState, setConnectionState] = createSignal<"connected" | "reconnecting">("connected")
    const [reconnectToken, setReconnectToken] = createSignal(0)
    let disconnected = false

    const emitter = createGlobalEmitter<{
      event: GlobalEvent
    }>()

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    const markDisconnected = () => {
      if (abort.signal.aborted || sse?.signal.aborted) return
      disconnected = true
      setConnectionState("reconnecting")
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          let heartbeatTimer: ReturnType<typeof setTimeout> | undefined
          const resetHeartbeat = () => {
            if (heartbeatTimer) clearTimeout(heartbeatTimer)
            heartbeatTimer = setTimeout(() => {
              markDisconnected()
            }, 20000)
          }

          try {
            const events = await sdk.global.event({
              signal: ctrl.signal,
              onSseError() {
                markDisconnected()
              },
            })

            resetHeartbeat()
            for await (const event of events.stream) {
              resetHeartbeat()
              if (ctrl.signal.aborted) break
              if ((event.payload.type as string) === "server.heartbeat") continue

              if (connectionState() !== "connected") {
                setConnectionState("connected")
                if (disconnected) {
                  disconnected = false
                  setReconnectToken((value) => value + 1)
                }
              }
              handleEvent(event)
            }
          } catch {
            markDisconnected()
          } finally {
            if (heartbeatTimer) clearTimeout(heartbeatTimer)
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()

          // Small delay before reconnecting to avoid tight loops
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        const unsub = await props.events.subscribe(handleEvent)
        onCleanup(unsub)
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      connection: {
        get state() {
          return connectionState()
        },
        get reconnectToken() {
          return reconnectToken()
        },
      },
      url: props.url,
    }
  },
})
