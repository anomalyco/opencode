// The page side: workers, programs, and the widgets mounted into the DOM.

import type { Command } from "./canvas.js"
import { Images } from "./canvas.js"
import type { ErrorInfo, Frame, FromWorker, LiveExit, Rect, StepOutput, ToWorker, ViewNode, WidgetEvent } from "./protocol.js"
import { Input } from "./input.js"
import { NEWER, OLDER, PROTOCOL, SLICE_BUDGET_MS, protocol } from "./protocol.js"
import type { RenderContext } from "./render.js"
import { CanvasView, GpuCanvasView, Ticker, WebGpuCanvasView, destroy as destroyTree, hasSurface, icon, rectIn, reconcile, surfaces } from "./render.js"
import { GpuReplay } from "./gpu.js"
import { GPU_HANG } from "./gpu-checks.js"
import { type Run, Strikes } from "./watchdog.js"
import { stylesheet } from "./styles.js"
import type { Resolved, Theme } from "./theme.js"
import { apply, resolve } from "./theme.js"

export interface Capabilities {
  https?: { hosts: string[] }
}

export type WidgetStatus = "open" | "submitted" | "dismissed"

export interface MountOptions {
  /** The served program: prelude + "\n" + widget template source (`Program.program` from `opencode.widget/program`). */
  program: string
  /** The widget's data (the `widget` tool call's `data`). */
  data: unknown
  /** `"step"` (default) or `"live"`. */
  mode?: "step" | "live"
  /** The widget template's capabilities (live only); granted as declared, shown as a chip. */
  capabilities?: Capabilities
  /**
   * Dev mode only (widgets-live.md, "Local network in dev mode"; default false): `fetch` may also reach loopback,
   * private and link-local addresses and local names (`localhost`, `*.local`), over `http:` too and on any declared
   * port, when the widget template declares them (`localhost:4097`, `127.0.0.1`; `*` doesn't count). The page's CSP
   * `connect-src` must allow them as well (e.g. `http://localhost:4097`). Never turn it on for release builds by
   * default.
   */
  allowLocalNetwork?: boolean
  /** The widget's state on the server: `"submitted"`/`"dismissed"` render read-only with a status line. */
  state?: WidgetStatus
  /** The submitted value, summarized under a submitted widget. */
  response?: unknown
  /** The user submitted `value`: post it with `opencode.widget/respond`. The widget turns read-only. */
  onSubmit?(value: unknown): void
  /** The user dismissed the widget: post `{ dismiss: true }` with `respond`. */
  onDismiss?(): void
  /** A non-final message for the agent (`opencode.widget/send`); more than 10 a second are dropped here. */
  onSend?(value: unknown, wake: boolean): void
  /** `"dark"` (default), `"light"`, or tokens. */
  theme?: Theme
  /**
   * Resolves an image `src` to a URL the page may load: `https:`/`http:`/`data:` pass by default; return the server's
   * file content URL for a path relative to the session's directory, or undefined to show `alt` instead.
   */
  resolveImage?(src: string): string | undefined
  /**
   * The widget template's source (`Program.source`), so error positions can be made widget-template-relative (the prelude's lines
   * subtracted). Without it the host finds the prelude's end itself, or leaves positions out.
   */
  source?: string
  /**
   * A **program error** (widgets.md, Failures): the widget template's code threw or broke a contract (parse error, exception,
   * invalid view or draw output, WGSL that fails validation, the 250 ms step, the 50 ms slice, the post or send rate).
   * Called once per distinct error, with positions in the widget template's source; post it with `opencode.widget/report`
   * (`client: "web"`). The widget already shows it.
   */
  onReport?(error: WidgetError): void
  /**
   * A **client error**: this host failed, not the widget template (worker or WebAssembly crash, valid WGSL the GPU path
   * couldn't run, a shader or draw too slow on this device, Fullscreen API refusals, a failed `onAsk`). Never report
   * these; log them in dev mode only.
   */
  onClientError?(message: string, cause?: unknown): void
  /** The widget's recorded failure (`State.failure`); update it with `setFailure`. */
  failure?: WidgetFailure
  /**
   * "Ask agent to fix it" for a failure with `sent: false`: call `opencode.widget/report` with this error and
   * `ask: true`. Without it the button isn't offered (e.g. an artifact with no agent session).
   */
  onAsk?(error: WidgetError): void | Promise<void>
  /** Program warnings that aren't errors (an unknown node type): for dev logs. */
  onWarning?(message: string): void
  /** Timings: `compile`, `init` (first view on screen), `step`, `draw`, `gpu` (replaying a GPU batch), in ms. */
  onMetrics?(metric: { kind: "compile" | "init" | "step" | "draw" | "gpu"; ms: number }): void
  /** Text for the expand button and placeholders, if not English. */
  labels?: Partial<Labels>
  /**
   * What the widget shows for a program built for an older widget runtime (widgets.md, Protocol) instead of "This widget
   * was built with an older widget runtime; ask the agent to post it again". `onReport` still gets the spec's message.
   */
  olderRuntimeMessage?: string
}

export interface Labels {
  fullscreen: string
  exitFullscreen: string
  submitted: string
  dismissed: string
  restart: string
  retry: string
  network: string
  localNetwork: string
  release: string
  loading: string
  /** "Failed on {client}" before the failure's text. */
  failedOn: string
  ask: string
  asking: string
  told: string
}

/** A program error, as `opencode.widget/report` takes it: positions 1-based, in the widget template's source. */
export interface WidgetError {
  /** `init`, `event` (a handler or hook), `draw`, `main` (live), `shader`, ... */
  phase: string
  message: string
  line?: number
  column?: number
}

/** `State.failure`: the program error the server recorded, who reported it, and whether the agent was told. */
export interface WidgetFailure extends WidgetError {
  client: string
  sent: boolean
}

const LABELS: Labels = {
  fullscreen: "Full screen",
  exitFullscreen: "Exit full screen",
  submitted: "Submitted",
  dismissed: "Dismissed",
  restart: "Restart",
  retry: "Try again",
  network: "Network",
  release: "Esc to release",
  localNetwork: "local network allowed",
  loading: "Loading widget",
  failedOn: "Failed on",
  ask: "Ask agent to fix it",
  asking: "Asking the agent…",
  told: "The agent was told about this error.",
}

