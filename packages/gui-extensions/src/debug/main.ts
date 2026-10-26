import { app, contentTracing, screen, type BrowserWindow } from "electron"
import { Schema } from "effect"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { getHeapSpaceStatistics, getHeapStatistics, writeHeapSnapshot } from "node:v8"
import type { MainSetup } from "../sdk/main"
import { HeapSnapshots, MemoryDiagnostics } from "./contract"
import type definition from "./index"
import { summarize, traceConfig } from "./memory-infra"
import { startMemoryLog } from "./memory-log"
import { debugBuild, memoryLogInterval } from "./options"
import { captureServer } from "./server-heap"
import { signalIncludesServer, snapshotDirectory } from "./signal"
import { ProcessSignal } from "@opencode/util/process-signal"

/** A desktop process the manifest lists: the file written, or why there is none. */
type Snapshot = { readonly process: "main" | "window"; readonly pid: number; readonly window?: number } & (
  | { readonly file: string }
  | { readonly error: string }
)

/** The last capture; the next one starts after it settles. */
type Queue = { tail: Promise<unknown> }

/** What a window's page holds, read from inside it. */
const PageStats = Schema.Struct({
  elements: Schema.Number,
  images: Schema.Struct({ count: Schema.Number, decodedMiB: Schema.Number }),
  canvases: Schema.Struct({ count: Schema.Number, MiB: Schema.Number }),
  svgUses: Schema.Number,
  devicePixelRatio: Schema.Number,
  viewport: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  jsHeap: Schema.optional(
    Schema.Struct({ usedJSHeapSize: Schema.Number, totalJSHeapSize: Schema.Number, jsHeapSizeLimit: Schema.Number }),
  ),
})

const decodePageStats = Schema.decodeUnknownPromise(PageStats)

// Runs in the app window. Pixel sizes estimate decoded memory at 4 bytes per pixel.
const pageStatsScript = `(() => {
  const mib = (bytes) => Math.round(bytes / 1048576 * 10) / 10
  const images = [...document.images]
  const canvases = [...document.querySelectorAll("canvas")]
  const memory = performance.memory
  return {
    elements: document.getElementsByTagName("*").length,
    images: { count: images.length, decodedMiB: mib(images.reduce((t, i) => t + i.naturalWidth * i.naturalHeight * 4, 0)) },
    canvases: { count: canvases.length, MiB: mib(canvases.reduce((t, c) => t + c.width * c.height * 4, 0)) },
    svgUses: document.getElementsByTagName("use").length,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    jsHeap: memory && { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit },
  }
})()`

/** Stops the running memory diagnostics, while they run. */
type Running = { stop?: () => void }

