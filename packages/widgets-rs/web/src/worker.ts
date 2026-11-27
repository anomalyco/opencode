// The widget worker: runs PsychoScript (WebAssembly) off the page's thread. Step widgets keep their state here and
// send back views and draw commands; live widgets run as `LiveRun`s pumped from this worker's event loop, with timers
// and `fetch` on this side. The page owns the DOM and the GPU.

import { initSync, LiveRun, Program } from "../wasm/widget_web.js"
import type { ErrorInfo, FromWorker, LiveExit, StepOutput, ToWorker } from "./protocol.js"
import { DRAW_TIMEOUT_MS, restoreNonFinite, STEP_TIMEOUT_MS } from "./protocol.js"

/**
 * Widget protocol 2, a native host (widgets.md, "Protocol", "Native hosts"): functions cross as markers, steps hand
 * their view to `__widget_emit` and the WebAssembly walks it into the tree clients get (`runStep`), draw steps hand it
 * their commands (`runDraw`), live renders are walked as posted (`native`).
 */
const STEP_ENTRY = "\nreturn __widget_native_step(__input())"
const LIVE_ENTRY = "\nreturn await __widget_live(__input(), true)"
/** Longest one `pump` computes before letting this worker's event loop run (messages, timers). */
const PUMP_SLICE_MS = 8

declare const self: { postMessage(message: unknown, transfer: Transferable[]): void; onmessage: ((event: MessageEvent<ToWorker>) => void) | null }

const post = (m: FromWorker, transfer?: Transferable[]) => self.postMessage(m, transfer ?? [])

interface Compiled {
  program?: Program
  error?: ErrorInfo
}

interface StepSession {
  pid: number
  data: string
  state: string
}

interface Live {
  run: LiveRun
  scheduled: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  fetches: Map<number, AbortController>
}

const programs = new Map<number, Compiled>()
const steps = new Map<number, StepSession>()
const lives = new Map<number, Live>()
let ready = false
let crashed = false
let memory: WebAssembly.Memory | undefined

function info(e: unknown): ErrorInfo {
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { type?: string; kind?: string; message: string; line?: number; column?: number; phase?: string }
    return {
      type: o.type ?? "host",
      kind: o.kind,
      message: String(o.message),
      line: o.line,
      column: o.column,
      phase: o.phase,
    }
  }
  return { type: "host", message: String(e) }
}

/** A trap in the WebAssembly (an interpreter defect or out of memory) leaves the instance unusable. */
function trapped(e: unknown, wid?: number): boolean {
  if (e instanceof WebAssembly.RuntimeError || (e instanceof RangeError && /memory/i.test(e.message))) {
    crashed = true
    post({ t: "crash", message: String((e as Error).message), wid })
    return true
  }
  return false
}

function step(wid: number, s: StepSession, phase: "init" | "event", input: string) {
  const c = programs.get(s.pid)
  if (!c?.program) {
    post({ t: "step", wid, phase, error: c?.error ?? { type: "host", message: "the program isn't compiled" }, ms: 0 })
    return
  }
  const started = performance.now()
  let text: string
  try {
    text = c.program.runStep(input, STEP_TIMEOUT_MS)
  } catch (e) {
    if (trapped(e, wid)) return
    post({ t: "step", wid, phase, error: info(e), ms: performance.now() - started })
    return
  }
  const ms = performance.now() - started
  let output: StepOutput
  try {
    output = JSON.parse(text) as StepOutput
  } catch (e) {
    post({ t: "step", wid, phase, error: info(e), ms })
    return
  }
  if (!output || typeof output !== "object" || !output.view || typeof output.view !== "object" || typeof output.view.type !== "string") {
    post({ t: "step", wid, phase, error: { type: "view", message: "the step returned no view" }, ms })
    return
  }
  s.state = JSON.stringify(output.state ?? {})
  delete output.state
  post({ t: "step", wid, phase, output, ms })
}

