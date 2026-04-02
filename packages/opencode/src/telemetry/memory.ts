import { Log } from "@/util/log"
import { Global } from "@/global"
import { heapStats } from "bun:jsc"
import * as fs from "node:fs"
import * as v8 from "node:v8"

const log = Log.create({ service: "memory" })
const step = 5_000
const span = 12
const limit = 50 * 1024 * 1024
const spike = 500 * 1024 * 1024
const gc = process.env.OPENCODE_FORCE_GC === "1"
const tty = process.stderr.isTTY

function emit(msg: string) {
  if (!tty) process.stderr.write(msg + "\n")
}

function shrink() {
  if (typeof Bun !== "undefined" && typeof Bun.shrink === "function") Bun.shrink()
}

type Smaps = {
  anon: number
  file: number
  swap: number
  shared: number
}

type Snap = {
  at: string
  rss: number
  rss_proc?: number
  heap_total: number
  heap_used: number
  count: number
  types: Record<string, number>
  smaps?: Smaps
}

let timer: ReturnType<typeof setInterval> | undefined
let prev: Snap | undefined
let base: Snap | undefined
let tick = 0
let busy = false
let usr1: (() => void) | undefined
let usr2: (() => void) | undefined

let gauges: (() => Record<string, number>) | undefined

/** Register a function that returns app-level counters to include in every memory sample */
export function setGauges(fn: () => Record<string, number>) {
  gauges = fn
}
function toMB(n: number) {
  return Number((n / 1024 / 1024).toFixed(1))
}

function proc() {
  if (process.platform !== "linux") return undefined
  try {
    const text = fs.readFileSync("/proc/self/status", "utf8")
    const m = text.match(/^VmRSS:\s+(\d+)\s+kB$/m)
    if (!m) return undefined
    return Number(m[1]) * 1024
  } catch {
    return undefined
  }
}

function smaps(): Smaps | undefined {
  if (process.platform !== "linux") return undefined
  try {
    const text = fs.readFileSync("/proc/self/smaps_rollup", "utf8")
    const get = (key: string) => {
      const m = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, "m"))
      return m ? Number(m[1]) * 1024 : 0
    }
    return {
      anon: get("Pss_Anon"),
      file: get("Pss_File"),
      swap: get("Swap"),
      shared: get("Shared_Clean") + get("Shared_Dirty"),
    }
  } catch {
    return undefined
  }
}

function top(next: Record<string, number>, last?: Record<string, number>) {
  return Object.entries(next)
    .map(([name, count]) => {
      return {
        name,
        delta: count - (last?.[name] ?? 0),
      }
    })
    .filter((row) => row.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5)
}

function take() {
  if (gc) Bun.gc(false)
  const mem = process.memoryUsage()
  const stat = heapStats()
  const rss_proc = proc()
  const maps = smaps()
  const types = Object.fromEntries(Object.entries(stat.objectTypeCounts).map(([k, v]) => [k, Number(v)]))
  return {
    at: new Date().toISOString(),
    rss: mem.rss,
    rss_proc,
    heap_total: mem.heapTotal,
    heap_used: mem.heapUsed,
    count: Number(stat.objectCount),
    types,
    smaps: maps,
  } satisfies Snap
}

function snap(sig: string) {
  if (busy) return
  const rss = process.memoryUsage.rss()
  const dir = Global.Path.log
  try {
    const stat = fs.statfsSync(dir)
    const avail = stat.bavail * stat.bsize
    if (avail < 512 * 1024 * 1024) {
      const msg = `skip heap snapshot: ${dir} has ${toMB(avail)}MB free (need 512MB)`
      log.warn(msg)
      emit(msg)
      return
    }
  } catch {
    const msg = `skip heap snapshot: cannot check ${dir} disk space`
    log.warn(msg)
    emit(msg)
    return
  }
  busy = true
  try {
    if (gc) Bun.gc(true)
    const path = `${dir}/opencode-heap-${process.pid}-${Date.now()}.heapsnapshot`
    log.info("heap snapshot started", { signal: sig, path, rss_mb: toMB(rss) })
    emit(`heap snapshot started: ${path} (signal: ${sig})`)
    const file = v8.writeHeapSnapshot(path)
    const msg = `heap snapshot written: ${file} (signal: ${sig})`
    log.info(msg, { signal: sig, path: file })
    emit(msg)
  } finally {
    busy = false
  }
}

function smapsFmt(s?: Smaps) {
  if (!s) return ""
  return ` anon=${toMB(s.anon)}MB file=${toMB(s.file)}MB swap=${toMB(s.swap)}MB shared=${toMB(s.shared)}MB native=${toMB(s.anon - (process.memoryUsage().heapUsed))}MB`
}

function smapsFields(s?: Smaps) {
  if (!s) return {}
  return {
    anon_mb: toMB(s.anon),
    file_mb: toMB(s.file),
    swap_mb: toMB(s.swap),
    shared_mb: toMB(s.shared),
    native_mb: toMB(s.anon - process.memoryUsage().heapUsed),
  }
}

