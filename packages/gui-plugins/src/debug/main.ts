import { app, contentTracing, screen, type BrowserWindow } from "electron"
import { Schema } from "effect"
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { getHeapSpaceStatistics, getHeapStatistics, writeHeapSnapshot } from "node:v8"
import type { Plugin } from "@opencode/plugin/gui/main"
import { HeapSnapshots, MemoryDiagnostics } from "./contract"
import {
  createHeapCaptureState,
  transitionHeapCapture,
  type HeapCaptureEffect,
  type HeapCaptureEvent,
  type HeapCaptureResult,
} from "./heap-machine"
import { summarize, traceConfig } from "./memory-infra"
import { collectMemorySample, memoryLogFile } from "./memory-log"
import {
  createMemoryDiagnosticsState,
  isMemoryDiagnosticsOn,
  isRendererProbing,
  transitionMemoryDiagnostics,
  type MemoryDiagnosticsEffect,
  type MemoryDiagnosticsEvent,
} from "./memory-machine"
import { debugBuild, memoryLogInterval } from "./options"
import { captureServer } from "./server-heap"
import { signalIncludesServer, snapshotDirectory } from "./signal"
import { ProcessSignal } from "@opencode/util/process-signal"

/** A desktop process the manifest lists: the file written, or why there is none. */
type Snapshot = { readonly process: "main" | "window"; readonly pid: number; readonly window?: number } & (
  | { readonly file: string }
  | { readonly error: string }
)

/** How long a step that waits on another process may take before the manifest records it as failed. */
const SNAPSHOT_TIMEOUT_MS = 5 * 60_000

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