function draw(wid: number, req: number, frame: unknown) {
  const s = steps.get(wid)
  const program = s && programs.get(s.pid)?.program
  if (!s || !program) return
  const input = `{"phase":"draw","data":${s.data},"state":${s.state},"frame":${JSON.stringify(frame)}}`
  const started = performance.now()
  try {
    // The run emits its commands (`__widget_emit(commands)`), checked and normalised there (widgets.md, Canvas, Draw
    // command checks); an invalid draw throws, in phase `draw`.
    const commands = JSON.parse(program.runDraw(input, DRAW_TIMEOUT_MS)) as unknown
    const ms = performance.now() - started
    if (!Array.isArray(commands)) post({ t: "drawn", wid, req, error: { type: "draw", message: "draw returned no commands" }, ms })
    else post({ t: "drawn", wid, req, commands: commands as unknown[][], ms })
  } catch (e) {
    if (trapped(e, wid)) return
    post({ t: "drawn", wid, req, error: info(e), ms: performance.now() - started })
  }
}

// ---------- live runs ----------

const channel = new MessageChannel()
const soon: Array<() => void> = []
channel.port1.onmessage = () => {
  const due = soon.splice(0)
  for (const f of due) f()
}
/** Runs `f` after this turn of the event loop, without `setTimeout`'s clamping. */
function later(f: () => void) {
  soon.push(f)
  if (soon.length === 1) channel.port2.postMessage(0)
}

function schedule(wid: number, live: Live) {
  if (live.scheduled) return
  live.scheduled = true
  later(() => pump(wid, live))
}

function pump(wid: number, live: Live) {
  live.scheduled = false
  if (live.timer !== undefined) {
    clearTimeout(live.timer)
    live.timer = undefined
  }
  if (lives.get(wid) !== live) return
  let r: number
  try {
    r = live.run.pump(PUMP_SLICE_MS)
  } catch (e) {
    if (trapped(e, wid)) return
    r = -3
  }
  flush(wid, live)
  if (r === -3) {
    finish(wid, live)
  } else if (r === -2) {
    schedule(wid, live)
  } else if (r >= 0) {
    live.timer = setTimeout(() => {
      live.timer = undefined
      pump(wid, live)
    }, Math.max(0, Math.ceil(r)))
  }
}

function finish(wid: number, live: Live) {
  let exit: LiveExit = { type: "stopped" }
  try {
    const text = live.run.exit()
    if (text) exit = JSON.parse(text) as LiveExit
  } catch {}
  for (const c of live.fetches.values()) c.abort()
  lives.delete(wid)
  try {
    live.run.free()
  } catch {}
  post({ t: "exit", wid, exit })
}

interface Envelope {
  type: "post" | "warning" | "fetch" | "cancel"
  message?: unknown
  id?: number
  url?: string
  method?: string
  headers?: [string, string][]
  body?: string
  body64?: string
  timeoutMs?: number
  maxResponseBytes?: number
}

function flush(wid: number, live: Live) {
  const text = live.run.takeOutbox()
  if (text === "[]") return
  const out = JSON.parse(text) as Envelope[]
  const messages: unknown[] = []
  // GPU batches name their bytes by `[offset, length]` in the run's byte outbox: one copy out of the WebAssembly,
  // transferred to the page, each batch a view of it.
  let bytes: Uint8Array | undefined
  const batch = (b: { bytes?: unknown; nonFinite?: unknown } | undefined) => {
    if (b?.nonFinite !== undefined) restoreNonFinite(b)
    if (!b || !Array.isArray(b.bytes)) return
    const all = (bytes ??= live.run.takeBytes())
    const [offset, length] = b.bytes as [number, number]
    b.bytes = all.subarray(offset, offset + length)
  }
  for (const e of out) {
    // Render and draw posts come out under the post rate (widgets-live.md, Post rate), checked when posted.
    if (e.type === "post") {
      const m = e.message as { type?: string; gpu?: { bytes?: unknown }; batch?: { bytes?: unknown } }
      if (m?.type === "frame") batch(m.gpu)
      else if (m?.type === "gpu") batch(m.batch)
      messages.push(m)
    }
    else if (e.type === "warning") post({ t: "warning", wid, message: String(e.message) })
    else if (e.type === "fetch") void transfer(wid, live, e)
    else if (e.type === "cancel" && e.id !== undefined) live.fetches.get(e.id)?.abort()
  }
  if (messages.length > 0) post({ t: "posts", wid, messages }, bytes ? [bytes.buffer as ArrayBuffer] : undefined)
}