/** A mounted widget. */
export interface MountedWidget {
  /** The element the widget renders into (a child of the mount point, with an open shadow root). */
  readonly element: HTMLElement
  setTheme(theme: Theme): void
  /** The server's state changed (from any client): a final state makes it read-only and stops a live program. */
  setState(state: WidgetStatus, response?: unknown): void
  /** The server's `State.failure` changed (or went away): shown while the widget is open. */
  setFailure(failure: WidgetFailure | undefined): void
  /** Starts over: a fresh `init` (step) or a fresh `main` (live). */
  restart(): void
  /** Stops the program, frees everything, and removes the element. */
  destroy(): void
}

export interface HostOptions {
  /** URL of `widget_web_bg.wasm` (default: next to this module). */
  wasmUrl?: string | URL
  /** URL of `worker.js` (default: next to this module); a module worker. */
  workerUrl?: string | URL
  /** Live programs' slice budget, ms (default 50). */
  sliceBudgetMs?: number
}

// ---------- workers ----------

interface Program {
  pid: number
  refs: number
  compiled: Promise<{ error?: ErrorInfo; ms: number }>
}

class WorkerHandle {
  readonly worker: Worker
  readonly ready: Promise<void>
  private programs = new Map<string, Program>()
  private unused: string[] = []
  private compiled = new Map<number, (r: { error?: ErrorInfo; ms: number }) => void>()
  readonly widgets = new Map<number, Widget>()
  private requests = new Map<number, (m: FromWorker) => void>()
  dead = false

  constructor(
    private host: WidgetHost,
    module: Promise<WebAssembly.Module>,
  ) {
    const url = host.options.workerUrl
    this.worker = url
      ? new Worker(url, { type: "module", name: "psychoscript-widgets" })
      : new Worker(new URL("./worker.js", import.meta.url), { type: "module", name: "psychoscript-widgets" })
    let ready: () => void
    this.ready = new Promise((r) => (ready = r))
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      switch (m.t) {
        case "ready":
          ready()
          return
        case "compiled":
          this.compiled.get(m.pid)?.({ error: m.error, ms: m.ms })
          this.compiled.delete(m.pid)
          return
        case "stats":
        case "drawn": {
          const f = this.requests.get(m.req)
          this.requests.delete(m.req)
          f?.(m)
          return
        }
        case "crash":
          this.crash(m.message, m.wid)
          return
        default:
          this.widgets.get(m.wid)?.receive(m)
      }
    }
    this.worker.onerror = (e) => this.crash(e.message || "the worker failed to start")
    void module.then(
      (m) => this.send({ t: "init", module: m }),
      (e) => this.crash(`can't load the WebAssembly module: ${String(e?.message ?? e)}`),
    )
  }

  send(m: ToWorker) {
    if (!this.dead) this.worker.postMessage(m)
  }

  request(m: ToWorker & { req: number }): Promise<FromWorker> {
    return new Promise((resolve) => {
      this.requests.set(m.req, resolve)
      this.send(m)
    })
  }

  /** Compiles `text` (once per worker) for `live` or step runs. */
  acquire(text: string, live: boolean): Program {
    const key = (live ? "L" : "S") + text
    let p = this.programs.get(key)
    if (!p) {
      const pid = this.host.nextId()
      const compiled = new Promise<{ error?: ErrorInfo; ms: number }>((r) => this.compiled.set(pid, r))
      p = { pid, refs: 0, compiled }
      this.programs.set(key, p)
      void this.ready.then(() => this.send({ t: "compile", pid, program: text, live }))
    }
    const i = this.unused.indexOf(key)
    if (i >= 0) this.unused.splice(i, 1)
    p.refs++
    return p
  }

  /** Keeps up to 8 programs nobody uses compiled, for widgets that come back (scrolling). */
  release(text: string, live: boolean) {
    const key = (live ? "L" : "S") + text
    const p = this.programs.get(key)
    if (!p || --p.refs > 0) return
    this.unused.push(key)
    while (this.unused.length > 8) {
      const old = this.unused.shift()!
      const q = this.programs.get(old)
      this.programs.delete(old)
      if (q) this.send({ t: "release", pid: q.pid })
    }
  }



  private crash(message: string, wid?: number) {
    if (this.dead) return
    this.dead = true
    this.worker.terminate()
    for (const f of this.requests.values()) f({ t: "crash", message })
    this.requests.clear()
    for (const f of this.compiled.values()) f({ error: { type: "crash", message }, ms: 0 })
    this.host.lost(this, message, wid)
  }

  terminate() {
    this.dead = true
    this.worker.terminate()
    this.host.ended(this)
  }
}

// ---------- the host ----------

/** Loads the WebAssembly once and runs every widget of a page: step widgets share one worker, each live widget has its own. */
export class WidgetHost {
  private ids = 0
  private module: Promise<WebAssembly.Module> | undefined
  private stepWorker: WorkerHandle | undefined
  private liveWorkers = new Set<WorkerHandle>()
  readonly ticker = new Ticker()
  readonly images: Images
  private observer: IntersectionObserver | undefined
  private observed = new Map<Element, Widget>()
  private widgets = new Set<Widget>()
  private resolvers = new Set<(src: string) => string | undefined>()

  constructor(readonly options: HostOptions = {}) {
    this.images = new Images((src) => defaultImage(src))
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", () => {
        for (const w of this.widgets) w.visibility()
      })
  }

  nextId(): number {
    return ++this.ids
  }

  /** Loads and compiles the WebAssembly and starts (and warms) the step worker now rather than at the first mount. */
  preload(): Promise<void> {
    return this.steps().ready
  }

  languageModule(): Promise<WebAssembly.Module> {
    this.module ??= compile(this.options.wasmUrl ?? new URL("./widget_web_bg.wasm", import.meta.url))
    return this.module
  }

  steps(): WorkerHandle {
    if (!this.stepWorker || this.stepWorker.dead) this.stepWorker = new WorkerHandle(this, this.languageModule())
    return this.stepWorker
  }

  live(): WorkerHandle {
    const w = new WorkerHandle(this, this.languageModule())
    this.liveWorkers.add(w)
    return w
  }

  ended(worker: WorkerHandle) {
    this.liveWorkers.delete(worker)
  }

  /** Each running worker's WebAssembly memory (the interpreter's heap and code data), compiled programs and widgets. */
  async stats(): Promise<{ kind: "step" | "live"; wasmBytes: number; programs: number; widgets: number }[]> {
    const workers: [WorkerHandle, "step" | "live"][] = [...this.liveWorkers].map((w) => [w, "live"])
    if (this.stepWorker && !this.stepWorker.dead) workers.unshift([this.stepWorker, "step"])
    return Promise.all(
      workers.map(async ([w, kind]) => {
        await w.ready
        const m = await w.request({ t: "stats", req: this.nextId() })
        return m.t === "stats" ? { kind, wasmBytes: m.wasmBytes, programs: m.programs, widgets: m.widgets } : { kind, wasmBytes: 0, programs: 0, widgets: 0 }
      }),
    )
  }

  /** A worker died: its widgets start again, but the one whose program crashed it shows the error. */
  lost(worker: WorkerHandle, message: string, culprit?: number) {
    if (worker === this.stepWorker) this.stepWorker = undefined
    this.liveWorkers.delete(worker)
    for (const w of [...worker.widgets.values()]) w.crashed(message, w.wid === culprit || worker.widgets.size === 1)
  }

  mount(el: HTMLElement, options: MountOptions): MountedWidget {
    const w = new Widget(this, el, options)
    this.widgets.add(w)
    return w
  }

  observe(el: Element, w: Widget) {
    this.observer ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) this.observed.get(e.target)?.intersecting(e.isIntersecting)
      },
      { rootMargin: "200px 0px" },
    )
    this.observed.set(el, w)
    this.observer.observe(el)
  }

  forget(w: Widget) {
    this.widgets.delete(w)
    this.observed.delete(w.element)
    this.observer?.unobserve(w.element)
  }

  /** Stops every widget and worker. */
  destroy() {
    for (const w of [...this.widgets]) w.destroy()
    this.stepWorker?.terminate()
    this.stepWorker = undefined
    this.observer?.disconnect()
  }
}

