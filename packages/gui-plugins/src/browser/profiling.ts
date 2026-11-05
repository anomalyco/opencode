import type { WebContents } from "electron"
import { Browser } from "@opencode/plugin-browser/rpc"
import { gzipSync, gunzipSync } from "node:zlib"
import { Schema } from "effect"
import type { Cdp } from "./cdp"
import type { BrowserFiles } from "./files"
import { analyzeCpu, analyzeTrace, parseHeap } from "./analysis"
import {
  createProfilingState,
  isTraceStoppingAttempt,
  selectProfilingTarget,
  transitionProfiling,
  type CpuCapture,
  type ProfilingEffect,
  type ProfilingEvent,
  type ProfilingRefusal,
  type ProfilingTimer,
  type Settled,
  type SharedTrace,
  type TraceCapture,
} from "./profiling-machine"

const refusals: Record<ProfilingRefusal, string> = {
  "trace-active-here":
    "A performance trace is already active in this tab. Use browser.trace.stop({tabID}) to finish it before starting another.",
  "trace-active-elsewhere":
    "Another tab owns the active performance trace. Wait for its owner to finish; do not stop or replace another tab's recording.",
  "no-trace":
    "This tab has no performance trace to stop. Call browser.trace.start({tabID}), perform the interaction to inspect, then browser.trace.stop({tabID}).",
  "cpu-active":
    "A CPU profile is already active in this tab. Use browser.cpu.stop({tabID}) before starting another profile.",
  "no-cpu":
    "No CPU profile has been started in this tab. Call browser.cpu.start({tabID}), perform the interaction to inspect, then browser.cpu.stop({tabID}).",
  "heap-active":
    "A heap snapshot is already being captured in this tab. Await that call before taking another; do not capture the same tab's heaps in parallel.",
  closed:
    "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID; do not reuse the closed tab's refs.",
}

const TRACE_FLUSH_TIMEOUT =
  "Chromium did not finish flushing the trace within 10 seconds. No complete export is confirmed. Check browser.files.list({tabID}); do not start another recording until the current trace has finished or the user resolves the failure."

const CPU_STOP_TIMEOUT =
  "Chromium did not stop the CPU profile within 10 seconds. No profile export is confirmed. Check browser.files.list({tabID}) before starting another profile; do not repeat the stop."

const HEAP_TIMEOUT =
  "Heap snapshot did not finish within 30 seconds. No snapshot is confirmed. Use a smaller page/test case or ask the user to inspect the heap with desktop developer tools; do not repeat the same capture unchanged."

