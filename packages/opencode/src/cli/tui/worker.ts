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
import {
  loadANRConfig,
  initializeOTEL,
  shutdownOTEL,
  reconstructTelemetryContextFromEnv,
  initializeAuditLogger,
} from "@opencode-ai/anr-core"

Heap.start()

process.on("unhandledRejection", (e) => {
  console.error("worker unhandled rejection", e instanceof Error ? e.message : e)
})

process.on("uncaughtException", (e) => {
  console.error("worker uncaught exception", e instanceof Error ? e.message : e)
})

// Initialize OTEL and audit logger in the worker. The main thread's
// MeterProvider and dynamoClient are not shared with Bun Workers.
if (process.env.OPENCODE_FLAVOR === "anr") {
  const config = await loadANRConfig(process.env.OPENCODE_ANR_ENV_FILE, true)

  // OTEL: so token metrics from session processing are recorded
  if (process.env.OPENCODE_ENABLE_TELEMETRY === "1") {
    const workerContext = reconstructTelemetryContextFromEnv()
    if (workerContext) {
      try {
        initializeOTEL(config, workerContext)
        console.error("[worker] OTEL initialized successfully")
      } catch (e) {
        console.error("[worker] OTEL init failed:", e instanceof Error ? e.message : e)
      }
    } else {
      console.error("[worker] OTEL skipped: no telemetry context (OPENCODE_ANR_USER_ID=" + process.env.OPENCODE_ANR_USER_ID + ")")
    }
  } else {
    console.error("[worker] OTEL skipped: OPENCODE_ENABLE_TELEMETRY=" + process.env.OPENCODE_ENABLE_TELEMETRY)
  }

  // Audit logger: so logTokenUsage calls from processor.ts write to DynamoDB
  if (
    process.env.OPENCODE_ENABLE_AUDIT !== "0" &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_SESSION_TOKEN
  ) {
    initializeAuditLogger(config, {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    })
  }
}

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
  async updateCredentials(input: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
    idToken?: string
  }) {
    process.env.AWS_ACCESS_KEY_ID = input.accessKeyId
    process.env.AWS_SECRET_ACCESS_KEY = input.secretAccessKey
    process.env.AWS_SESSION_TOKEN = input.sessionToken
    if (input.idToken) process.env.OPENCODE_ANR_ID_TOKEN = input.idToken
    console.log("worker credentials updated")
  },
  async shutdown() {
    console.log("worker shutting down")
    // Flush any pending OTEL metrics before shutting down
    await shutdownOTEL().catch(() => {})
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
  },
}

Rpc.listen(rpc)
