import { Installation } from "@/installation"
import { Server } from "@/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { InstanceRuntime } from "@/project/instance-runtime"
import { WithInstance } from "@/project/with-instance"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"

ensureProcessMetadata("worker")

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

Heap.start()

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

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
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
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await WithInstance.provide({
      directory: input.directory,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    Log.Default.info("worker shutting down")

    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
  },
}

Rpc.listen(rpc)
