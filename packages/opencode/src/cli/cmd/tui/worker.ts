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
import { TaskManager, type TaskInfo } from "@/task"

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
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined,
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

  ;(async () => {
    while (!signal.aborted) {
      let events: AsyncIterable<Event> | undefined
      try {
        // Attempt to subscribe to server-side events; log any error
        events = await Promise.resolve(
          sdk.event.subscribe({}, { signal }),
        )
      } catch (err) {
        Log.Default.error("event subscribe failed", {
          directory,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
        // Wait a bit before retrying
        await Bun.sleep(500)
        continue
      }

      if (!events) {
        Log.Default.debug("no events from subscribe, retrying", { directory })
        await Bun.sleep(250)
        continue
      }

      try {
        for await (const event of (events as any).stream ?? events) {
          Rpc.emit("event", event as Event)
        }
      } catch (err) {
        Log.Default.error("error while reading event stream", {
          directory,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
      }

      if (!signal.aborted) {
        await Bun.sleep(250)
      }
    }
  })().catch((error) => {
    Log.Default.error("event stream fatal", {
      directory,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
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

    let response: Response
    try {
      response = await Server.App().fetch(request)
    } catch (err) {
      Log.Default.error("rpc.fetch network error", {
        url: input.url,
        method: input.method,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      throw err
    }

    const body = await response.text()

    if (!response.ok) {
      Log.Default.error("rpc.fetch bad response", {
        url: input.url,
        status: response.status,
        body: body.slice(0, 2000),
      })
    }

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

  // Task management RPC handlers
  async taskList(input: { directory: string }): Promise<TaskInfo[]> {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: () => TaskManager.list(),
    })
  },

  async taskGet(input: { directory: string; taskId: string }): Promise<TaskInfo | undefined> {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: () => TaskManager.get(input.taskId),
    })
  },

  async taskKill(input: { directory: string; taskId: string }): Promise<boolean> {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: () => TaskManager.kill(input.taskId),
    })
  },

  async taskRead(input: { directory: string; taskId: string }): Promise<string> {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: () => TaskManager.read(input.taskId),
    })
  },

  async taskTail(input: { directory: string; taskId: string; lines?: number }): Promise<string> {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: () => TaskManager.tail(input.taskId, input.lines ?? 50),
    })
  },

  async taskInput(input: { directory: string; taskId: string; data: string }): Promise<boolean> {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: () => TaskManager.input(input.taskId, input.data),
    })
  },

  async taskCleanup(input: { directory: string; maxAge?: number }): Promise<number> {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: () => TaskManager.cleanup(input.maxAge),
    })
  },

  async taskRemove(input: { directory: string; taskId: string }): Promise<boolean> {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: () => TaskManager.remove(input.taskId),
    })
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${btoa(`${username}:${password}`)}`
}