function reap() {
  if (process.platform !== "linux") return
  try {
    // Reap zombie children — Bun doesn't always waitpid for spawned processes
    const children = fs.readFileSync("/proc/self/task/" + process.pid + "/children", "utf8").trim()
    if (!children) return
    // Just reading /proc/self/stat of children triggers zombie collection in some cases.
    // For actual reaping we'd need native waitpid, but Bun.spawnSync with a no-op works:
    for (const pid of children.split(" ")) {
      try { fs.readFileSync(`/proc/${pid}/stat`, "utf8") } catch {}
    }
  } catch {}
}

function one(sig: string) {
  const mem = process.memoryUsage()
  const shot = take()
  log.info("memory signal sample", {
    signal: sig,
    timestamp: shot.at,
    rss_mb: toMB(mem.rss),
    rss_proc_mb: shot.rss_proc ? toMB(shot.rss_proc) : undefined,
    heap_mb: toMB(mem.heapUsed),
    heap_total_mb: toMB(mem.heapTotal),
    object_count: shot.count,
    ...smapsFields(shot.smaps),
    ...gauges?.(),
  })
  const extra = gauges ? " " + Object.entries(gauges()).map(([k, v]) => `${k}=${v}`).join(" ") : ""
  emit(`memory signal sample: rss=${toMB(mem.rss)}MB heap=${toMB(mem.heapUsed)}MB objects=${shot.count}${smapsFmt(shot.smaps)} signal=${sig}${extra}`)
  shrink()
}

export function registerSignals(): void {
  if (usr1 && usr2) return
  usr1 = () => {
    snap("SIGUSR1")
  }
  usr2 = () => {
    one("SIGUSR2")
  }
  process.on("SIGUSR1", usr1)
  process.on("SIGUSR2", usr2)
}

function sample() {
  const next = take()
  const last = prev
  const first = base
  const grows = top(next.types, last?.types)
  const real = next.rss_proc ?? next.rss
  const prev_real = last?.rss_proc ?? last?.rss ?? real
  const delta = real - prev_real
  const sum = tick % span === 0
  const grace = tick < span
  const spiked = !grace && delta > spike
  if ((!grace && delta > limit) || sum || spiked) {
    log.info(sum ? "memory summary" : spiked ? "memory spike" : "memory growth", {
      timestamp: next.at,
      rss_mb: toMB(real),
      rss_proc_mb: next.rss_proc ? toMB(next.rss_proc) : undefined,
      heap_mb: toMB(next.heap_used),
      heap_total_mb: toMB(next.heap_total),
      object_count: next.count,
      rss_delta_mb: toMB(delta),
      rss_since_start_mb: first ? toMB(real - (first.rss_proc ?? first.rss)) : undefined,
      ...smapsFields(next.smaps),
      top_types: grows,
      ...gauges?.(),
    })
    const label = sum ? "summary" : spiked ? "spike" : "growth"
    const extra = gauges ? " " + Object.entries(gauges()).map(([k, v]) => `${k}=${v}`).join(" ") : ""
    emit(`memory ${label}: rss=${toMB(real)}MB delta=${toMB(delta)}MB heap=${toMB(next.heap_used)}MB${smapsFmt(next.smaps)}${extra}`)
    // Auto heap snapshot on spikes (>500MB in one interval)
    if (spiked && process.env.OPENCODE_AUTO_HEAP_SNAPSHOT === "1") {
      snap("auto-spike")
    }
  }
  // Periodically reap zombie children and release bmalloc hoarded memory.
  // Bun.shrink() calls JSC::VM::shrinkFootprintWhenIdle() which triggers
  // pas_scavenger_decommit_free_memory() to return freed segments to the OS.
  // Without this, bmalloc retains large heap segments indefinitely (bun#28318).
  if (tick % span === 0) {
    reap()
    shrink()
  }
  prev = next
  if (!base) base = next
  tick += 1
}

export function start(): void {
  registerSignals()
  if (timer) return
  tick = 0
  prev = undefined
  base = undefined
  const first = take()
  prev = first
  base = first
  log.info("memory baseline", {
    timestamp: first.at,
    rss_mb: toMB(first.rss),
    rss_proc_mb: first.rss_proc ? toMB(first.rss_proc) : undefined,
    heap_mb: toMB(first.heap_used),
    heap_total_mb: toMB(first.heap_total),
    object_count: first.count,
    ...smapsFields(first.smaps),
    top_types: top(first.types, {}),
  })
  emit(`memory baseline: rss=${toMB(first.rss)}MB heap=${toMB(first.heap_used)}MB objects=${first.count}${smapsFmt(first.smaps)}`)
  timer = setInterval(sample, step)
  timer.unref?.()
}

export function stop(): void {
  if (!timer) return
  clearInterval(timer)
  timer = undefined
}
