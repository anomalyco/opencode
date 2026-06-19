import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { Global } from "@opencode-ai/core/global"
import { appendFileSync } from "fs"
import path from "path"

Heap.start()

function workerDebug(event: string, data: Record<string, unknown> = {}) {
  try {
    appendFileSync(
      path.join(Global.Path.log, "tui-worker-debug.log"),
      JSON.stringify({ time: new Date().toISOString(), pid: process.pid, scope: "worker", event, ...data }) + "\n",
    )
  } catch {}
}

function errorInfo(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack }
  return { message: String(error) }
}

function safeURL(value: string) {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value.split("?")[0]
  }
}

process.on("uncaughtException", (error) => {
  workerDebug("uncaught_exception", errorInfo(error))
})

process.on("unhandledRejection", (error) => {
  workerDebug("unhandled_rejection", errorInfo(error))
})

if ("addEventListener" in globalThis) {
  globalThis.addEventListener("error", (event) => {
    const error = "error" in event ? event.error : undefined
    workerDebug("global_error", errorInfo(error ?? event))
  })
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = "reason" in event ? event.reason : undefined
    workerDebug("global_unhandled_rejection", errorInfo(reason ?? event))
  })
}

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    workerDebug("fetch_start", { method: input.method, url: safeURL(input.url) })
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    workerDebug("fetch_done", { method: input.method, url: safeURL(input.url), status: response.status })
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    workerDebug("snapshot")
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    workerDebug("server_start", { port: input.port, hostname: input.hostname, mdns: input.mdns })
    if (server) await server.stop(true)
    server = await Server.listen(input)
    workerDebug("server_done", { url: server.url.toString() })
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    workerDebug("check_upgrade", { directory: input.directory })
    await InstanceRuntime.load({ directory: input.directory })
    await upgrade().catch(() => {})
  },
  async reload() {
    workerDebug("reload")
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    workerDebug("shutdown")
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
  },
}

Rpc.listen(rpc)