/** Only one trace records across every tab of the app; `shared.trace` names the page that owns it. */
export function createProfiling(
  contents: WebContents,
  cdp: Cdp,
  files: BrowserFiles,
  source: () => readonly string[],
  shared: { trace?: SharedTrace },
) {
  let profilingState = createProfilingState(crypto.randomUUID())
  const timers = new Map<ProfilingTimer, ReturnType<typeof setTimeout>>()
  const traceStarts = new Map<number, PromiseWithResolvers<undefined>>()
  const traceStops = new Map<number, PromiseWithResolvers<TraceCapture>>()
  const cpuStarts = new Map<number, PromiseWithResolvers<undefined>>()
  const cpuStops = new Map<number, PromiseWithResolvers<CpuCapture>>()
  const heaps = new Map<number, PromiseWithResolvers<Browser.FileID>>()
  const disposed = Promise.withResolvers<void>()

  const dispatch = (event: ProfilingEvent) => {
    const next = transitionProfiling(profilingState, shared.trace, event)
    profilingState = next.state
    shared.trace = next.shared
    next.effects.forEach(run)

    return next.reply
  }

  // A request waits for the settle of the attempt it joined, or fails at once.
  const request = <T>(event: ProfilingEvent, waiters: Map<number, PromiseWithResolvers<T>>) => {
    const reply = dispatch(event)

    if (reply?.status === "pending") return waiter(waiters, reply.attempt).promise

    return Promise.reject(new Error(refusals[reply?.refusal ?? "closed"]))
  }

  const run = (effect: ProfilingEffect) => {
    switch (effect.type) {
      case "start-trace":
        void cdp
          .send("Tracing.start", {
            transferMode: "ReturnAsStream",
            traceConfig: {
              recordMode: "recordUntilFull",
              traceBufferSizeInKb: 8192,
              includedCategories: [
                "devtools.timeline",
                "disabled-by-default-devtools.timeline",
                "disabled-by-default-devtools.timeline.stack",
                "v8.execute",
                "blink.user_timing",
                "disabled-by-default-v8.cpu_profiler",
              ],
              excludedCategories: ["*"],
            },
          })
          .then(
            () => dispatch({ type: "trace.start.succeeded", attempt: effect.attempt, now: performance.now() }),
            (error: unknown) => dispatch({ type: "trace.start.failed", attempt: effect.attempt, error }),
          )
        return
      case "end-trace":
        void exportTrace(effect).then(
          (value) => dispatch({ type: "trace.stop.succeeded", attempt: effect.attempt, value }),
          (error: unknown) => dispatch({ type: "trace.stop.failed", attempt: effect.attempt, error }),
        )
        return
      case "start-cpu":
        void cdp
          .send("Profiler.enable")
          .then(() => cdp.send("Profiler.start"))
          .then(
            () => dispatch({ type: "cpu.start.succeeded", attempt: effect.attempt }),
            (error: unknown) => dispatch({ type: "cpu.start.failed", attempt: effect.attempt, error }),
          )
        return
      case "stop-cpu":
        void cdp
          .send("Profiler.stop")
          .then(async ({ profile }) => ({
            id: await files.save("profile.cpuprofile", "application/json", Buffer.from(JSON.stringify(profile)), [
              ...effect.resources,
            ]),
            durationMs: (profile.endTime - profile.startTime) / 1000,
          }))
          .then(
            (value) => dispatch({ type: "cpu.stop.succeeded", attempt: effect.attempt, value }),
            (error: unknown) => dispatch({ type: "cpu.stop.failed", attempt: effect.attempt, error }),
          )
        return
      case "capture-heap":
        void captureHeap(effect.resources).then(
          (id) => dispatch({ type: "heap.succeeded", attempt: effect.attempt, id }),
          (error: unknown) => dispatch({ type: "heap.failed", attempt: effect.attempt, error }),
        )
        return
      case "schedule":
        clearTimeout(timers.get(effect.timer))
        timers.set(
          effect.timer,
          setTimeout(() => dispatch(expired(effect.timer, effect.attempt)), effect.delayMs),
        )
        return
      case "cancel":
        clearTimeout(timers.get(effect.timer))
        timers.delete(effect.timer)
        return
      case "settle-trace-start":
        return settle(traceStarts, effect.attempt, effect.outcome)
      case "settle-trace-stop":
        return settle(traceStops, effect.attempt, effect.outcome)
      case "settle-cpu-start":
        return settle(cpuStarts, effect.attempt, effect.outcome)
      case "settle-cpu-stop":
        return settle(cpuStops, effect.attempt, effect.outcome)
      case "settle-heap":
        return settle(heaps, effect.attempt, effect.outcome)
      case "settle-dispose":
        disposed.resolve()
    }
  }

  const exportTrace = async (effect: Extract<ProfilingEffect, { type: "end-trace" }>): Promise<TraceCapture> => {
    const complete = Promise.withResolvers<{ stream?: string; dataLossOccurred: boolean }>()
    const off = cdp.on("Tracing.tracingComplete", (event) => complete.resolve(event))

    try {
      const result = await cdp.send("Tracing.end").then(() => complete.promise)

      // The stop timed out before Chromium completed; a completion now may belong to a later trace, whose stream
      // this export must not read or close.
      if (!isTraceStoppingAttempt(profilingState, effect.attempt)) throw new Error(TRACE_FLUSH_TIMEOUT)

      if (!result.stream)
        throw new Error(
          "Chromium stopped tracing without returning a trace stream. No export is available. Check desktop/plugin compatibility and report the failure; repeating trace.stop cannot recover a missing stream.",
        )
      const chunks: Buffer[] = []
      let bytes = 0

      try {
        while (true) {
          // The stop timed out meanwhile and already answered; stop reading.
          if (!isTraceStoppingAttempt(profilingState, effect.attempt)) throw new Error(TRACE_FLUSH_TIMEOUT)
          const part = await cdp.send("IO.read", { handle: result.stream, size: 256 * 1024 })
          const buffer = Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8")
          bytes += buffer.byteLength

          if (bytes > 64 * 1024 * 1024)
            throw new Error(
              "Trace exceeded its 64 MiB desktop capture limit. Record a shorter interaction with a smaller durationMs in browser.trace.start; do not repeat the same recording unchanged.",
            )
          chunks.push(buffer)

          if (part.eof) break
        }
      } finally {
        await cdp.send("IO.close", { handle: result.stream })
      }

      const raw = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Struct({ traceEvents: Schema.Array(Schema.Record(Schema.String, Schema.Json)) })),
      )(Buffer.concat(chunks).toString("utf8"))

      // A CDP trace is browser-wide. Export only this renderer process, never
      // the application renderer or another session's process metadata.
      const traceEvents = raw.traceEvents.filter((event) => event.pid === effect.pid)

      const id = await files.save(
        "trace.json.gz",
        "application/gzip",
        gzipSync(
          JSON.stringify({
            traceEvents,
            metadata: { source: "opencode", scope: "renderer-process", processId: effect.pid },
          }),
        ),
        [...effect.resources],
      )

      return {
        id,
        durationMs: effect.durationMs,
        incomplete: result.dataLossOccurred || contents.isDestroyed() || contents.getOSProcessId() !== effect.pid,
      }
    } finally {
      off()
    }
  }

  const captureHeap = async (resources: readonly string[]) => {
    const chunks: string[] = []
    let size = 0
    let overflow = false

    const off = cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => {
      size += Buffer.byteLength(chunk)

      if (size > 128 * 1024 * 1024) overflow = true

      if (!overflow) chunks.push(chunk)
    })

    try {
      await cdp.send("HeapProfiler.enable")
      await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false })
    } finally {
      off()
    }

    if (overflow)
      throw new Error(
        "Heap snapshot exceeded the 128 MiB desktop capture limit. Use a smaller page/test case or ask the user to inspect the heap with desktop developer tools; this tool has no size override.",
      )

    return files.save("heap.heapsnapshot.gz", "application/gzip", gzipSync(chunks.join("")), [
      ...resources,
      ...source(),
    ])
  }

  const json = async (id: Browser.FileID) => {
    const file = await files.transfer(id)

    try {
      const data = Buffer.from(file.data)

      return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
        (file.name.endsWith(".gz") ? gunzipSync(data, { maxOutputLength: 128 * 1024 * 1024 }) : data).toString("utf8"),
      )
    } catch (error) {
      throw new Error(
        "Selected file cannot be decoded as a JSON capture, or expands beyond the 128 MiB analysis limit. Call browser.files.list({tabID}) and choose the fileID from the matching trace, CPU, or heap capture, not a screenshot/download. Do not retry the same invalid file.",
        { cause: error },
      )
    }
  }

  cdp.on("Page.frameNavigated", ({ frame }) => dispatch({ type: "frame.navigated", url: frame.url }))

  return {
    target(type: "trace" | "cpu"): Browser.Target {
      return selectProfilingTarget(profilingState, type)
    },
    startTrace(durationMs = 10_000) {
      return request(
        {
          type: "trace.start.requested",
          key: crypto.randomUUID(),
          pid: contents.getOSProcessId(),
          durationMs,
          resources: source(),
        },
        traceStarts,
      )
    },
    stopTrace() {
      return request({ type: "trace.stop.requested", now: performance.now() }, traceStops)
    },
    startCpu() {
      return request({ type: "cpu.start.requested", key: crypto.randomUUID(), resources: source() }, cpuStarts)
    },
    stopCpu() {
      return request({ type: "cpu.stop.requested" }, cpuStops)
    },
    heap() {
      return request({ type: "heap.requested", resources: source() }, heaps)
    },
    async analyze(
      action: Extract<
        Browser.Action,
        { type: "trace.analyze" | "cpu.analyze" | "heap.summary" | "heap.query" | "heap.object" | "heap.compare" }
      >,
    ) {
      if (action.type === "heap.compare") {
        const before = parseHeap(await json(action.before)).classes
        const after = parseHeap(await json(action.after)).classes

        return {
          classes: Array.from(new Set([...before.keys(), ...after.keys()]))
            .map((name) => ({
              name,
              countDelta: (after.get(name)?.count ?? 0) - (before.get(name)?.count ?? 0),
              bytesDelta: (after.get(name)?.bytes ?? 0) - (before.get(name)?.bytes ?? 0),
            }))
            .filter((item) => item.countDelta || item.bytesDelta)
            .sort((a, b) => Math.abs(b.bytesDelta) - Math.abs(a.bytesDelta))
            .slice(0, action.limit ?? 100),
        }
      }

      const value = await json(action.fileID)

      if (action.type === "trace.analyze") return analyzeTrace(value, action.limit)

      if (action.type === "cpu.analyze") return analyzeCpu(value, action.limit)
      const heap = parseHeap(value)

      if (action.type === "heap.summary") return heap.summary(action.limit)

      if (action.type === "heap.query") return heap.query(action.name, action.limit)

      return heap.object(action.id, action.limit)
    },
    /** Stops this page's trace and CPU profile; resolves once both settled, each within its stop timeout. */
    dispose() {
      dispatch({ type: "dispose.requested", now: performance.now() })

      return disposed.promise
    },
  }
}