function base64(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Carries out a fetch the run checked: no credentials, no referrer, no cache; the body read up to its limit. */
async function transfer(wid: number, live: Live, e: Envelope) {
  const id = e.id!
  const control = new AbortController()
  live.fetches.set(id, control)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    control.abort()
  }, e.timeoutMs ?? 15000)
  const max = e.maxResponseBytes ?? 2 * 1024 * 1024
  const answer = (f: (run: LiveRun) => void) => {
    clearTimeout(timer)
    live.fetches.delete(id)
    if (lives.get(wid) !== live) return
    try {
      f(live.run)
    } catch (err) {
      if (trapped(err, wid)) return
    }
    schedule(wid, live)
  }
  try {
    const response = await fetch(e.url!, {
      method: e.method,
      headers: e.headers,
      body: e.body ?? (e.body64 !== undefined ? (base64(e.body64) as BodyInit) : undefined),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      mode: "cors",
      redirect: "follow",
      signal: control.signal,
    })
    const declared = Number(response.headers.get("content-length") ?? "0")
    if (declared > max) {
      control.abort()
      answer((run) => run.fetchFailed(id, "TooLarge", `the response body is over ${max >> 20} MB`))
      return
    }
    const chunks: Uint8Array[] = []
    let size = 0
    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > max) {
          control.abort()
          answer((run) => run.fetchFailed(id, "TooLarge", `the response body is over ${max >> 20} MB`))
          return
        }
        chunks.push(value)
      }
    }
    const body = new Uint8Array(size)
    let at = 0
    for (const c of chunks) {
      body.set(c, at)
      at += c.byteLength
    }
    const meta = JSON.stringify({ status: response.status, url: response.url || e.url, headers: [...response.headers] })
    answer((run) => run.fetchDone(id, meta, body))
  } catch (err) {
    const kind = timedOut ? "Timeout" : "Network"
    const message = timedOut ? "no response within 15 s" : `request failed: ${String((err as Error)?.message ?? err)} (network error, or the server doesn't allow cross-origin requests)`
    answer((run) => run.fetchFailed(id, kind, message))
  }
}

// A program shaped like a widget step: compiling and running it once makes the engine compile the interpreter's common
// paths (it compiles WebAssembly functions lazily, on first call), so the first real widget doesn't wait for that.
// Workers given the same module share the compiled code.
const WARM = `class Box { constructor(v) { this.v = v } get twice() { return this.v * 2 } static of(v) { return new Box(v) } }
const ui = { column: (props, nodes) => Array.isArray(props) ? { type: "column", children: [props].flat(Infinity).filter(Boolean) } : { ...props, type: "column", children: [nodes].flat(Infinity).filter(Boolean) } }
function view(state, data) {
  return ui.column({ gap: 2 }, [data.items.map((item, i) => ({ type: "text", text: String(item.label) + " " + i, selected: state.picked === i })), state.picked !== null && { type: "button", id: "go" }])
}
const input = __input()
const state = { picked: null, ...input.state, list: [3, 1, 2].sort((a, b) => a - b) }
const out = []
for (let i = 0; i < 40; i++) out.push(Box.of(i).twice * Math.sin(i / 3) + Math.max(i, 2) - Math.floor(i / 2))
const pairs = Object.entries({ a: 1, b: "x" }).map(([k, v]) => k + "=" + v).join("&")
const seen = new Map([["k", 1]]); const set = new Set([1, 2, 2])
const text = \`t\${out.length}\`.padStart(4, "0").toUpperCase().replace(/T/g, "x").split("").reverse().join("")
async function later(v) { await null; return v }
later(1).then((v) => v + 1)
try { null.x } catch (e) { out.push(e instanceof TypeError) }
return { state, view: view(state, input.data), sum: out.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0), pairs, seen: seen.get("k"), size: set.size, text, json: JSON.parse(JSON.stringify({ n: [1, { m: 2 }] })), keys: Object.keys(input.data).length, fixed: (1.5).toFixed(2), date: typeof Date.now() }`