async function compile(url: string | URL): Promise<WebAssembly.Module> {
  const response = fetch(url, { credentials: "same-origin" })
  try {
    return await WebAssembly.compileStreaming(response)
  } catch {
    // A server that doesn't send `application/wasm`.
    const r = await fetch(url, { credentials: "same-origin" })
    if (!r.ok) throw new Error(`${r.status} for ${String(url)}`)
    return WebAssembly.compile(await r.arrayBuffer())
  }
}

function defaultImage(src: string): string | undefined {
  return /^(https?:|data:image\/)/i.test(src) ? src : undefined
}

// ---------- one widget ----------

class Widget implements MountedWidget {
  readonly element: HTMLElement
  readonly wid: number
  private shadow: ShadowRoot
  private root: HTMLDivElement
  private viewEl: HTMLDivElement
  private errorEl: HTMLDivElement
  private statusEl: HTMLDivElement
  private failureEl: HTMLDivElement
  private failure: WidgetFailure | undefined
  private asking = false
  /** The program error shown on the widget now (error card or inline), if any. */
  private shown: WidgetError | undefined
  private reported = new Set<string>()
  private offset: number | null | undefined
  private expand: HTMLButtonElement
  private theme: Resolved
  private status: WidgetStatus
  private response: unknown
  private worker: WorkerHandle | undefined
  private program: { text: string; live: boolean } | undefined
  private view: ViewNode | undefined
  private started = false
  private visible = false
  private inView = false
  private destroyed = false
  private paused = false
  private ctx: RenderContext
  private draws = new Map<number, (r: { commands?: Command[]; error?: string; ms: number }) => void>()
  private live: {
    commands: Map<string | null, Command[]>
    frameWanted: boolean
    startedAt: number
    pausedAt: number | undefined
    pausedTotal: number
    lastFrame: number
    running: boolean
  } = { commands: new Map(), frameWanted: false, startedAt: 0, pausedAt: undefined, pausedTotal: 0, lastFrame: 0, running: false }
  private sends: number[] = []
  private mountedAt = performance.now()
  private firstView = false
  private warned = new Set<string>()
  private isFullscreen = false
  private onFullscreen = () => this.fullscreenChanged()
  private input: Input
  private hint: HTMLDivElement
  /** A live program called `widget.capturePointer()` (and not `releasePointer()` since). */
  private livePointer = false

  constructor(
    private host: WidgetHost,
    mountPoint: HTMLElement,
    private options: MountOptions,
  ) {
    this.wid = host.nextId()
    this.status = options.state ?? "open"
    this.response = options.response
    this.theme = resolve(options.theme)
    const doc = mountPoint.ownerDocument
    this.element = doc.createElement("div")
    this.element.className = "psychoscript-widget"
    this.shadow = this.element.attachShadow({ mode: "open" })
    this.shadow.adoptedStyleSheets = [stylesheet()]
    apply(this.element, this.theme)
    this.root = doc.createElement("div")
    this.root.className = "pw-root"
    this.viewEl = doc.createElement("div")
    this.viewEl.className = "pw-view"
    this.errorEl = doc.createElement("div")
    this.errorEl.className = "pw-error"
    this.errorEl.hidden = true
    this.statusEl = doc.createElement("div")
    this.statusEl.className = "pw-status"
    this.statusEl.hidden = true
    this.expand = doc.createElement("button")
    this.expand.type = "button"
    this.expand.className = "pw-expand"
    this.expand.hidden = true
    this.expand.addEventListener("click", () => void this.toggleFullscreen())
    const hosts = options.mode === "live" ? options.capabilities?.https?.hosts : undefined
    if (hosts?.length) {
      const chip = doc.createElement("div")
      chip.className = "pw-chip"
      chip.textContent = `${this.label("network")}: ${hosts.join(", ")}${options.allowLocalNetwork ? ` (${this.label("localNetwork")})` : ""}`
      chip.title = chip.textContent
      this.root.append(chip)
    }
    this.hint = doc.createElement("div")
    this.hint.className = "pw-hint"
    this.hint.hidden = true
    this.hint.setAttribute("role", "note")
    this.failureEl = doc.createElement("div")
    this.failureEl.className = "pw-failure"
    this.failureEl.hidden = true
    this.failure = options.failure
    this.root.append(this.expand, this.hint, this.viewEl, this.errorEl, this.failureEl, this.statusEl)
    this.shadow.append(this.root)
    this.loading()
    mountPoint.append(this.element)
    doc.addEventListener("fullscreenchange", this.onFullscreen)
    this.ctx = {
      doc,
      emit: (e) => this.emit(e),
      readOnly: () => this.status !== "open",
      theme: () => this.theme,
      visible: () => this.visible,
      fullscreen: () => this.isFullscreen,
      closeRect: () => (this.isFullscreen ? this.expand.getBoundingClientRect() : null),
      images: host.images,
      resolveImage: (src) => (options.resolveImage ? options.resolveImage(src) : defaultImage(src)),
      draw: this.mode() === "step" ? (frame) => this.draw(frame) : undefined,
      liveCommands: (id) => this.live.commands.get(id),
      warn: (m) => this.warn(m),
      programError: (phase, e) => this.report(phase, e),
      clientError: (m, cause) => this.clientError(m, cause),
      gpuRun: this.gpuRun,
      ticker: host.ticker,
    }
    if (options.resolveImage) {
      // Images on canvases resolve through this widget's resolver.
      this.ctx.images = new Images(options.resolveImage)
    }
    this.input = new Input({
      element: this.element,
      shadow: this.shadow,
      ticker: host.ticker,
      open: () => this.status === "open" && !this.destroyed,
      emit: (e) => this.emit(e),
      wantsPointer: () => this.livePointer || this.view?.capture === "pointer",
      pointerReleased: () => (this.livePointer = false),
      escape: () => {
        if (this.isFullscreen) void this.closeFullscreen()
      },
      pointerId: () => this.pointerSurface()?.id ?? "",
      pointerSize: () => {
        const s = this.pointerSurface()
        return { width: s?.width ?? 0, height: s?.height ?? 0 }
      },
      changed: (focused, captured, keys) => {
        if (focused) this.element.dataset.focused = ""
        else delete this.element.dataset.focused
        this.updateHint(focused, captured, keys)
      },
    })
    this.renderStatus()
    host.observe(this.element, this)
  }