/** The attempt's waiter; a new attempt drops the settled waiters of earlier ones. */
function waiter<T>(waiters: Map<number, PromiseWithResolvers<T>>, attempt: number) {
  const existing = waiters.get(attempt)

  if (existing) return existing
  const created = Promise.withResolvers<T>()
  // A recording its timer stopped settles with nobody waiting; a later stop still reads the outcome.
  created.promise.catch(() => undefined)
  waiters.clear()
  waiters.set(attempt, created)

  return created
}

function settle<T>(waiters: Map<number, PromiseWithResolvers<T>>, attempt: number, outcome: Settled<T>) {
  const target = waiter(waiters, attempt)

  if (outcome.ok) return target.resolve(outcome.value)
  target.reject(outcome.error)
}

function expired(timer: ProfilingTimer, attempt: number): ProfilingEvent {
  switch (timer) {
    case "trace.duration":
      return { type: "trace.duration.elapsed", attempt, now: performance.now() }
    case "trace.stop":
      return { type: "trace.stop.failed", attempt, error: new Error(TRACE_FLUSH_TIMEOUT) }
    case "cpu.duration":
      return { type: "cpu.duration.elapsed", attempt }
    case "cpu.stop":
      return { type: "cpu.stop.failed", attempt, error: new Error(CPU_STOP_TIMEOUT) }
    case "heap":
      return { type: "heap.failed", attempt, error: new Error(HEAP_TIMEOUT) }
  }
}
