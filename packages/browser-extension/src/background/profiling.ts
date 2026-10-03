// Performance traces, CPU profiles, and heap snapshots for one tab. Ported from
// packages/gui-extensions/src/browser/profiling.ts: the desktop filters traces by the WebContents'
// process id; here the renderer process comes from the trace's own TracingStartedInBrowser record.
import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import { analyzeCpu, analyzeTrace, parseHeap } from "./analysis"
import type { Cdp } from "./cdp"
import { gunzip, gzip, type BrowserFiles } from "./files"

export type Recording = {
  owner: number
  started: number
  timer?: ReturnType<typeof setTimeout>
}

/** Only one trace records at a time across the session's tabs; `shared` holds it. */
export function createProfiling(input: {
  tabId: number
  cdp: Cdp
  files: BrowserFiles
  source: () => readonly string[]
  shared: { recording?: Recording }
}) {
  const cdp = input.cdp
  const files = input.files
  let trace: Promise<{ id: Browser.FileID; durationMs: number; incomplete: boolean }> | undefined
  let traceResources = new Set<string>()
  let traceID = ""
  let cpu:
    | {
        started: number
        id: string
        resources: Set<string>
        result?: Promise<{ id: Browser.FileID; durationMs: number }>
      }
    | undefined
  let takingHeap = false
  cdp.on("Page.frameNavigated", ({ frame }) => {
    if (input.shared.recording?.owner === input.tabId) traceResources.add(frame.url)
    if (cpu && !cpu.result) cpu.resources.add(frame.url)
  })
  const json = async (id: Browser.FileID) => {
    const file = await files.transfer(id)
    try {
      const text = file.name.endsWith(".gz") ? await gunzip(file.data, 128 * 1024 * 1024) : new TextDecoder().decode(file.data)
      return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(text)
    } catch (error) {
      throw new Error(
        "Selected file cannot be decoded as a JSON capture, or expands beyond the 128 MiB analysis limit. Call browser.files.list({tabID}) and choose the fileID from the matching trace, CPU, or heap capture, not a screenshot/download. Do not retry the same invalid file.",
        { cause: error },
      )
    }
  }
  let stopCpu = (): Promise<{ id: Browser.FileID; durationMs: number }> =>
    Promise.reject(
      new Error(
        "No CPU profile has been started in this tab. Call browser.cpu.start({tabID}), perform the interaction to inspect, then browser.cpu.stop({tabID}).",
      ),
    )
  let stopTrace = (): Promise<{ id: Browser.FileID; durationMs: number; incomplete: boolean }> =>
    Promise.reject(
      new Error(
        "This tab has no performance trace to stop. Call browser.trace.start({tabID}), perform the interaction to inspect, then browser.trace.stop({tabID}).",
      ),
    )
  /**
   * Records a renderer-only trace. CPU profiles use it too: chrome.debugger does not expose the
   * Profiler or HeapProfiler domains to extensions, but the v8 sampling profiler writes into traces.
   */
  const record = async (categories: string[], durationMs: number, onTimeout: () => void) => {
    if (input.shared.recording)
      throw new Error(
        input.shared.recording.owner === input.tabId
          ? "A performance trace or CPU profile is already recording in this tab. Stop it (browser.trace.stop or browser.cpu.stop) before starting another."
          : "Another tab owns the active recording. Wait for its owner to finish; do not stop or replace another tab's recording.",
      )
    const complete = Promise.withResolvers<{ stream?: string; dataLossOccurred: boolean }>()
    const off = cdp.on("Tracing.tracingComplete", (event) => complete.resolve(event))
    const mainFrame = (await cdp.send("Page.getFrameTree")).frameTree.frame.id
    let finished: Promise<{ events: Record<string, Schema.Json>[]; pid?: number; durationMs: number; dataLoss: boolean }> | undefined
    const owner: Recording = { owner: input.tabId, started: performance.now() }
    const finish = () => {
      finished ??= (async () => {
        clearTimeout(owner.timer)
        const durationMs = performance.now() - owner.started
        const deadline = Promise.withResolvers<never>()
        const timeout = setTimeout(
          () =>
            deadline.reject(
              new Error(
                "Chromium did not finish flushing the recording within 10 seconds. No complete export is confirmed. Check browser.files.list({tabID}); do not start another recording until the current one has finished or the user resolves the failure.",
              ),
            ),
          10_000,
        )
        try {
          const result = await Promise.race([cdp.send("Tracing.end").then(() => complete.promise), deadline.promise])
          if (!result.stream)
            throw new Error(
              "Chromium stopped recording without returning a trace stream. No export is available. Report the failure; repeating stop cannot recover a missing stream.",
            )
          const chunks: string[] = []
          let bytes = 0
          try {
            while (true) {
              const part = await cdp.send("IO.read", { handle: result.stream, size: 256 * 1024 })
              const text = part.base64Encoded
                ? new TextDecoder().decode(Uint8Array.from(atob(part.data), (char) => char.charCodeAt(0)))
                : part.data
              bytes += text.length
              if (bytes > 64 * 1024 * 1024)
                throw new Error(
                  "Recording exceeded its 64 MiB capture limit. Record a shorter interaction; do not repeat the same recording unchanged.",
                )
              chunks.push(text)
              if (part.eof) break
            }
          } finally {
            await cdp.send("IO.close", { handle: result.stream }).catch(() => undefined)
          }
          const raw = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.Struct({ traceEvents: Schema.Array(Schema.Record(Schema.String, Schema.Json)) })),
          )(chunks.join(""))
          // A trace is browser-wide; keep only this tab's renderer process, never other sites' data.
          const pid = rendererProcess(raw.traceEvents, mainFrame)
          return {
            events: pid === undefined ? [] : raw.traceEvents.filter((event) => event.pid === pid),
            pid,
            durationMs,
            dataLoss: result.dataLossOccurred || pid === undefined,
          }
        } finally {
          clearTimeout(timeout)
          off()
          if (input.shared.recording === owner) input.shared.recording = undefined
        }
      })()
      return finished
    }
    input.shared.recording = owner
    try {
      await cdp.send("Tracing.start", {
        transferMode: "ReturnAsStream",
        traceConfig: {
          recordMode: "recordUntilFull",
          traceBufferSizeInKb: 8192,
          includedCategories: categories,
          excludedCategories: ["*"],
        },
      })
      owner.timer = setTimeout(onTimeout, durationMs)
    } catch (error) {
      off()
      if (input.shared.recording === owner) input.shared.recording = undefined
      throw error
    }
    return { owner, finish }
  }

  return {
    target(type: "trace" | "cpu"): Browser.Target {
      return {
        resources: (type === "trace" ? [...traceResources] : [...(cpu?.resources ?? [])]).sort(),
        key: type === "trace" ? traceID : (cpu?.id ?? ""),
      }
    },
    async startTrace(durationMs = 10_000) {
      trace = undefined
      traceResources = new Set(input.source())
      traceID = crypto.randomUUID()
      const recording = await record(
        [
          "devtools.timeline",
          "disabled-by-default-devtools.timeline",
          "disabled-by-default-devtools.timeline.stack",
          "v8.execute",
          "blink.user_timing",
          "disabled-by-default-v8.cpu_profiler",
        ],
        durationMs,
        () => void stopTrace().catch(() => undefined),
      )
      stopTrace = () => {
        trace ??= recording.finish().then(async (result) => ({
          id: files.save(
            "trace.json.gz",
            "application/gzip",
            await gzip(
              JSON.stringify({
                traceEvents: result.events,
                metadata: { source: "opencode", scope: "renderer-process", processId: result.pid },
              }),
            ),
            [...traceResources],
          ),
          durationMs: result.durationMs,
          incomplete: result.dataLoss,
        }))
        return trace
      }
    },
    stopTrace: () => stopTrace(),
    async startCpu() {
      if (cpu && !cpu.result)
        throw new Error("A CPU profile is already active in this tab. Use browser.cpu.stop({tabID}) before starting another profile.")
      const resources = new Set(input.source())
      // The timeline categories add TracingStartedInBrowser, which identifies this tab's renderer process.
      const recording = await record(
        ["disabled-by-default-v8.cpu_profiler", "devtools.timeline", "disabled-by-default-devtools.timeline"],
        30_000,
        () => void stopCpu().catch(() => undefined),
      )
      const state: NonNullable<typeof cpu> = { started: Date.now(), id: crypto.randomUUID(), resources }
      cpu = state
      stopCpu = () => {
        state.result ??= recording.finish().then((result) => {
          const profile = cpuProfile(result.events)
          if (!profile)
            throw new Error(
              "The CPU profile recorded no JavaScript samples. Perform the interaction while recording (for example browser.reload or clicks) and stop afterwards.",
            )
          return {
            id: files.save("profile.cpuprofile", "application/json", new TextEncoder().encode(JSON.stringify(profile)), [
              ...state.resources,
            ]),
            durationMs: (profile.endTime - profile.startTime) / 1000,
          }
        })
        return state.result
      }
    },
    stopCpu: () => stopCpu(),
    async heap(): Promise<Browser.FileID> {
      throw new Error(
        "Heap snapshots are not available from a browser extension: Chrome does not expose the HeapProfiler domain to extensions. Ask the user to take one in the browser's developer tools (Memory panel), or use the opencode desktop app's browser.",
      )
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
      if (input.shared.recording?.owner !== input.tabId) return
      await Promise.all([stopTrace().catch(() => undefined), cpu && !cpu.result ? stopCpu().catch(() => undefined) : undefined])
    },
  }
}