  private mode(): "step" | "live" {
    return this.options.mode === "live" ? "live" : "step"
  }

  private label(k: keyof Labels): string {
    return this.options.labels?.[k] ?? LABELS[k]
  }

  private warn(message: string) {
    if (this.warned.size < 50 && !this.warned.has(message)) {
      this.warned.add(message)
      this.options.onWarning?.(message)
    }
  }

  private metric(kind: "compile" | "init" | "step" | "draw" | "gpu", ms: number) {
    this.options.onMetrics?.({ kind, ms })
  }

  // ---------- visibility ----------

  intersecting(on: boolean) {
    this.inView = on
    this.visibility()
  }

  visibility() {
    const visible = this.inView && !document.hidden
    if (visible === this.visible) return
    this.visible = visible
    if (visible) {
      if (!this.started) this.start()
      for (const s of surfaces(this.viewEl)) s.wake()
    }
    if (this.mode() === "live") this.livePause(!visible)
  }

  // ---------- start ----------

  private start() {
    if (this.destroyed) return
    this.started = true
    const live = this.mode() === "live"
    if (live && this.status !== "open") {
      // A finished live widget has nothing to run: its last view lived on the client that ran it.
      this.viewEl.replaceChildren()
      this.renderStatus()
      return
    }
    // A program built for another prelude<->host contract isn't run (widgets.md, Protocol): an older one is the widget
    // template's error, reported in the phase refused; a newer one is this host's, logged and not reported.
    const version = protocol(this.options.program)
    if (version !== PROTOCOL) {
      const phase = live ? "main" : "init"
      const e: ErrorInfo = { type: "protocol", message: version < PROTOCOL ? OLDER : NEWER }
      if (version < PROTOCOL) this.report(phase, e)
      else this.clientError(NEWER)
      // Running it again can't help: no "Try again".
      const shown = version < PROTOCOL && this.options.olderRuntimeMessage ? { ...e, message: this.options.olderRuntimeMessage } : e
      return this.fatal(shown, version < PROTOCOL ? phase : undefined, false)
    }
    const worker = live ? this.host.live() : this.host.steps()
    this.worker = worker
    worker.widgets.set(this.wid, this)
    const text = this.options.program
    this.program = { text, live }
    const p = worker.acquire(text, live)
    const data = JSON.stringify(this.options.data ?? null)
    void p.compiled.then((r) => {
      if (this.worker !== worker || this.destroyed) return
      if (r.ms > 0) this.metric("compile", r.ms)
      if (r.error) {
        const e = this.relative(r.error)
        this.problem(live ? "main" : "init", e)
        return this.fatal(e, live ? "main" : "init")
      }
      if (live) {
        // A new run: no strikes yet.
        this.strikes = new Strikes()
        this.gpuHung = false
        this.live = { ...this.live, commands: new Map(), frameWanted: false, startedAt: performance.now(), pausedAt: undefined, pausedTotal: 0, running: true }
        this.paused = false
        // The widget template's lines: errors in the preludes, and GPU batches' posts, are located in it.
        const offset = this.prelude()
        worker.send({
          t: "live",
          wid: this.wid,
          pid: p.pid,
          data,
          hosts: this.options.capabilities?.https?.hosts,
          localNetwork: this.options.allowLocalNetwork === true,
          sliceBudgetMs: this.host.options.sliceBudgetMs ?? SLICE_BUDGET_MS,
          gpu: gpuInput(),
          programLines: offset === null ? undefined : [offset + 1, text.split("\n").length],
        })
        if (!this.visible) this.livePause(true)
      } else worker.send({ t: "open", wid: this.wid, pid: p.pid, data })
    })
  }

  private stopWorker() {
    this.gpu?.destroy()
    this.gpu = undefined
    const worker = this.worker
    if (!worker) return
    this.worker = undefined
    worker.widgets.delete(this.wid)
    if (this.program) worker.release(this.program.text, this.program.live)
    if (this.program?.live) {
      worker.send({ t: "stop", wid: this.wid })
      // Let the stop's cancellations go out, then end the worker and its memory.
      setTimeout(() => worker.terminate(), 50)
    } else worker.send({ t: "close", wid: this.wid })
    for (const f of this.draws.values()) f({ error: "stopped", ms: 0 })
    this.draws.clear()
    this.live.running = false
  }

  restart() {
    if (this.destroyed) return
    this.stopWorker()
    this.errorEl.hidden = true
    this.shown = undefined
    this.renderFailure()
    this.firstView = false
    this.mountedAt = performance.now()
    this.started = false
    if (this.visible) this.start()
  }

  crashed(message: string, culprit: boolean) {
    this.worker = undefined
    this.live.running = false
    this.clientError(`the widget runtime crashed: ${message}`)
    if (culprit) this.fatal({ type: "crash", message: `The widget runtime crashed: ${message}` })
    else this.restart()
  }

  // ---------- from the worker ----------

  receive(m: FromWorker) {
    if (this.destroyed) return
    switch (m.t) {
      case "step":
        return this.stepped(m)
      case "posts":
        for (const p of m.messages) this.posted(p as { type?: string; [k: string]: unknown })
        return
      case "warning":
        // A warning with a phase is a program error the run survives.
        return m.phase ? this.report(m.phase, { message: m.message }) : this.warn(m.message)
      case "exit":
        return this.exited(m.exit)
    }
  }