const setup: Plugin.MainSetup = (ctx) => {
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
      includeServer
        ? captureServer(
            ctx.serverEndpoints.get("sidecar"),
            directory,
            AbortSignal.any([ctx.signal, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)]),
          )
        : undefined,
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

    const gpu = await within(app.getGPUInfo("basic"), 15_000, "The GPU process did not answer within 15 seconds.").catch(
      (error: Error) => ({ error: error.message }),
    )

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

  let heapState = createHeapCaptureState()

  const dispatchHeap = (event: HeapCaptureEvent) => {
    const next = transitionHeapCapture(heapState, event)

    heapState = next.state
    next.effects.forEach(
      (effect) =>
        void Promise.try(() => runHeap(effect)).catch((cause: unknown) =>
          ctx.log.write("error", "heap snapshot queue effect failed", { error: String(cause) }),
        ),
    )
  }

  const runHeap = (effect: HeapCaptureEffect) => {
    if (effect.type === "replies.settle") {
      const outcome = effect.outcome

      return effect.replies.forEach((reply) => (outcome.ok ? reply.resolve(outcome.result) : reply.reject(outcome.error)))
    }

    if (effect.type === "signal.failed") {
      return ctx.log.write("error", "heap snapshot capture failed", { error: effect.error })
    }

    void Promise.try(() => capture(effect.root, effect.includeServer)).then(
      (result) => dispatchHeap({ type: "capture.succeeded", attempt: effect.attempt, result }),
      (cause: unknown) =>
        dispatchHeap({
          type: "capture.failed",
          attempt: effect.attempt,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        }),
    )
  }

  ctx.onCleanup(() => dispatchHeap({ type: "disposed" }))

  ctx.provide(HeapSnapshots, {
    // A window that closes meanwhile does not cancel the capture.
    write: () =>
      new Promise<HeapCaptureResult>((resolve, reject) =>
        dispatchHeap({
          type: "command.requested",
          root: app.getPath("downloads"),
          includeServer: true,
          reply: { resolve, reject },
        }),
      ),
  })

  if (!debugBuild(ctx.app)) return

  // The environment turns diagnostics on for this launch; otherwise the debug bar's stored toggle does.
  const envInterval = memoryLogInterval(process.env.OPENCODE_DESKTOP_MEMORY_LOG)
  const interval = envInterval ?? 30_000
  // Without the launch switch, Chromium quantizes renderer heap sizes and refreshes them rarely.
  const precise = app.commandLine.hasSwitch("enable-precise-memory-info")
  // Whether the debug bar turned memory diagnostics on.
  const stored = ctx.storage.store("memory", { schema: Schema.Boolean, initial: false })
  const directory = process.platform === "win32" ? undefined : snapshotDirectory(process.env)
  let memoryState = createMemoryDiagnosticsState()
  let memoryTimer: ReturnType<typeof setTimeout> | undefined
  let memoryFile = ""
  let unsubscribeSignal: (() => void) | undefined

  // Signals coalesce in the queue; repeated signals must not fill the disk with queued dumps.
  const onSignal = () => {
    if (!directory) return
    dispatchHeap({ type: "signal.received", root: directory, includeServer: signalIncludesServer(process.env) })
  }

  const dispatchMemory = (event: MemoryDiagnosticsEvent) => {
    const next = transitionMemoryDiagnostics(memoryState, event)

    memoryState = next.state
    next.effects.forEach(
      (effect) =>
        void Promise.try(() => runMemory(effect)).catch((cause: unknown) =>
          ctx.log.write("error", "memory diagnostics effect failed", { error: String(cause) }),
        ),
    )
  }

  const runMemory = (effect: MemoryDiagnosticsEffect) => {
    if (effect.type === "log.start") {
      memoryFile = memoryLogFile()
      ctx.log.write("info", "memory diagnostics started", { file: memoryFile, intervalMs: interval, precise })

      if (!directory) return

      // Installed the first time diagnostics turn on, and kept: a script's late signal while they are off, or while
      // the plugin reloads, is logged and ignored instead of killing the app.
      ProcessSignal.install("SIGUSR2", () => ctx.log.write("warn", "heap snapshot signal ignored: diagnostics are off"))
      unsubscribeSignal = ProcessSignal.subscribe("SIGUSR2", onSignal)
      ctx.log.write("info", "heap snapshot signal enabled", { pid: process.pid, signal: "SIGUSR2", directory })

      return
    }

    if (effect.type === "log.stop") {
      unsubscribeSignal?.()
      unsubscribeSignal = undefined
      ctx.log.write("info", "memory diagnostics stopped", { file: memoryFile })

      return
    }

    if (effect.type === "timer.schedule") {
      memoryTimer = setTimeout(() => dispatchMemory({ type: "tick", run: effect.run }), interval)

      return
    }

    if (effect.type === "timer.cancel") return clearTimeout(memoryTimer)

    if (effect.type === "sample.report") {
      return ctx.log.write("error", "memory diagnostics sample failed", { error: effect.error })
    }

    const failed = (cause: unknown) =>
      dispatchMemory({
        type: "sample.failed",
        attempt: effect.attempt,
        error: cause instanceof Error ? cause.message : String(cause),
      })

    if (effect.type === "sample.write") {
      void Promise.try(() => appendFile(memoryFile, effect.line, { mode: 0o600 })).then(
        () => dispatchMemory({ type: "sample.written", attempt: effect.attempt }),
        failed,
      )

      return
    }

    void Promise.try(() =>
      collectMemorySample(memoryFile, precise, {
        pending: (contentsId) => isRendererProbing(memoryState, contentsId),
        started: (contentsId) => dispatchMemory({ type: "probe.started", contentsId }),
        settled: (contentsId) => dispatchMemory({ type: "probe.settled", contentsId }),
      }),
    ).then((line) => dispatchMemory({ type: "sample.collected", attempt: effect.attempt, line }), failed)
  }

  const sync = () => dispatchMemory({ type: "synced", enabled: envInterval !== undefined || stored.value })

  // Started before the Ipc is provided, so the first state windows receive already says whether diagnostics run.
  sync()
  ctx.onCleanup(() => dispatchMemory({ type: "disposed" }))

  const provider = ctx.provide(MemoryDiagnostics, {
    state: () => ({ on: isMemoryDiagnosticsOn(memoryState), env: envInterval !== undefined }),
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

  return within(
    contentTracing
      .startRecording(traceConfig)
      // The first detailed dump arrives within a periodic interval of starting.
      .then(() => new Promise((resolve) => setTimeout(resolve, 2_500)))
      .then(() => contentTracing.stopRecording(file))
      .then(async () => ({ file: path.basename(file), summary: summarize(await readFile(file, "utf8")) })),
    15_000,
    "The memory trace did not finish within 15 seconds.",
  ).catch((error: Error) => ({ error: error.message }))
}

async function describeWindow(window: BrowserWindow) {
  const contents = window.webContents

  // A hung or busy renderer never answers, and the snapshots wait for this step, so give up after a few seconds.
  const page = await within(
    contents.executeJavaScript(pageStatsScript).then(decodePageStats),
    3_000,
    "The window did not answer within 3 seconds.",
  ).catch((error: Error) => ({ error: error.message }))

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

  // A hung renderer is recorded as failed, so the other windows and main are still captured.
  return within(
    contents.takeHeapSnapshot(path.join(directory, file)),
    SNAPSHOT_TIMEOUT_MS,
    "The window did not write its heap snapshot within 5 minutes.",
  ).then(
    (): Snapshot => ({ process: "window", pid, window: window.id, file }),
    (error: Error): Snapshot => ({ process: "window", pid, window: window.id, error: error.message }),
  )
}

/** Rejects with `message` when `promise` takes longer than `ms`. */
function within<Value>(promise: Promise<Value>, ms: number, message: string) {
  let deadline: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error(message)), ms)
    }),
  ]).finally(() => clearTimeout(deadline))
}

function write<Value>(directory: string, file: string, value: Value) {
  return writeFile(path.join(directory, file), JSON.stringify(value, null, 2), { mode: 0o600 })
}

function mibs(bytes: Readonly<Record<string, number>>) {
  return Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, Math.round((value / 1048576) * 10) / 10]))
}

export default setup
