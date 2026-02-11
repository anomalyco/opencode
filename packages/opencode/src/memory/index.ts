import fs from "fs/promises"
import path from "path"
import { writeHeapSnapshot } from "v8"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Global } from "@/global"
import { GlobalBus } from "@/bus/global"
import { Installation } from "@/installation"
import { Log } from "@/util/log"

export namespace Memory {
  const log = Log.create({ service: "memory" })

  const DEFAULT_INTERVAL_MS = 120_000
  const DEFAULT_RSS_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024)
  const DEFAULT_CONSECUTIVE = 5
  const MAX_SAMPLES = 64
  const started = Date.now()

  export const DIR = path.join(Global.Path.data, "memory")

  const Sample = z.object({
    time: z.number(),
    rss: z.number(),
    heap_used: z.number(),
    heap_total: z.number(),
    external: z.number(),
    array_buffers: z.number(),
  })
  type Sample = z.infer<typeof Sample>

  export const Report = z
    .object({
      id: z.string(),
      pid: z.number(),
      created: z.number(),
      threshold: z.object({
        interval_ms: z.number(),
        rss_bytes: z.number(),
        consecutive: z.number(),
      }),
      server_proc: z.boolean(),
      tui_proc: z.boolean(),
      opencode_version: z.string(),
      process_lifetime: z.number(),
      memory_usage: Sample,
      sample_count: z.number(),
      high_streak: z.number(),
      heapdump_path: z.string().optional(),
      heapdump_error: z.string().optional(),
      samples: z.array(Sample),
    })
    .meta({
      ref: "MemoryReport",
    })
  export type Report = z.infer<typeof Report>

  export const Event = {
    High: BusEvent.define(
      "memory.high",
      z
        .object({
          id: z.string(),
          pid: z.number(),
          created: z.number(),
          rss: z.number(),
          high_streak: z.number(),
          sample_count: z.number(),
          report_path: z.string(),
          heapdump_path: z.string().optional(),
          heapdump_error: z.string().optional(),
          threshold: z.object({
            interval_ms: z.number(),
            rss_bytes: z.number(),
            consecutive: z.number(),
          }),
          server_proc: z.boolean(),
          tui_proc: z.boolean(),
          opencode_version: z.string(),
          process_lifetime: z.number(),
        })
        .meta({
          ref: "MemoryHighEvent",
        }),
    ),
  }

  export type SavedReport = Report & {
    report_path: string
    heapdump_exists: boolean
  }

  export type Check = {
    sample: Sample
    threshold: {
      interval_ms: number
      rss_bytes: number
      consecutive: number
    }
    high_streak: number
    triggered: boolean
    just_triggered: boolean
    report_path: string | undefined
    heapdump_path: string | undefined
    heapdump_error: string | undefined
  }

  export type Trigger = {
    sample: Sample
    threshold: {
      interval_ms: number
      rss_bytes: number
      consecutive: number
    }
    report_path: string
    heapdump_path: string | undefined
    heapdump_error: string | undefined
  }

  const state: {
    timer: ReturnType<typeof setInterval> | undefined
    streak: number
    triggered: boolean
    samples: Sample[]
    threshold: {
      interval_ms: number
      rss_bytes: number
      consecutive: number
    }
  } = {
    timer: undefined,
    streak: 0,
    triggered: false,
    samples: [],
    threshold: {
      interval_ms: DEFAULT_INTERVAL_MS,
      rss_bytes: DEFAULT_RSS_BYTES,
      consecutive: DEFAULT_CONSECUTIVE,
    },
  }

  function threshold() {
    const interval = number("OPENCODE_MEMORY_MONITOR_INTERVAL_MS")
    const rss = number("OPENCODE_MEMORY_MONITOR_RSS_BYTES")
    const consecutive = number("OPENCODE_MEMORY_MONITOR_CONSECUTIVE")
    return {
      interval_ms: interval || DEFAULT_INTERVAL_MS,
      rss_bytes: rss || DEFAULT_RSS_BYTES,
      consecutive: consecutive || DEFAULT_CONSECUTIVE,
    }
  }

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }

  export function init() {
    if (state.timer) return
    state.threshold = threshold()
    state.timer = setInterval(() => {
      void check()
    }, state.threshold.interval_ms)
    state.timer.unref()
    void check()
    log.info("monitor started", state.threshold)
  }

  export function stop() {
    if (state.timer) clearInterval(state.timer)
    state.timer = undefined
    state.streak = 0
    state.triggered = false
    state.samples = []
  }

  export async function trigger(): Promise<Trigger> {
    const current = state.timer ? state.threshold : threshold()
    state.threshold = current
    const usage = process.memoryUsage()
    const sample: Sample = {
      time: Date.now(),
      rss: usage.rss,
      heap_used: usage.heapUsed,
      heap_total: usage.heapTotal,
      external: usage.external,
      array_buffers: usage.arrayBuffers,
    }
    state.samples.push(sample)
    if (state.samples.length > MAX_SAMPLES) state.samples.shift()
    state.streak = sample.rss >= current.rss_bytes ? state.streak + 1 : 0
    const id = new Date().toISOString().replace(/[:.]/g, "") + "-" + process.pid + "-manual"
    const dump = await write(id, sample, current)
    return {
      sample,
      threshold: current,
      report_path: dump.report_path,
      heapdump_path: dump.heapdump_path,
      heapdump_error: dump.heapdump_error,
    }
  }

  export async function check(): Promise<Check> {
    const current = state.timer ? state.threshold : threshold()
    state.threshold = current
    const usage = process.memoryUsage()
    const sample: Sample = {
      time: Date.now(),
      rss: usage.rss,
      heap_used: usage.heapUsed,
      heap_total: usage.heapTotal,
      external: usage.external,
      array_buffers: usage.arrayBuffers,
    }
    state.samples.push(sample)
    if (state.samples.length > MAX_SAMPLES) state.samples.shift()

    state.streak = sample.rss >= current.rss_bytes ? state.streak + 1 : 0
    const before = state.triggered
    if (state.triggered || state.streak < current.consecutive) {
      return {
        sample,
        threshold: current,
        high_streak: state.streak,
        triggered: state.triggered,
        just_triggered: false,
        report_path: undefined,
        heapdump_path: undefined,
        heapdump_error: undefined,
      }
    }

    state.triggered = true
    const id = new Date().toISOString().replace(/[:.]/g, "") + "-" + process.pid
    const dump = await write(id, sample, current)
    return {
      sample,
      threshold: current,
      high_streak: state.streak,
      triggered: state.triggered,
      just_triggered: !before,
      report_path: dump.report_path,
      heapdump_path: dump.heapdump_path,
      heapdump_error: dump.heapdump_error,
    }
  }

  async function write(
    id: string,
    sample: Sample,
    threshold: {
      interval_ms: number
      rss_bytes: number
      consecutive: number
    },
  ) {
    await fs.mkdir(DIR, { recursive: true })
    const heapdumpTarget = path.join(DIR, `${id}.heapsnapshot`)
    const reportPath = path.join(DIR, `${id}.json`)
    const heap = await Promise.resolve(heapdumpTarget)
      .then((target) => writeHeapSnapshot(target))
      .then((heapdump_path) => ({ heapdump_path, heapdump_error: undefined as string | undefined }))
      .catch((error) => ({
        heapdump_path: undefined,
        heapdump_error: error instanceof Error ? error.message : String(error),
      }))

    const meta = metadata()
    const report: Report = {
      id,
      pid: process.pid,
      created: Date.now(),
      threshold,
      server_proc: meta.server_proc,
      tui_proc: meta.tui_proc,
      opencode_version: Installation.VERSION,
      process_lifetime: meta.process_lifetime,
      memory_usage: sample,
      sample_count: state.samples.length,
      high_streak: state.streak,
      heapdump_path: heap.heapdump_path,
      heapdump_error: heap.heapdump_error,
      samples: [...state.samples],
    }
    await Bun.write(reportPath, JSON.stringify(report, null, 2))

    log.warn("high memory detected", {
      id,
      rss: sample.rss,
      high_streak: state.streak,
      report_path: reportPath,
      heapdump_path: heap.heapdump_path,
      heapdump_error: heap.heapdump_error,
    })

    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Event.High.type,
        properties: {
          id,
          pid: process.pid,
          created: report.created,
          rss: sample.rss,
          high_streak: state.streak,
          sample_count: state.samples.length,
          report_path: reportPath,
          heapdump_path: heap.heapdump_path,
          heapdump_error: heap.heapdump_error,
          threshold,
          server_proc: meta.server_proc,
          tui_proc: meta.tui_proc,
          opencode_version: Installation.VERSION,
          process_lifetime: meta.process_lifetime,
        },
      },
    })

    return {
      report_path: reportPath,
      heapdump_path: heap.heapdump_path,
      heapdump_error: heap.heapdump_error,
    }
  }

  function metadata() {
    const cmd = process.argv.slice(2).find((arg) => !arg.startsWith("-"))
    const known = new Set([
      "acp",
      "agent",
      "attach",
      "auth",
      "completion",
      "debug",
      "export",
      "generate",
      "github",
      "help",
      "import",
      "mcp",
      "models",
      "pr",
      "run",
      "serve",
      "session",
      "stats",
      "uninstall",
      "upgrade",
      "version",
      "web",
    ])
    return {
      server_proc: cmd === "serve" || cmd === "web",
      tui_proc: cmd === "attach" || cmd === undefined || !known.has(cmd),
      process_lifetime: Math.floor((Date.now() - started) / 1000),
    }
  }

  function trim(input: string) {
    return path.basename(input).replace(/\.(json|heapsnapshot)$/, "")
  }

  export async function reports(): Promise<SavedReport[]> {
    const entries = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: DIR, onlyFiles: true })).catch(
      () => [] as string[],
    )
    const all = await Promise.all(
      entries.map(async (entry) => {
        const reportPath = path.join(DIR, entry)
        const data = await Bun.file(reportPath)
          .json()
          .catch(() => undefined)
        const parsed = Report.safeParse(data)
        if (!parsed.success) return
        const heapdump_exists = parsed.data.heapdump_path ? await Bun.file(parsed.data.heapdump_path).exists() : false
        return {
          ...parsed.data,
          report_path: reportPath,
          heapdump_exists,
        }
      }),
    )
    return all.filter((item): item is SavedReport => Boolean(item)).toSorted((a, b) => b.created - a.created)
  }

  export async function report(id = "latest") {
    const all = await reports()
    if (id === "latest") return all[0]
    const key = trim(id)
    return all.find((item) => item.id === key)
  }
}