  private stepped(m: Extract<FromWorker, { t: "step" }>) {
    if (m.error) {
      const e = this.relative(m.error)
      // A view that breaks a rule of views fails in phase `view`, keeping the state and view.
      const phase = e.phase ?? m.phase
      this.problem(phase, e)
      if (!this.view) return this.fatal(e, phase)
      this.inlineError(e, phase)
      return
    }
    this.metric("step", m.ms)
    this.errorEl.hidden = true
    this.shown = undefined
    this.renderFailure()
    const out = m.output as StepOutput
    this.render(out.view)
    if (out.send !== undefined) this.send(out.send.value, out.send.wake !== false)
    if (out.submit !== undefined) this.finish("submitted", out.submit)
    else if (out.dismiss) this.finish("dismissed")
  }

  private posted(p: { type?: string; [k: string]: unknown }) {
    switch (p.type) {
      case "render":
        // The GPU canvases' ids by key: GPU contexts find their canvases by key (widgets-gpu.md, Transport).
        this.gpuKeys = (p.gpu && typeof p.gpu === "object" ? p.gpu : {}) as Record<string, string>
        if (p.node && typeof p.node === "object") this.render(p.node as ViewNode)
        return
      case "draw": {
        // Checked when posted (widgets-live.md): the canvas's id and valid commands.
        const id = p.id as string
        const commands = p.commands as Command[]
        this.live.commands.set(id, commands)
        for (const s of surfaces(this.viewEl)) if (s instanceof CanvasView && s.id === id) s.setCommands(commands)
        return
      }
      case "frame":
        // A frame request may carry the GPU batch recorded before it (widgets-gpu.md, Transport): replayed first; then
        // the frame ends. One while a frame is pending changes nothing but its batch, a plain one.
        if (p.gpu !== undefined) this.gpuBatch(p.gpu, !this.live.frameWanted, p.at)
        if (!this.live.frameWanted) this.gpu?.frame()
        this.live.frameWanted = true
        this.host.ticker.add(this.liveTick)
        return
      case "gpu":
        if (p.batch !== undefined) this.gpuBatch(p.batch, false, p.at)
        return
      case "submit":
        this.finish("submitted", p.value ?? null)
        return
      case "dismiss":
        this.finish("dismissed")
        return
      case "send":
        this.send(p.value ?? null, p.wake !== false)
        return
      case "capture":
        // widget.capturePointer() / releasePointer(): granted on the next click inside the widget.
        this.livePointer = p.value === true
        this.input.refresh()
        return
    }
  }

  private exited(exit: LiveExit) {
    this.live.running = false
    // The run is over (returned, failed or stopped): its worker and memory go; the last view stays.
    this.stopWorker()
    if (exit.type === "failed" && this.status === "open") {
      const e = this.relative(exit.error)
      // A fetch rejection the program let escape is a fetch error: the run's error has the rejection's kind.
      const phase = e.phase ?? (FETCH_KINDS.includes(e.kind ?? "") ? "fetch" : "main")
      this.problem(phase, e)
      this.inlineError(e, phase, true)
    }
  }

  // ---------- rendering ----------

  private loading() {
    const l = this.element.ownerDocument.createElement("div")
    l.className = "pw-loading"
    l.setAttribute("aria-label", this.label("loading"))
    l.setAttribute("role", "progressbar")
    this.viewEl.replaceChildren(l)
  }

  private render(node: ViewNode) {
    if (this.view === undefined) this.viewEl.replaceChildren()
    this.view = node
    reconcile(this.ctx, this.viewEl, [node])
    if (this.gpuUnavailable) for (const s of surfaces(this.viewEl)) if (s instanceof WebGpuCanvasView) s.placeholder()
    // A run stopped by its strikes: its shaders rendered anew stay stopped.
    if (this.gpuHung) for (const s of surfaces(this.viewEl)) if (s instanceof GpuCanvasView) s.stopHung()
    // A stopped GPU canvas rendered anew (a new element) still shows its placeholder: with its error, or, lost, alone.
    if (this.gpu)
      for (const key of Object.keys(this.gpuKeys)) {
        const message = this.gpu.placeholderFor(key)
        if (message !== undefined) this.gpuCanvas(key)?.placeholder(message ?? undefined)
      }
    this.updateExpand()
    this.input.refresh()
    if (!this.firstView) {
      this.firstView = true
      const at = performance.now()
      requestAnimationFrame(() => this.metric("init", at - this.mountedAt))
    }
  }

  /** The canvas or shader captured pointer events go to: the first that takes pointer input. */
  private pointerSurface() {
    return surfaces(this.viewEl).find((s) => s.id !== null && s.node.pointer === true)
  }

  /**
   * The focus hint: a keyboard icon plus "Esc" (a cursor icon while the pointer is captured). Touch devices show it only
   * once a hardware keyboard typed, and then the icon alone.
   */
  private updateHint(focused: boolean, captured: boolean, keys: boolean) {
    const touch = matchMedia("(hover: none) and (pointer: coarse)").matches
    const show = (focused || captured) && (!touch || keys)
    this.hint.hidden = !show
    if (!show) return
    const mode = captured ? "pointer" : "keyboard"
    const compact = touch && !captured
    if (this.hint.dataset.mode === mode && this.hint.dataset.compact === String(compact)) return
    this.hint.dataset.mode = mode
    this.hint.dataset.compact = String(compact)
    const label = this.label("release")
    this.hint.title = label
    this.hint.setAttribute("aria-label", label)
    this.hint.replaceChildren(
      icon(this.ctx, captured ? "M4 2.5l8 5.8-3.6.7 2 4.1-1.6.8-2-4.1L4 12.3z" : "M1.5 4.5h13v7h-13zM4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.2h6"),
    )
    if (!compact) {
      const esc = this.element.ownerDocument.createElement("span")
      esc.textContent = "Esc"
      this.hint.append(esc)
    }
  }

