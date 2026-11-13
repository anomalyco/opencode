export * as ServerHealth from "./health"

import { Effect } from "effect"

// How often the main thread shows it is running.
const TICK = 250

/**
 * Starts a thread that reports how long this process's main thread has been blocked, at `GET /health` on its own
 * loopback port, and returns that URL. The main thread serves every other request and runs SQLite synchronously, so
 * a slow disk or a long synchronous task leaves it silent; this thread keeps answering, so a client can tell a busy
 * service from a dead one before it decides to replace it.
 */
export const start = Effect.fn("ServerHealth.start")(function* (password: string) {
  const { Worker } = yield* Effect.promise(() => import("node:worker_threads"))
  const ticks = new Int32Array(new SharedArrayBuffer(4))
  const { worker, heartbeat } = yield* Effect.acquireRelease(
    Effect.sync(() => ({
      heartbeat: setInterval(() => Atomics.add(ticks, 0, 1), TICK),
      // Started from source text, so no build has to ship a separate worker file.
      worker: new Worker(`(${thread})()`, { eval: true, workerData: { ticks: ticks.buffer, password, tick: TICK } }),
    })),
    (started) =>
      Effect.promise(() => {
        clearInterval(started.heartbeat)
        return started.worker.terminate()
      }),
  )
  heartbeat.unref()
  worker.unref()
  const port = yield* Effect.callback<number, Error>((resume) => {
    worker.once("message", (port: number) => resume(Effect.succeed(port)))
    worker.once("error", (error) => resume(Effect.fail(error)))
  })
  return `http://127.0.0.1:${port}/health`
})

/** What `GET /health` answers. */
export type Report = {
  readonly pid: number
  /** Milliseconds since the main thread last ran, up to a couple of ticks while it is idle. */
  readonly blocked: number
  /**
   * Whether the main thread was seen waiting on disk (Linux state `D`) since it last ran. Such a block is the disk's,
   * not a hang, and no signal lands until the IO returns. Always false where `/proc` is missing.
   */
  readonly disk: boolean
}

// Runs in the worker from its source text, so it may use only globals and Node built-ins.
function thread() {
  const threads = process.getBuiltinModule("node:worker_threads")
  const http = process.getBuiltinModule("node:http")
  const crypto = process.getBuiltinModule("node:crypto")
  const fs = process.getBuiltinModule("node:fs")
  const data: { ticks: SharedArrayBuffer; password: string; tick: number } = threads.workerData
  const ticks = new Int32Array(data.ticks)
  const expected = Buffer.from("Basic " + Buffer.from("opencode:" + data.password).toString("base64"))
  // The main thread's ID is the process ID. Only Linux has `/proc`.
  const stat = `/proc/self/task/${process.pid}/stat`
  const proc = fs.existsSync(stat)
  const seen = { count: Atomics.load(ticks, 0), at: Date.now(), disk: false }
  setInterval(() => {
    const count = Atomics.load(ticks, 0)
    if (count !== seen.count) {
      seen.count = count
      seen.at = Date.now()
      seen.disk = false
      return
    }
    // A long block is often many slow IOs with short runs between them, so sample it on every tick.
    if (!proc || seen.disk) return
    // The state follows the thread name, which is in parentheses and may contain ") " itself.
    seen.disk = fs.readFileSync(stat, "utf8").split(") ").at(-1)?.startsWith("D") === true
  }, data.tick)
  const server = http.createServer((request, response) => {
    const authorization = Buffer.from(request.headers.authorization ?? "")
    if (authorization.length !== expected.length || !crypto.timingSafeEqual(authorization, expected)) {
      response.writeHead(401).end()
      return
    }
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404).end()
      return
    }
    const report: Report = { pid: process.pid, blocked: Date.now() - seen.at, disk: seen.disk }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(report))
  })
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    threads.parentPort?.postMessage(typeof address === "object" && address !== null ? address.port : 0)
  })
}