/** The renderer process that hosted the tab's main frame, from the trace's start record. */
function rendererProcess(events: ReadonlyArray<Record<string, unknown>>, mainFrame: string) {
  const started = events.find((event) => event.name === "TracingStartedInBrowser")
  const frames = (started?.args as { data?: { frames?: { frame?: string; processId?: number }[] } } | undefined)?.data?.frames
  return frames?.find((frame) => frame.frame === mainFrame)?.processId ?? frames?.find((frame) => frame.processId)?.processId
}

type ProfileNode = { id: number; callFrame: { functionName: string; url: string; lineNumber: number; columnNumber?: number; scriptId?: string | number }; parent?: number }

/**
 * Rebuilds a .cpuprofile from the sampling profiler's trace events (Profile + ProfileChunk), using the
 * thread with the most samples, normally the page's main thread.
 */
function cpuProfile(events: ReadonlyArray<Record<string, Schema.Json>>) {
  const threads = new Map<string, { startTime: number; nodes: Map<number, ProfileNode>; samples: number[]; deltas: number[] }>()
  for (const event of events) {
    const data = (event.args as { data?: Record<string, unknown> } | undefined)?.data
    const key = `${event.pid}:${event.id}`
    if (event.name === "Profile" && data) {
      threads.set(key, { startTime: Number(data.startTime ?? event.ts ?? 0), nodes: new Map(), samples: [], deltas: [] })
      continue
    }
    if (event.name !== "ProfileChunk" || !data) continue
    const thread = threads.get(key)
    if (!thread) continue
    const chunk = data.cpuProfile as { nodes?: ProfileNode[]; samples?: number[] } | undefined
    chunk?.nodes?.forEach((node) => thread.nodes.set(node.id, node))
    thread.samples.push(...(chunk?.samples ?? []))
    thread.deltas.push(...((data.timeDeltas as number[] | undefined) ?? []))
  }
  const thread = Array.from(threads.values()).sort((a, b) => b.samples.length - a.samples.length)[0]
  if (!thread?.samples.length) return undefined
  const children = new Map<number, number[]>()
  thread.nodes.forEach((node) => {
    if (node.parent === undefined) return
    children.set(node.parent, [...(children.get(node.parent) ?? []), node.id])
  })
  return {
    startTime: thread.startTime,
    endTime: thread.startTime + thread.deltas.reduce((sum, delta) => sum + delta, 0),
    nodes: Array.from(thread.nodes.values(), (node) => ({
      id: node.id,
      callFrame: {
        functionName: node.callFrame.functionName,
        url: node.callFrame.url ?? "",
        lineNumber: node.callFrame.lineNumber ?? -1,
        columnNumber: node.callFrame.columnNumber ?? -1,
        scriptId: String(node.callFrame.scriptId ?? "0"),
      },
      children: children.get(node.id) ?? [],
    })),
    samples: thread.samples,
    timeDeltas: thread.deltas,
  }
}