function warm() {
  try {
    const program = new Program(WARM)
    const input = JSON.stringify({ state: { x: 1 }, data: { items: [{ label: "a" }, { label: "b" }] } })
    for (let i = 0; i < 2; i++) program.run(input, 1000)
    program.free()
  } catch {}
}

// ---------- messages ----------

function handle(m: ToWorker) {
  switch (m.t) {
    case "init":
      if (!ready) {
        memory = initSync({ module: m.module }).memory
        ready = true
        warm()
      }
      post({ t: "ready" })
      return
    case "compile": {
      const started = performance.now()
      try {
        const program = new Program(m.program + (m.live ? LIVE_ENTRY : STEP_ENTRY))
        programs.set(m.pid, { program })
        post({ t: "compiled", pid: m.pid, ms: performance.now() - started })
      } catch (e) {
        if (trapped(e)) return
        programs.set(m.pid, { error: info(e) })
        post({ t: "compiled", pid: m.pid, error: info(e), ms: performance.now() - started })
      }
      return
    }
    case "release":
      programs.get(m.pid)?.program?.free()
      programs.delete(m.pid)
      return
    case "open": {
      const s: StepSession = { pid: m.pid, data: m.data, state: "{}" }
      steps.set(m.wid, s)
      step(m.wid, s, "init", `{"phase":"init","data":${m.data}}`)
      return
    }
    case "event": {
      const s = steps.get(m.wid)
      if (s) step(m.wid, s, "event", `{"phase":"event","data":${s.data},"state":${s.state},"event":${JSON.stringify(m.event)}}`)
      else {
        const live = lives.get(m.wid)
        if (live) {
          live.run.deliver(JSON.stringify({ type: "event", event: m.event }))
          schedule(m.wid, live)
        }
      }
      return
    }
    case "draw":
      draw(m.wid, m.req, m.frame)
      return
    case "close": {
      steps.delete(m.wid)
      const live = lives.get(m.wid)
      if (live) {
        live.run.stop()
        flush(m.wid, live)
        finish(m.wid, live)
      }
      return
    }
    case "live": {
      const c = programs.get(m.pid)
      if (!c?.program) {
        post({ t: "exit", wid: m.wid, exit: { type: "failed", error: c?.error ?? { type: "host", message: "the program isn't compiled" } } })
        return
      }
      try {
        const input = `{"data":${m.data}${m.gpu ? `,"gpu":${JSON.stringify(m.gpu)}` : ""}}`
        const run = c.program.startLive(input, {
          native: true,
          httpsHosts: m.hosts,
          allowLocalNetwork: m.localNetwork === true,
          sliceBudgetMs: m.sliceBudgetMs,
          programLines: m.programLines,
        })
        const live: Live = { run, scheduled: false, timer: undefined, fetches: new Map() }
        lives.set(m.wid, live)
        schedule(m.wid, live)
      } catch (e) {
        if (trapped(e, m.wid)) return
        post({ t: "exit", wid: m.wid, exit: { type: "failed", error: info(e) } })
      }
      return
    }
    case "deliver": {
      const live = lives.get(m.wid)
      if (!live) return
      try {
        live.run.deliver(JSON.stringify(m.message))
      } catch {}
      schedule(m.wid, live)
      return
    }
    case "pause": {
      const live = lives.get(m.wid)
      if (!live) return
      try {
        live.run.pause()
      } catch {}
      // Its sleeps stand still; posts waiting for the post rate still go out (pump says when).
      schedule(m.wid, live)
      return
    }
    case "resume": {
      const live = lives.get(m.wid)
      if (!live) return
      try {
        live.run.resume()
      } catch {}
      schedule(m.wid, live)
      return
    }
    case "stop": {
      const live = lives.get(m.wid)
      if (!live) return
      live.run.stop()
      flush(m.wid, live)
      finish(m.wid, live)
      return
    }
    case "stats":
      post({ t: "stats", req: m.req, wasmBytes: memory?.buffer.byteLength ?? 0, programs: programs.size, widgets: steps.size + lives.size })
      return
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  if (crashed) return
  try {
    handle(event.data)
  } catch (e) {
    if (!trapped(e)) post({ t: "crash", message: String((e as Error)?.message ?? e) })
  }
}