const setup: MainSetup<typeof definition> = (ctx) => {
  const queue: Queue = { tail: Promise.resolve() }

  const capture = async (root: string, includeServer: boolean) => {
    const directory = path.join(root, `opencode-heap-${new Date().toISOString().replace(/[:.]/g, "")}`)

    // Snapshots hold prompts, file contents and credentials. Recursive, because Downloads can be missing on Linux.
    await mkdir(directory, { recursive: true, mode: 0o700 })
    ctx.log.write("info", "capturing heap snapshots", { directory, includeServer })

    // Measurements first: writing a heap snapshot raises the memory of the process it serializes.
    const before = {
      metrics: app.getAppMetrics(),
      mainMemory: process.memoryUsage(),
      mainHeap: getHeapStatistics(),
      mainHeapSpaces: getHeapSpaceStatistics(),
      system: process.getSystemMemoryInfo(),
    }

    const native = await recordNative(directory)
    const windows = ctx.windows.list()
    const pages = await Promise.all(windows.map((window) => describeWindow(window)))

    // The server is another process, so it serializes its heap while the windows do. Windows go one at a time: a
    // snapshot can double a process's memory, and a leaking app may not have room for every window at once. Main goes
    // last: writing its own heap blocks the loop that receives the others.
    const [serverSnapshot, windowSnapshots] = await Promise.all([
      includeServer ? captureServer(ctx.serverEndpoints.get("sidecar"), directory, ctx.scope.signal) : undefined,
      (async () => {
        const list: Snapshot[] = []

        for (const window of windows) list.push(await captureWindow(window, directory))

        return list
      })(),
    ])

    const main = await Promise.resolve()
      .then(() => writeHeapSnapshot(path.join(directory, `main-${process.pid}.heapsnapshot`)))
      .then(
        (file): Snapshot => ({ process: "main", pid: process.pid, file: path.basename(file) }),
        (error: Error): Snapshot => ({ process: "main", pid: process.pid, error: error.message }),
      )

    const snapshots = await Promise.all(
      [...(serverSnapshot ? [serverSnapshot] : []), ...windowSnapshots, main].map(async (snapshot) => {
        if ("error" in snapshot) return snapshot
        const file = "file" in snapshot ? path.join(directory, snapshot.file) : snapshot.path

        const bytes = await stat(file).then(
          (info) => info.size,
          () => null,
        )

        ctx.log.write("info", "heap snapshot written", { file, bytes })

        return { ...snapshot, bytes }
      }),
    )
    const gpu = await app.getGPUInfo("basic").catch((error: Error) => ({ error: error.message }))

    // One readable answer to "where is the memory", per process, in MiB.
    await write(directory, "memory.json", {
      unit: "MiB",
      native: "summary" in native ? native.summary : native,
      server:
        !serverSnapshot || "error" in serverSnapshot || !serverSnapshot.memory
          ? undefined
          : mibs(serverSnapshot.memory),
      pages,
      note: "native: Chromium's memory-infra dump per process, before the heap snapshots. Some allocators overlap: cc, skia, gpu and web_cache report memory that malloc, discardable or shared_memory also count. pages: what each app window's page held. server: the server's process.memoryUsage().",
    })
    await write(directory, "gpu.json", gpu)
    // Written last, so a script can wait for it.
    await write(directory, "manifest.json", {
      created: new Date().toISOString(),
      includeServer,
      app: {
        name: app.getName(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        uptimeSeconds: process.uptime(),
        platform: process.platform,
        arch: process.arch,
        versions: process.versions,
      },
      files: {
        "memory.json": "Where the memory is, per process, in MiB. Start here.",
        "memory-infra.json": "Chromium's raw memory dump trace. Open it in https://ui.perfetto.dev.",
        "gpu.json": "The GPU and driver.",
        "*.heapsnapshot": "Heap snapshots. Open them in the Memory panel of Chrome DevTools.",
      },
      snapshots,
      // Per-process memory as the OS sees it: a process that grows while its heap does not leaks native memory.
      metricsMemoryUnit: "KiB",
      before,
      after: { metrics: app.getAppMetrics(), mainMemory: process.memoryUsage() },
    })
    const complete = snapshots.every((snapshot) => !("error" in snapshot)) && !("error" in native)
    ctx.log.write(complete ? "info" : "warn", "heap snapshots captured", { directory, complete })

    return { directory, complete }
  }

  const enqueue = (directory: string, includeServer: boolean) => {
    const run = queue.tail.then(() => capture(directory, includeServer))
    queue.tail = run.catch(() => undefined)

    return run
  }

  ctx.provide(HeapSnapshots, {
    // A window that closes meanwhile does not cancel the capture.
    write: () => enqueue(app.getPath("downloads"), true),
  })

  if (!debugBuild(ctx.build)) return

  // The environment turns diagnostics on for this launch; otherwise the debug bar's stored toggle does.
  const envInterval = memoryLogInterval(process.env.OPENCODE_DESKTOP_MEMORY_LOG)
  const stored = ctx.stores.memory
  const running: Running = {}
  const directory = process.platform === "win32" ? undefined : snapshotDirectory(process.env)
  let capturing = false

  const onSignal = () => {
    // Signals coalesce while a capture is running; repeated signals must not fill the disk with queued dumps.
    if (!directory || capturing || ctx.scope.signal.aborted) return
    capturing = true
    void enqueue(directory, signalIncludesServer(process.env))
      .catch((error: Error) => ctx.log.write("error", "heap snapshot capture failed", { error: error.message }))
      .finally(() => {
        capturing = false
      })
  }

  const start = () => {
    const stopLog = startMemoryLog(envInterval ?? 30_000, ctx.log)

    if (!directory) return stopLog

    // Installed the first time diagnostics turn on, and kept: a script's late signal while they are off, or while
    // the extension reloads, is logged and ignored instead of killing the app.
    ProcessSignal.install("SIGUSR2", () => ctx.log.write("warn", "heap snapshot signal ignored: diagnostics are off"))
    const unsubscribe = ProcessSignal.subscribe("SIGUSR2", onSignal)
    ctx.log.write("info", "heap snapshot signal enabled", { pid: process.pid, signal: "SIGUSR2", directory })

    return () => {
      unsubscribe()
      stopLog()
    }
  }

  const sync = () => {
    const on = envInterval !== undefined || stored.value

    if (on && !running.stop) running.stop = start()

    if (on || !running.stop) return
    running.stop()
    running.stop = undefined
  }

  // Started before the Ipc is provided, so the first state windows receive already says whether diagnostics run.
  sync()
  ctx.scope.addFinalizer(() => running.stop?.())

  const provider = ctx.provide(MemoryDiagnostics, {
    state: () => ({ on: running.stop !== undefined, env: envInterval !== undefined }),
    set: (enabled) => {
      stored.set(enabled)
      sync()
      provider.changed()
    },
  })
}

// Chromium's own breakdown of every process's memory: what a heap snapshot cannot show (images, layout, compositor
// layers, GPU). Fails when something else is tracing, such as DevTools recording a performance profile.
async function recordNative(directory: string) {
  const file = path.join(directory, "memory-infra.json")

  return (
    contentTracing
      .startRecording(traceConfig)
      // The first detailed dump arrives within a periodic interval of starting.
      .then(() => new Promise((resolve) => setTimeout(resolve, 2_500)))
      .then(() => contentTracing.stopRecording(file))
      .then(async () => ({ file: path.basename(file), summary: summarize(await readFile(file, "utf8")) }))
      .catch((error: Error) => ({ error: error.message }))
  )
}

async function describeWindow(window: BrowserWindow) {
  const contents = window.webContents

  // A hung or busy renderer never answers, and the snapshots wait for this step, so give up after a few seconds.
  const page = await Promise.race([
    contents.executeJavaScript(pageStatsScript).then(decodePageStats),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("The window did not answer within 3 seconds.")), 3_000),
    ),
  ]).catch((error: Error) => ({ error: error.message }))

  return {
    window: window.id,
    pid: contents.getOSProcessId(),
    title: window.getTitle(),
    contentSize: window.getContentSize(),
    scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
    zoomFactor: contents.getZoomFactor(),
    page,
  }
}

function captureWindow(window: BrowserWindow, directory: string) {
  const contents = window.webContents
  const pid = contents.getOSProcessId()
  const file = `window-${window.id}-${pid}.heapsnapshot`

  return contents.takeHeapSnapshot(path.join(directory, file)).then(
    (): Snapshot => ({ process: "window", pid, window: window.id, file }),
    (error: Error): Snapshot => ({ process: "window", pid, window: window.id, error: error.message }),
  )
}

function write<Value>(directory: string, file: string, value: Value) {
  return writeFile(path.join(directory, file), JSON.stringify(value, null, 2), { mode: 0o600 })
}

function mibs(bytes: Readonly<Record<string, number>>) {
  return Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, Math.round((value / 1048576) * 10) / 10]))
}

export default setup