  private updateExpand() {
    const want = this.view?.fullscreen
    const offer =
      this.status === "open" &&
      document.fullscreenEnabled !== false &&
      typeof this.element.requestFullscreen === "function" &&
      (want === true || (want !== false && (this.mode() === "live" || hasSurface(this.view))))
    this.expand.hidden = !offer && !this.isFullscreen
    const label = this.label(this.isFullscreen ? "exitFullscreen" : "fullscreen")
    if (this.expand.title !== label) {
      this.expand.title = label
      this.expand.setAttribute("aria-label", label)
      this.expand.replaceChildren(
        icon(this.ctx, this.isFullscreen ? "M4 4l8 8M12 4l-8 8" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"),
      )
    }
  }

  private inlineError(e: ErrorInfo, phase: string, restart = false) {
    this.shown = { phase, message: e.message }
    this.errorEl.replaceChildren(describe(e))
    if (restart) this.errorEl.append(this.button(this.label("restart"), () => this.restart()))
    this.errorEl.hidden = false
    this.renderFailure()
  }

  private button(text: string, f: () => void): HTMLButtonElement {
    const b = this.element.ownerDocument.createElement("button")
    b.type = "button"
    b.className = "pw-btn pw-secondary"
    b.style.marginTop = "6px"
    b.style.display = "block"
    b.textContent = text
    b.addEventListener("click", f)
    return b
  }

  /** The first step failed (or the program didn't compile): an error card instead of a view, with "Try again" (`retry`). */
  private fatal(e: ErrorInfo, phase?: string, retry = true) {
    this.shown = phase ? { phase, message: e.message } : undefined
    for (const el of this.viewEl.children) destroyTree(el)
    this.view = undefined
    const card = this.element.ownerDocument.createElement("div")
    card.className = "pw-error-card"
    const msg = this.element.ownerDocument.createElement("div")
    msg.className = "pw-error"
    msg.style.marginTop = "0"
    msg.textContent = describe(e)
    card.append(msg)
    if (retry && this.status === "open") card.append(this.button(this.label(this.mode() === "live" ? "restart" : "retry"), () => this.restart()))
    this.viewEl.replaceChildren(card)
    this.errorEl.hidden = true
    this.updateExpand()
    this.renderFailure()
  }

  // ---------- failures (widgets.md, Failures) ----------

  /** Classifies a failure: the widget template's (reported) or this host's (logged). */
  private problem(phase: string, e: ErrorInfo) {
    if (programError(e, phase)) this.report(phase, e)
    else this.clientError(`${phase}: ${describe(e)}`, e)
  }

  /** A program error: once per distinct error, to the embedder's report hook. */
  private report(phase: string, e: { message: string; line?: number; column?: number }) {
    if (this.status !== "open") return
    const error: WidgetError = { phase, message: e.message }
    if (e.line !== undefined) error.line = e.line
    if (e.column !== undefined && e.line !== undefined) error.column = e.column
    const key = JSON.stringify(error)
    if (this.reported.has(key)) return
    this.reported.add(key)
    try {
      this.options.onReport?.(error)
    } catch (cause) {
      this.clientError("onReport threw", cause)
    }
  }

  private clientError(message: string, cause?: unknown) {
    try {
      this.options.onClientError?.(message, cause)
    } catch {}
  }

  /** Lines in the program before the widget template's first line, or null when unknown. */
  private prelude(): number | null {
    if (this.offset !== undefined) return this.offset
    const program = this.options.program
    const lines = (s: string) => s.split("\n").length
    const source = this.options.source
    if (source !== undefined && program.endsWith(source)) this.offset = lines(program) - lines(source)
    else {
      // Without `source`: a live program's live prelude ends with `__widget_live`, the step prelude with
      // `__widget_dispatch`; the widget template starts on the line after its closing brace.
      const live = program.lastIndexOf("async function __widget_live(")
      const at = live >= 0 ? live : program.lastIndexOf("function __widget_dispatch(")
      const end = at < 0 ? -1 : program.indexOf("\n}\n", at)
      // program = prelude + "\n" + source: skip that joining newline too.
      const start = end < 0 ? -1 : end + 3 + (program[end + 3] === "\n" ? 1 : 0)
      this.offset = start < 0 ? null : lines(program.slice(0, start)) - 1
    }
    return this.offset
  }

  /** `e` with its position in the widget template's source: dropped when it falls in the prelude or past the widget template. */
  private relative(e: ErrorInfo): ErrorInfo {
    if (e.line === undefined) return e
    const offset = this.prelude()
    const total = this.options.program.split("\n").length
    // The language puts the program-absolute place at the end of a runtime message too: the fields carry it now.
    const message = e.message.replace(new RegExp(`\\s*\\(line ${e.line}, col(?:umn)? \\d+\\)\\.?$`), "")
    const { line: _, column: __, ...rest } = { ...e, message }
    if (offset === null || e.line <= offset || e.line > total) return rest
    return { ...rest, line: e.line - offset, column: e.column }
  }

  setFailure(failure: WidgetFailure | undefined) {
    this.failure = failure
    this.renderFailure()
  }

  /** "Failed on <client>: <phase>: <message> (line N, col M)", then "Ask agent to fix it" or "The agent was told". */
  private renderFailure() {
    const f = this.status === "open" ? this.failure : undefined
    this.failureEl.hidden = !f
    if (!f) return this.failureEl.replaceChildren()
    const doc = this.element.ownerDocument
    const parts: Node[] = []
    // The same error already on screen (this client hit it) isn't repeated.
    if (!(this.shown && this.shown.phase === f.phase && this.shown.message === f.message)) {
      const text = doc.createElement("div")
      text.className = "pw-failure-text"
      const where = f.line !== undefined ? ` (line ${f.line}${f.column !== undefined ? `, col ${f.column}` : ""})` : ""
      text.textContent = `${this.label("failedOn")} ${f.client}: ${f.phase}: ${f.message}${where}`
      parts.push(text)
    }
    if (f.sent) {
      const told = doc.createElement("div")
      told.className = "pw-failure-told"
      told.textContent = this.label("told")
      parts.push(told)
    } else if (this.options.onAsk) {
      const b = doc.createElement("button")
      b.type = "button"
      b.className = "pw-btn pw-secondary pw-ask"
      b.textContent = this.label(this.asking ? "asking" : "ask")
      b.disabled = this.asking
      b.addEventListener("click", () => void this.ask())
      parts.push(b)
    }
    this.failureEl.replaceChildren(...parts)
    this.failureEl.hidden = parts.length === 0
  }

  private async ask() {
    const f = this.failure
    if (!f || f.sent || this.asking || !this.options.onAsk) return
    const { client: _, sent: __, ...error } = f
    this.asking = true
    this.renderFailure()
    try {
      await this.options.onAsk(error)
    } catch (cause) {
      this.clientError("asking the agent about a widget error failed", cause)
    } finally {
      this.asking = false
      this.renderFailure()
    }
  }

  private renderStatus() {
    this.renderFailure()
    if (this.status === "open") {
      this.statusEl.hidden = true
      this.root.classList.remove("pw-readonly")
      return
    }
    this.root.classList.add("pw-readonly")
    let text = this.label(this.status === "submitted" ? "submitted" : "dismissed")
    if (this.status === "submitted" && this.response !== undefined) text += `: ${summary(this.response)}`
    this.statusEl.textContent = text
    this.statusEl.hidden = false
  }

  // ---------- events ----------

  private emit(e: WidgetEvent) {
    if (this.status !== "open" || !this.worker) return
    this.worker.send({ t: "event", wid: this.wid, event: e })
  }

  private draw(frame: Frame): Promise<{ commands?: Command[]; error?: string; ms: number }> {
    const worker = this.worker
    if (!worker || !this.view) return Promise.resolve({ error: "not running", ms: 0 })
    const req = this.host.nextId()
    return new Promise((resolve) => {
      this.draws.set(req, resolve)
      void worker.request({ t: "draw", wid: this.wid, req, frame }).then((m) => {
        this.draws.delete(req)
        if (m.t !== "drawn") return resolve({ error: "the runtime stopped", ms: 0 })
        this.metric("draw", m.ms)
        if (m.error) this.problem("draw", this.relative(m.error))
        resolve({ commands: m.commands as Command[] | undefined, error: m.error ? describe(m.error) : undefined, ms: m.ms })
      })
    })
  }

  private send(value: unknown, wake: boolean) {
    const now = performance.now()
    this.sends = this.sends.filter((t) => now - t < 1000)
    if (this.sends.length >= 10)
      return this.report(this.mode() === "live" ? "main" : "event", { message: "more than 10 sends in a second (rate_limited): dropped" })
    this.sends.push(now)
    this.options.onSend?.(value, wake)
  }

  private finish(status: "submitted" | "dismissed", value?: unknown) {
    if (this.status !== "open") return
    this.status = status
    this.response = value
    if (this.isFullscreen) void document.exitFullscreen().catch(() => {})
    if (status === "submitted") this.options.onSubmit?.(value)
    else this.options.onDismiss?.()
    if (this.mode() === "live") this.stopWorker()
    this.refreshControls()
    this.renderStatus()
  }

  setState(state: WidgetStatus, response?: unknown) {
    if (state === this.status) {
      if (response !== undefined) {
        this.response = response
        this.renderStatus()
      }
      return
    }
    this.status = state
    if (response !== undefined) this.response = response
    if (state !== "open" && this.mode() === "live") this.stopWorker()
    this.refreshControls()
    this.renderStatus()
    if (state === "open") this.restart()
  }

  private refreshControls() {
    if (this.view) reconcile(this.ctx, this.viewEl, [this.view])
    this.updateExpand()
    this.input.refresh()
  }

  setTheme(theme: Theme) {
    this.theme = resolve(theme)
    apply(this.element, this.theme)
    for (const s of surfaces(this.viewEl)) {
      if (s instanceof CanvasView) {
        s.repaint()
        s.invalidate()
      }
    }
  }

  // ---------- live ----------

  private livePause(pause: boolean) {
    if (!this.worker || !this.live.running || pause === this.paused) return
    this.paused = pause
    if (pause) this.live.pausedAt = performance.now()
    else if (this.live.pausedAt !== undefined) {
      this.live.pausedTotal += performance.now() - this.live.pausedAt
      this.live.pausedAt = undefined
    }
    this.worker.send({ t: pause ? "pause" : "resume", wid: this.wid })
    if (!pause && this.live.frameWanted) this.host.ticker.add(this.liveTick)
  }

  // ---------- GPU canvases (widgets-gpu.md) ----------

  private gpu: GpuReplay | undefined
  private gpuUnavailable = false
  /**
   * The run's strikes (widgets-gpu.md, Strikes): its GPU work unfinished at a device loss, its live device's or the
   * shaders' shared one, one a loss, if its work finished on a device since its last strike. The first changes nothing;
   * a second within 30 s stops every GPU canvas of the run for the rest of it (no new device restarts them), with one
   * client error; later ones report nothing more.
   */
  private strikes = new Strikes()
  private gpuHung = false
  private readonly gpuRun: Run = {
    finished: () => this.strikes.done(),
    strike: () => {
      if (this.gpuHung || !this.strikes.strike()) return
      this.gpuHung = true
      this.clientError(GPU_HANG)
      this.gpu?.stopAll()
      for (const s of surfaces(this.viewEl)) if (s instanceof GpuCanvasView) s.stopHung()
    },
  }
  private gpuKeys: Record<string, string> = {}

  /** The GPU canvas with this key in the last rendered view. */
  private gpuCanvas(key: string): WebGpuCanvasView | undefined {
    const id = Object.hasOwn(this.gpuKeys, key) ? this.gpuKeys[key] : undefined
    return id === undefined ? undefined : surfaces(this.viewEl).find((s): s is WebGpuCanvasView => s instanceof WebGpuCanvasView && s.id === id)
  }

  /** A batch as posted, for the checks and the replay; `boundary`: a frame request's, ending the frame; `at`: its post's
   * line and column in the program, where its errors are reported. */
  private gpuBatch(batch: unknown, boundary: boolean, at: unknown) {
    this.gpu ??= new GpuReplay({
      canvas: (key) => this.gpuCanvas(key),
      keys: () => new Set(Object.keys(this.gpuKeys)),
      programError: (message, at) => this.report("gpu", this.relative({ type: "gpu", message, line: at?.[0], column: at?.[1] })),
      metric: (ms) => this.metric("gpu", ms),
      nextFrame: (f) => {
        const once = () => {
          this.host.ticker.delete(once)
          f()
        }
        this.host.ticker.add(once)
      },
      clientError: (message, cause) => this.clientError(message, cause),
      run: this.gpuRun,
      lost: (reason, message) => this.worker?.send({ t: "deliver", wid: this.wid, message: { type: "gpu", lost: reason, message } }),
      unavailable: () => {
        this.gpuUnavailable = true
        for (const s of surfaces(this.viewEl)) if (s instanceof WebGpuCanvasView) s.placeholder()
      },
    })
    this.gpu.batch(batch, boundary, at as [number, number] | undefined)
  }

  /**
   * Before a frame, the first one too: `{ type: "canvas", key, width, height }` (physical pixels clamped to the texture
   * limit: the canvas's backing size) for each GPU canvas whose size changed.
   */
  private gpuSizes() {
    for (const key of Object.keys(this.gpuKeys)) {
      const s = this.gpuCanvas(key)
      if (!s || !s.sized()) continue
      const { width, height } = s.canvas
      const size = `${width}x${height}`
      if (size === s.sent) continue
      s.sent = size
      this.worker?.send({ t: "deliver", wid: this.wid, message: { type: "canvas", key, width, height } })
    }
  }

  private liveTick = (now: number) => {
    if (!this.live.frameWanted || !this.worker || !this.live.running) return this.host.ticker.delete(this.liveTick)
    if (!this.visible || this.paused) return this.host.ticker.delete(this.liveTick)
    const surface = surfaces(this.viewEl).find((s): s is CanvasView | WebGpuCanvasView => s instanceof CanvasView || s instanceof WebGpuCanvasView)
    const rect = this.viewEl.getBoundingClientRect()
    // Never a frame with a zero size (widgets.md, Canvas): keep the request until the canvas, or the view, has one.
    if (surface ? !surface.sized() : rect.width < 1 || rect.height < 1) return
    this.live.frameWanted = false
    this.host.ticker.delete(this.liveTick)
    const t = (now - this.live.startedAt - this.live.pausedTotal) / 1000
    const dt = this.live.lastFrame ? (now - this.live.lastFrame) / 1000 : 0
    this.live.lastFrame = now
    const frame: Frame = surface
      ? { ...surface.frame(dt), t }
      : {
          id: null,
          t,
          dt,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          scale: globalThis.devicePixelRatio || 1,
          pointer: null,
          dark: this.theme.dark,
          fullscreen: this.isFullscreen,
          close: this.closeInRoot(),
        }
    this.gpuSizes()
    this.worker.send({ t: "deliver", wid: this.wid, message: { type: "frame", frame } })
  }

  // ---------- full screen ----------

  private async toggleFullscreen() {
    try {
      if (this.isFullscreen) await this.closeFullscreen()
      else await this.element.requestFullscreen({ navigationUI: "hide" })
    } catch (e) {
      this.clientError(`full screen: ${String((e as Error)?.message ?? e)}`, e)
    }
  }

  private async closeFullscreen() {
    if (document.fullscreenElement === this.element) await document.exitFullscreen().catch(() => {})
  }

  /** The close button's area in the root node's coordinates, or null when not full screen. */
  private closeInRoot(): Rect | null {
    if (!this.isFullscreen) return null
    const root = (this.viewEl.firstElementChild as HTMLElement | null) ?? this.viewEl
    return rectIn(this.expand.getBoundingClientRect(), root.getBoundingClientRect())
  }

  /** Tells the program it's full screen (or not) and where the close button is; again when that area moves. */
  private announceFullscreen() {
    const close = this.closeInRoot()
    const key = JSON.stringify([this.isFullscreen, close])
    if (key === this.announced) return
    this.announced = key
    this.emit({ id: "", type: "fullscreen", value: this.isFullscreen, close })
  }

  private fullscreenChanged() {
    const on = document.fullscreenElement === this.element
    if (on === this.isFullscreen) return
    this.isFullscreen = on
    // Leaving full screen releases the keyboard and the pointer.
    if (!on) this.input.release()
    this.updateExpand()
    // Surfaces with `fill` grow or shrink; resizes reach their draws through their ResizeObservers.
    if (this.view) reconcile(this.ctx, this.viewEl, [this.view])
    if (on) {
      // Back closes full screen: an entry to go back from (widgets-fullscreen.md, "Back always closes full screen").
      history.pushState({ ...(history.state ?? {}), [HISTORY_KEY]: this.wid }, "")
      this.rootSize.observe(this.viewEl)
      addEventListener("popstate", this.onPopState)
    } else {
      this.rootSize.disconnect()
      // Closed some other way (Esc, the button): take our history entry back off.
      if (history.state?.[HISTORY_KEY] === this.wid) {
        this.leavingHistory = true
        history.back()
      } else removeEventListener("popstate", this.onPopState)
    }
    this.announceFullscreen()
  }

  private announced = ""
  private leavingHistory = false
  /** The root's size while full screen: a new size moves the close button's area in root coordinates. */
  private rootSize = new ResizeObserver(() => this.announceFullscreen())

  private onPopState = () => {
    if (this.leavingHistory) {
      this.leavingHistory = false
      removeEventListener("popstate", this.onPopState)
      return
    }
    removeEventListener("popstate", this.onPopState)
    // The browser's back: close full screen, whatever holds the keyboard or the pointer.
    this.input.release()
    void this.closeFullscreen()
  }

  destroy() {
    if (this.destroyed) return
    if (this.isFullscreen) void document.exitFullscreen().catch(() => {})
    this.stopWorker()
    this.destroyed = true
    this.host.ticker.delete(this.liveTick)
    this.input.destroy()
    this.rootSize.disconnect()
    removeEventListener("popstate", this.onPopState)
    this.element.ownerDocument.removeEventListener("fullscreenchange", this.onFullscreen)
    for (const el of this.viewEl.children) destroyTree(el)
    this.host.forget(this)
    this.element.remove()
  }
}

/** The kinds of a fetch rejection (widgets-live.md, `fetch`). */
const FETCH_KINDS = ["CapabilityDenied", "RateLimited", "Network", "Timeout", "TooLarge"]

/**
 * Whether an error is the widget template's (widgets.md, Failures): the language's own failures (parse, exception, the step
 * timeout, output size, the live slice), an invalid view or draw output, and WGSL that fails validation. The host's
 * (a crash, a missing program, the draw cut-off at 100 ms, which is this host's and device-dependent) are not.
 */
function programError(e: ErrorInfo, phase: string): boolean {
  if (e.type === "timeout" && phase === "draw") return false
  return ["syntax", "runtime", "timeout", "outputTooLarge", "sliceBudget", "view", "draw"].includes(e.type)
}

/**
 * The live input's `gpu` (widgets-gpu.md): this host replays batches where the browser has WebGPU, in its preferred
 * canvas format.
 */
function gpuInput(): { available: boolean; format: string } {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
  return gpu ? { available: true, format: gpu.getPreferredCanvasFormat() } : { available: false, format: "rgba8unorm" }
}

/** Marks the history entry a full-screen widget pushed. */
const HISTORY_KEY = "psychoscriptWidgetFullscreen"

function describe(e: ErrorInfo): string {
  const where = e.line ? ` (line ${e.line}${e.column ? `, column ${e.column}` : ""})` : ""
  return `${e.message}${where}`
}

function summary(value: unknown): string {
  if (typeof value === "string") return value.length > 80 ? value.slice(0, 79) + "…" : value
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return text.length > 80 ? text.slice(0, 79) + "…" : text
}

