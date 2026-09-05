import { writeHeapSnapshot } from "node:v8"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { installStdioFileGuard } from "@opencode-ai/tui/util/stdio-guard"
import { GlobalBus } from "@/bus/global"
import { Heap } from "@/cli/heap"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRuntime } from "@/project/instance-runtime"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { Server } from "@/server/server"
import { ServerAuth } from "@/server/auth"
import { Rpc } from "@/util/rpc"

// Worker realms get their own `process` but share the terminal descriptors with the TUI on the main
// thread, so server or plugin writes here would corrupt the frame. Lives as long as the worker.
const restoreStdio = installStdioFileGuard(path.join(Global.Path.log, "stdio-worker.log"), { truncate: true })

Heap.start()

const onUnhandledRejection = (_error: unknown) => {}

const onUncaughtException = (_error: Error) => {}

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

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
    await InstanceRuntime.load({ directory: input.directory })
    await upgrade().catch(() => {})
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
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
    restoreStdio()
  },
}

Rpc.listen(rpc)
