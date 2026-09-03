import type { WebContents } from "electron"
import { Browser } from "@opencode-ai/plugin-browser/rpc"
import { gzipSync, gunzipSync } from "node:zlib"
import { Schema } from "effect"
import type { Cdp } from "./cdp"
import type { BrowserFiles } from "./files"
import { analyzeCpu, analyzeTrace, parseHeap } from "./analysis"

let recording:
  | {
      owner: WebContents
      pid: number
      started: number
      timer?: ReturnType<typeof setTimeout>
      finish: () => Promise<{ id: Browser.FileID; durationMs: number; incomplete: boolean }>
    }
  | undefined

export function createProfiling(contents: WebContents, cdp: Cdp, files: BrowserFiles) {
  let trace: Promise<{ id: Browser.FileID; durationMs: number; incomplete: boolean }> | undefined
  let cpu:
    | {
        started: number
        timer?: ReturnType<typeof setTimeout>
        result?: Promise<{ id: Browser.FileID; durationMs: number }>
      }
    | undefined
  let takingHeap = false
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
  const stopCpu = () => {
    if (!cpu)
      return Promise.reject(
        new Error(
          "No CPU profile has been started in this tab. Call browser.cpu.start({tabID}), perform the interaction to inspect, then browser.cpu.stop({tabID}).",
        ),
      )
    if (cpu.result) return cpu.result
    clearTimeout(cpu.timer)
    cpu.result = cdp.send("Profiler.stop").then(async ({ profile }) => ({
      id: await files.save("profile.cpuprofile", "application/json", Buffer.from(JSON.stringify(profile))),
      durationMs: (profile.endTime - profile.startTime) / 1000,
    }))
    return cpu.result
  }
  return {
    async startTrace(durationMs = 10_000) {
      if (recording)
        throw new Error(
          recording.owner === contents
            ? "A performance trace is already active in this tab. Use browser.trace.stop({tabID}) to finish it before starting another."
            : "Another tab owns the active performance trace. Wait for its owner to finish; do not stop or replace another tab's recording.",
        )
      const complete = Promise.withResolvers<{ stream?: string; dataLossOccurred: boolean }>()
      const off = cdp.on("Tracing.tracingComplete", (event) => complete.resolve(event))
      const owner = {
        owner: contents,
        pid: contents.getOSProcessId(),
        started: performance.now(),
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
        finish: () => {
          if (trace) return trace
          trace = (async () => {
            clearTimeout(owner.timer)
            const durationMs = performance.now() - owner.started
            const deadline = Promise.withResolvers<never>()
            const timeout = setTimeout(
              () =>
                deadline.reject(
                  new Error(
                    "Chromium did not finish flushing the trace within 10 seconds. No complete export is confirmed. Check browser.files.list({tabID}); do not start another recording until the current trace has finished or the user resolves the failure.",
                  ),
                ),
              10_000,
            )
            try {
              const result = await Promise.race([
                cdp.send("Tracing.end").then(() => complete.promise),
                deadline.promise,
              ])
              if (!result.stream)
                throw new Error(
                  "Chromium stopped tracing without returning a trace stream. No export is available. Check desktop/plugin compatibility and report the failure; repeating trace.stop cannot recover a missing stream.",
                )
              const chunks: Buffer[] = []
              let bytes = 0
              try {
                while (true) {
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
                Schema.fromJsonString(
                  Schema.Struct({ traceEvents: Schema.Array(Schema.Record(Schema.String, Schema.Json)) }),
                ),
              )(Buffer.concat(chunks).toString("utf8"))
              // A CDP trace is browser-wide. Export only this renderer process, never
              // the application renderer or another session's process metadata.
              const traceEvents = raw.traceEvents.filter((event) => event.pid === owner.pid)
              const id = await files.save(
                "trace.json.gz",
                "application/gzip",
                gzipSync(
                  JSON.stringify({
                    traceEvents,
                    metadata: { source: "opencode", scope: "renderer-process", processId: owner.pid },
                  }),
                ),
              )
              return {
                id,
                durationMs,
                incomplete:
                  result.dataLossOccurred || contents.isDestroyed() || contents.getOSProcessId() !== owner.pid,
              }
            } finally {
              clearTimeout(timeout)
              off()
              if (recording === owner) recording = undefined
            }
          })()
          return trace
        },
      }
      recording = owner
      trace = undefined
      try {
        await cdp.send("Tracing.start", {
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
        owner.timer = setTimeout(() => {
          void owner.finish().catch(() => undefined)
        }, durationMs)
      } catch (error) {
        off()
        if (recording === owner) recording = undefined
        throw error
      }
    },
    stopTrace() {
      if (recording?.owner === contents) return recording.finish()
      if (trace) return trace
      return Promise.reject(
        new Error(
          "This tab has no performance trace to stop. Call browser.trace.start({tabID}), perform the interaction to inspect, then browser.trace.stop({tabID}).",
        ),
      )
    },
    async startCpu() {
      if (cpu && !cpu.result)
        throw new Error(
          "A CPU profile is already active in this tab. Use browser.cpu.stop({tabID}) before starting another profile.",
        )
      await cdp.send("Profiler.enable")
      await cdp.send("Profiler.start")
      cpu = { started: Date.now() }
      cpu.timer = setTimeout(() => {
        void stopCpu().catch(() => undefined)
      }, 30_000)
    },
    stopCpu,
    async heap() {
      if (takingHeap)
        throw new Error(
          "A heap snapshot is already being captured in this tab. Await that call before taking another; do not capture the same tab's heaps in parallel.",
        )
      takingHeap = true
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
        takingHeap = false
        off()
      }
      if (overflow)
        throw new Error(
          "Heap snapshot exceeded the 128 MiB desktop capture limit. Use a smaller page/test case or ask the user to inspect the heap with desktop developer tools; this tool has no size override.",
        )
      return files.save("heap.heapsnapshot.gz", "application/gzip", gzipSync(chunks.join("")))
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
    async dispose() {
      if (recording?.owner === contents) await recording.finish().catch(() => undefined)
      if (cpu && !cpu.result) await stopCpu().catch(() => undefined)
    },
  }
}
