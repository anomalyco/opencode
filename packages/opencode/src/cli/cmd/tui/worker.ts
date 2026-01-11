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

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    return Server.App().fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createOpencodeClient({
    baseUrl: "http://opencode.internal",
    directory,
    fetch: fetchFn,
    signal,
  })

  ;(async () => {
    while (!signal.aborted) {
      const events = await Promise.resolve(
        sdk.event.subscribe(
          {},
          {
            signal,
          },
        ),
      ).catch(() => undefined)

      if (!events) {
        await Bun.sleep(250)
        continue
      }

      for await (const event of events.stream) {
        Rpc.emit("event", event as Event)
      }

      if (!signal.aborted) {
        await Bun.sleep(250)
      }
    }
  })().catch((error) => {
    Log.Default.error("event stream error", {
      error: error instanceof Error ? error.message : error,
    })
  })
}

startEventStream(process.cwd())

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const request = new Request(input.url, {
      method: input.method,
      headers: input.headers,
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
    await Instance.disposeAll()
    if (server) server.stop(true)
  },
}

Rpc.listen(rpc)
