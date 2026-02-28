import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { createOpencodeClient, type Event } from "@opencode-ai/sdk/v2"
import type { BunWebSocketData } from "hono/bun"
import { Flag } from "@/flag/flag"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Bun.Server<BunWebSocketData> | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
}

const startEventStream = (directory: string) => {
  if (eventStream.abort) eventStream.abort.abort()
  const abort = new AbortController()
  eventStream.abort = abort
  const signal = abort.signal
  const RECONNECT_DELAY_MS = 250
  const HEARTBEAT_TIMEOUT_MS = 15_000

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const auth = getAuthorizationHeader()
    if (auth) request.headers.set("Authorization", auth)
    return Server.App().fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createOpencodeClient({
    baseUrl: "http://opencode.internal",
    directory,
    fetch: fetchFn,
    signal,
  })

  const aborted = (error: unknown) => error instanceof Error && error.name === "AbortError"

  ;(async () => {
    let streamErrorLogged = false
    while (!signal.aborted) {
      const attempt = new AbortController()
      const onAbort = () => {
        attempt.abort()
      }
      signal.addEventListener("abort", onAbort)
      let heartbeat: Timer | undefined
      const resetHeartbeat = () => {
        if (heartbeat) clearTimeout(heartbeat)
        heartbeat = setTimeout(() => {
          attempt.abort()
        }, HEARTBEAT_TIMEOUT_MS)
      }

      try {
        const events = await sdk.event.subscribe(
          {},
          {
            signal: attempt.signal,
          },
        )
        resetHeartbeat()

        for await (const event of events.stream) {
          streamErrorLogged = false
          resetHeartbeat()
          Rpc.emit("event", event as Event)
        }
      } catch (error) {
        if (!aborted(error) && !streamErrorLogged) {
          streamErrorLogged = true
          Log.Default.error("event stream error", {
            error: error instanceof Error ? error.message : error,
          })
        }
      } finally {
        signal.removeEventListener("abort", onAbort)
        if (heartbeat) clearTimeout(heartbeat)
      }

      if (!signal.aborted) await Bun.sleep(RECONNECT_DELAY_MS)
    }
  })().catch((error) => {
    Log.Default.error("event stream crashed", {
      error: error instanceof Error ? error.message : error,
    })
  })
}

startEventStream(process.cwd())

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.App().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    Config.global.reset()
    await Instance.disposeAll()
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    if (eventStream.abort) eventStream.abort.abort()
    await Promise.race([
      Instance.disposeAll(),
      new Promise((resolve) => {
        setTimeout(resolve, 5000)
      }),
    ])
    if (server) server.stop(true)
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${btoa(`${username}:${password}`)}`
}
