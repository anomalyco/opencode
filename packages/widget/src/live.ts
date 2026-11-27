import { Result, Schema } from "effect"
import { Host, Runtime } from "psychoscript"
import { type Command, type Frame, Node, type WidgetEvent } from "./node.js"
import { checkDraw } from "./draw.js"
import { prune, StepError } from "./session.js"
import {
  denied,
  encode,
  FETCH_LIMITS,
  type FetchError,
  type FetchErrorKind,
  type FetchRequest,
  type FetchResponse,
  platformTransport,
  type Transport,
} from "./fetch.js"
import type { Capabilities } from "./widget-template.js"
import { type Tree, tree, unmark, ViewError } from "./tree.js"
import { compiled } from "./compiled.js"
import { located, MAX_VALUE_DEPTH, NEWER, OLDER, protocol, PROTOCOL, TYPED_ARRAYS } from "./host.js"
import { canvasSize, type GpuBatch, type GpuError, gpuChecks, STRIKE_MS } from "./gpu.js"

/** `widget.storage` limits a host checks on a post (widgets-live.md, Storage): a key's characters, a value's UTF-8 bytes. */
const STORAGE_KEY = 256
const STORAGE_VALUE = 64 * 1024

/** A display frame in live mode: like a canvas frame, without the canvas id. */
export type LiveFrame = Omit<Frame, "id">

/** What a live program posts to its client. */
export type LiveMessage =
  | { readonly type: "render"; readonly node: Node }
  | { readonly type: "draw"; readonly id: string; readonly commands: ReadonlyArray<Command> }
  /** A frame request; it may carry the GPU batch recorded since the last one (widgets-gpu.md). */
  | { readonly type: "frame"; readonly gpu?: GpuBatch }
  /** A GPU batch on its own, posted before the program waits on something else than a frame. */
  | ({ readonly type: "gpu" } & GpuBatch)
  | { readonly type: "submit"; readonly value: unknown }
  | { readonly type: "dismiss" }
  | { readonly type: "send"; readonly value: unknown; readonly wake: boolean }
  /** Ask for pointer capture (granted on the next click inside the widget) or give it back (widgets-input.md). */
  | { readonly type: "capture"; readonly value: boolean }
  /** A write to the widget template's storage (widgets-live.md, Storage): `value` is JSON text; without it, a delete. */
  | { readonly type: "storage"; readonly key: string; readonly value?: string }

/** What a client sends a live program. */
export type LiveInput =
  | { readonly type: "event"; readonly event: WidgetEvent }
  | { readonly type: "frame"; readonly frame: LiveFrame }
  | { readonly type: "resumed"; readonly pausedMs: number }
  /** A GPU canvas's size in physical pixels, before the frame after it changed (widgets-gpu.md). */
  | { readonly type: "canvas"; readonly key: string; readonly width: number; readonly height: number }
  /** The GPU device is lost: every handle is gone. */
  | { readonly type: "gpu"; readonly lost: string }
  /** A change to the widget template's storage from elsewhere: `value` is JSON text; without it, the key was deleted. */
  | { readonly type: "storage"; readonly key: string; readonly value?: string }

/** How a live program ended. `return`: `main` returned without an answer; its last view stays. */
export type LiveEnd =
  | { readonly type: "submit"; readonly value: unknown }
  | { readonly type: "dismiss" }
  | { readonly type: "return" }
  | { readonly type: "stop" }
  | { readonly type: "error"; readonly error: StepError }

/** Time for a live host: `now` in ms and one-shot timers. `realClock` by default; `ManualClock` in tests. */
export interface Clock {
  readonly now: () => number
  readonly schedule: (ms: number, run: () => void) => () => void
}

export const realClock: Clock = {
  now: () => performance.now(),
  schedule: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
}

/** A clock that moves only on `advance`, firing due timers in order and letting the program react to each. */
export class ManualClock implements Clock {
  private time = 0
  private sequence = 0
  private readonly timers: Array<{ at: number; order: number; run: () => void }> = []

  readonly now = () => this.time

  readonly schedule = (ms: number, run: () => void) => {
    const timer = { at: this.time + Math.max(0, ms), order: this.sequence++, run }
    this.timers.push(timer)
    return () => {
      const index = this.timers.indexOf(timer)
      if (index !== -1) this.timers.splice(index, 1)
    }
  }

  async advance(ms: number) {
    const target = this.time + ms
    await turns()
    while (true) {
      const due = this.timers
        .filter((timer) => timer.at <= target)
        .reduce<
          (typeof this.timers)[number] | undefined
        >((first, timer) => (!first || timer.at < first.at || (timer.at === first.at && timer.order < first.order) ? timer : first), undefined)
      if (!due) break
      this.timers.splice(this.timers.indexOf(due), 1)
      this.time = due.at
      due.run()
      await turns()
    }
    this.time = target
    await turns()
  }
}

export interface LiveOptions {
  readonly clock?: Clock
  /** Stop the program when it runs this long without waiting on the host; default 50 ms (the spec's budget). */
  readonly busyMs?: number
  /**
   * The rate of `render` and `draw` posts, beyond which they wait and coalesce (specs/v2/widgets-live.md, Post rate);
   * default 240 a second.
   */
  readonly postsPerSecond?: number
  /** Every valid message the program posts, in order. */
  readonly onMessage?: (message: LiveMessage) => void
  /** The widget template's capabilities; without `https`, `fetch` rejects with `CapabilityDenied`. */
  readonly capabilities?: Capabilities
  /** Performs `fetch` requests that passed the contract's checks; the platform `fetch` by default. */
  readonly transport?: Transport
  /**
   * The GPU the program sees (widgets-gpu.md): by default one with `rgba8unorm` canvases, whose batches this host checks
   * without replaying them (it draws no canvas); `false`: none, so the program records nothing.
   */
  readonly gpu?: false | { readonly format?: "bgra8unorm" | "rgba8unorm" }
  /**
   * The widget template's storage as the client holds it (widgets-live.md, Storage): its entries, JSON text by key, when
   * the client follows its space; `null` when the widget template doesn't declare `storage`. Left out, the program runs
   * as on a client without storage.
   */
  readonly storage?: { readonly entries: ReadonlyArray<{ readonly key: string; readonly value: string }> } | null
}

/**
 * A running live widget (specs/v2/widgets-live.md) on the TypeScript interpreter: the reference host for client authors
 * and the test harness for live widget templates. It is a native host (specs/v2/widgets.md, Native hosts): it builds
 * each rendered view's tree and maps `draw` keys to canvas ids itself. Feed it client input with `event` and `frame`, `pause` and `resume` it as
 * the widget leaves and comes back into view, and read the last `view` and canvas `drawings`.
 */
export interface LiveWidget {
  readonly view: Node | undefined
  readonly drawings: ReadonlyMap<string, ReadonlyArray<Command>>
  /** The program asked for a frame and hasn't got it yet. */
  readonly frameRequested: boolean
  readonly paused: boolean
  readonly warnings: ReadonlyArray<string>
  /**
   * What stopped GPU canvases, each with the canvases it stopped: the GPU batches' program errors (phase `gpu`), and a
   * GPU hang's client error.
   */
  readonly gpuErrors: ReadonlyArray<GpuError>
  readonly ended: LiveEnd | undefined
  readonly done: Promise<LiveEnd>
  readonly event: (event: WidgetEvent) => void
  /** Delivers a frame if the program asked for one and isn't paused; returns whether it did. */
  readonly frame: (frame: LiveFrame) => boolean
  /** Tells the program a GPU canvas's size, in physical pixels, clamped to the texture limit (`canvasSize`). */
  readonly canvas: (key: string, width: number, height: number) => void
  /**
   * Loses the GPU device: every handle is gone, and the program's `device.lost` resolves. `inFlight`: the run had GPU
   * work submitted and not seen finished. `finished` (default true): some of the run's GPU work finished on a device
   * since the previous loss; this host has no GPU, so its caller says. A loss with work in flight is a strike if work
   * finished since the previous strike (or the run's start); a second strike within 30 s stops every GPU canvas.
   */
  readonly loseDevice: (reason: string, options?: { readonly inFlight?: boolean; readonly finished?: boolean }) => void
  /**
   * Holds everything for the program: events, timer firings and fetch results wait, and `now()` stops, until `resume`,
   * which first delivers `{ type: "resumed", pausedMs }`.
   */
  readonly pause: () => void
  readonly resume: () => void
  /** Resolves once `predicate` holds, checked now and after every post; rejects if the program ends first. */
  readonly when: (predicate: (widget: LiveWidget) => boolean) => Promise<void>
  readonly stop: () => Promise<LiveEnd>
  /** Delivers a change to the widget template's storage from elsewhere; no `value` deletes the key. */
  readonly storage: (key: string, value?: string) => void
}

export const LiveWidget = {
  /**
   * Starts `<program>\nreturn await __widget_live(__input(), true)` with `__input()` = `{ data, gpu }`. A program built for an
   * older contract ends at once with an error; one for a newer contract throws (a client error).
   */
  start: (program: string, data: unknown, options?: LiveOptions): LiveWidget => {
    const clock = options?.clock ?? realClock
    const busyMs = options?.busyMs ?? 50
    const postsPerSecond = options?.postsPerSecond ?? 240
    const started = clock.now()
    const capabilities = options?.capabilities
    const transport = options?.transport ?? platformTransport
    const controller = new AbortController()
    const inbox: LiveInput[] = []
    const waiting: Array<(input: LiveInput) => void> = []
    const watchers: Array<{
      predicate: (widget: LiveWidget) => boolean
      resolve: () => void
      reject: (error: Error) => void
    }> = []
    const drawings = new Map<string, ReadonlyArray<Command>>()
    const warnings: string[] = []
    const gpuErrors: GpuError[] = []
    const gpu = gpuChecks(
      () => new Set([...(current.tree?.canvases ?? new Map())].flatMap(([key, canvas]) => (canvas.gpu ? [key] : []))),
    )
    // A GPU batch, checked.
    const replay = (batch: GpuBatch) => {
      const error = gpu.batch(batch)
      if (error) gpuErrors.push(error)
    }
    const ending = Promise.withResolvers<LiveEnd>()
    const current = {
      view: undefined as Node | undefined,
      requested: false,
      pausedAt: undefined as number | undefined,
      pausedMs: 0,
      ended: undefined as LiveEnd | undefined,
      pending: 0,
      busy: undefined as ReturnType<typeof setTimeout> | undefined,
      // The post rate's token bucket, and the `render` and `draw` posts waiting for a token, oldest first; a canvas's
      // draws coalesce by its key.
      bucket: { tokens: BURST, at: started },
      waiting: [] as Array<{
        readonly key: string | undefined
        readonly message: LiveMessage
        readonly counted: boolean
      }>,
      slot: undefined as (() => void) | undefined,
      fetches: { inFlight: 0, starts: [] as number[] },
      // The last rendered view's tree, for `draw` keys.
      tree: undefined as Tree | undefined,
      // When the run last got a strike (a device loss with GPU work in flight), and whether its GPU work has finished
      // on a device since then (or since the run started): losses with none in between are one reset.
      strike: undefined as number | undefined,
      finished: false,
    }
    // Inputs and fetch results that arrive while paused, released in order on resume.
    const held: Array<() => void> = []
    const timers = new Set<{ due: number; fire: () => void; cancel: () => void }>()
    // Running time: the clock minus the time spent paused; it stands still while paused.
    const now = () => (current.pausedAt ?? clock.now()) - started - current.pausedMs
    const later = (run: () => void) => (current.pausedAt === undefined ? run() : void held.push(run))

    const end = (result: LiveEnd) => {
      if (current.ended) return
      // The last view is never lost: whatever waits for the post rate goes out first, unless the client stopped it.
      if (result.type !== "stop") release()
      current.slot?.()
      current.ended = result
      clearTimeout(current.busy)
      controller.abort()
      ending.resolve(result)
      watchers
        .splice(0)
        .forEach((watcher) =>
          watcher.predicate(widget)
            ? watcher.resolve()
            : watcher.reject(new Error(`The live widget ended: ${result.type}`)),
        )
    }
    const fail = (kind: StepError["kind"], message: string, phase?: "view") =>
      end({ type: "error", error: new StepError({ kind, message, ...(phase ? { phase } : {}) }) })

    // The program can only be idle while it waits on a host call, so a stretch with none in flight is busy work. (One
    // in flight doesn't prove it is idle, so this misses busy loops that leave a timer or receive running.)
    const track = <A>(work: Promise<A>) => {
      current.pending++
      clearTimeout(current.busy)
      return work.finally(() => {
        current.pending--
        if (current.pending === 0 && !current.ended) arm()
      })
    }
    const arm = () => {
      clearTimeout(current.busy)
      current.busy = setTimeout(() => {
        if (current.pending === 0) fail("timeout", `The program ran more than ${busyMs} ms without awaiting`)
      }, busyMs)
    }

    const deliver = (input: LiveInput) =>
      later(() => {
        if (current.ended) return
        const next = waiting.shift()
        if (next) next(input)
        else inbox.push(input)
      })

    const receive = (signal: AbortSignal) =>
      track(
        new Promise<LiveInput>((resolve) => {
          const queued = inbox.shift()
          if (queued) return resolve(queued)
          waiting.push(resolve)
          signal.addEventListener(
            "abort",
            () => {
              const index = waiting.indexOf(resolve)
              if (index !== -1) waiting.splice(index, 1)
            },
            { once: true },
          )
        }),
      )

    const sleep = (ms: unknown, signal: AbortSignal) =>
      track(
        new Promise<void>((resolve) => {
          const timer = {
            due: now() + Math.max(0, Number(ms) || 0),
            fire: () => {
              timers.delete(timer)
              resolve()
            },
            cancel: () => {},
          }
          timers.add(timer)
          if (current.pausedAt === undefined) timer.cancel = clock.schedule(timer.due - now(), timer.fire)
          signal.addEventListener(
            "abort",
            () => {
              timer.cancel()
              timers.delete(timer)
            },
            { once: true },
          )
        }),
      )

    const fetch = (input: unknown, signal: AbortSignal) =>
      track(
        request(input, signal).then(
          (response) => new Promise<FetchResponse>((resolve) => later(() => resolve(response))),
          (error: FetchError) => new Promise<never>((_, reject) => later(() => reject(error))),
        ),
      )

    // Runs one `fetch` under the contract's rules (widgets-live.md, Capabilities) and rejects with a `FetchError`.
    const request = async (input: unknown, signal: AbortSignal): Promise<FetchResponse> => {
      const first = fetchRequest(input)
      const at = clock.now()
      current.fetches.starts = current.fetches.starts.filter((start) => at - start < 1000)
      if (current.fetches.inFlight >= FETCH_LIMITS.inFlight || current.fetches.starts.length >= FETCH_LIMITS.perSecond)
        throw failure(
          "RateLimited",
          `At most ${FETCH_LIMITS.inFlight} fetches in flight and ${FETCH_LIMITS.perSecond} per second`,
        )
      if (!FETCH_LIMITS.methods.some((method) => method === first.method))
        throw failure("CapabilityDenied", `Method ${first.method} is not allowed`)
      if (first.body !== undefined && Buffer.byteLength(first.body) > FETCH_LIMITS.requestBytes)
        throw failure("TooLarge", `The request body is over ${FETCH_LIMITS.requestBytes / 1024} KB`)
      current.fetches.starts.push(at)
      current.fetches.inFlight++
      const abort = new AbortController()
      signal.addEventListener("abort", () => abort.abort(), { once: true })
      const timeout = Promise.withResolvers<never>()
      const cancel = clock.schedule(FETCH_LIMITS.timeoutMs, () => {
        abort.abort()
        timeout.reject(failure("Timeout", `No response within ${FETCH_LIMITS.timeoutMs / 1000} s`))
      })
      try {
        return await Promise.race([follow(first, abort.signal), timeout.promise])
      } finally {
        cancel()
        current.fetches.inFlight--
      }
    }

    // Follows up to `FETCH_LIMITS.redirects` redirects, checking every URL against the capability.
    const follow = async (first: FetchRequest, signal: AbortSignal): Promise<FetchResponse> => {
      const hop = { request: first, count: 0 }
      while (true) {
        const url = URL.parse(hop.request.url)
        if (!url) throw failure("Network", `Invalid URL: ${hop.request.url}`)
        const problem = denied(url, capabilities)
        if (problem) throw failure("CapabilityDenied", problem)
        const response = await transport(hop.request, signal).catch((error: unknown) => {
          throw failure("Network", error instanceof Error ? error.message : String(error))
        })
        const location = response.headers.location
        if ([301, 302, 303, 307, 308].includes(response.status) && location) {
          if (hop.count === FETCH_LIMITS.redirects)
            throw failure("Network", `More than ${FETCH_LIMITS.redirects} redirects`)
          // 303, and 301/302 after a POST, continue as a GET without a body, as browsers do.
          const get =
            response.status === 303 ||
            (response.status !== 307 && response.status !== 308 && hop.request.method === "POST")
          hop.request = {
            url: new URL(location, url).href,
            method: get ? "GET" : hop.request.method,
            headers: hop.request.headers,
            ...(get || hop.request.body === undefined ? {} : { body: hop.request.body }),
          }
          hop.count++
          continue
        }
        if (response.body.byteLength > FETCH_LIMITS.responseBytes)
          throw failure("TooLarge", `The response body is over ${FETCH_LIMITS.responseBytes / 1024 / 1024} MB`)
        return { status: response.status, headers: response.headers, ...encode(response.headers, response.body) }
      }
    }

    // A post as the program made it, as it was when the prelude built trees itself: a render's tree built, a draw's key
    // turned into its canvas's id, no functions. For a render, also whether its view has handlers, which `post`
    // returns, or why the view breaks the rules of views (`failure`; the prelude posts one too deep to cross that way).
    // Throws what the program would have got: an unknown canvas key, a function where none may go.
    const native = (
      message: unknown,
    ): { message: unknown; handlers?: boolean; failure?: string; invalid?: string; key?: string } => {
      if (isRecord(message) && message.type === "render") {
        const { node, failure, ...rest } = message
        if (typeof failure === "string") return { message, failure }
        try {
          const built = tree(node, POSTED)
          current.tree = built
          return {
            message: { ...(unmark(rest, POSTED) as object), node: built.view },
            handlers: built.handlers.size > 0,
          }
        } catch (error) {
          if (!(error instanceof ViewError)) throw error
          return { message, failure: error.message }
        }
      }
      if (!isRecord(message) || message.type !== "draw") return { message: unmark(message, POSTED) }
      const key = message.key
      if (typeof key !== "string") return { message, invalid: DRAW_KEY }
      const canvas = current.tree?.canvases.get(key)
      if (canvas === undefined) throw new Error('No canvas with key "' + key + '" in the rendered view')
      if (canvas.wgsl) throw new Error('Canvas "' + key + '" is drawn by its wgsl; it takes no draw commands')
      if (canvas.gpu) throw new Error('Canvas "' + key + '" is drawn by the GPU; it takes no draw commands')
      return { message: unmark({ type: "draw", id: canvas.id, commands: message.commands }, POSTED), key }
    }

    const post = (args: ReadonlyArray<unknown>) => {
      const { message, handlers, failure, invalid, key } = native(args[0])
      checked("post", args, 1)
      if (current.ended) return
      if (failure !== undefined) return void fail("invalid", failure, "view")
      if (invalid !== undefined) return void fail("invalid", invalid)
      deliverPost(message, key)
      return handlers
    }

    // Checks a post, then applies it: `render` and `draw` posts under the post rate, the rest at once. A frame request
    // while one is pending changes nothing; `submit` and `dismiss` first apply what waits for the rate.
    const deliverPost = (message: unknown, key?: string) => {
      const accepted = accept(message)
      if (!accepted) return
      if (accepted.type === "render" || accepted.type === "draw") return counted(accepted, key)
      // A GPU batch takes no token, but never overtakes a waiting render or draw: its canvas may be in one.
      if ((accepted.type === "gpu" || (accepted.type === "frame" && accepted.gpu)) && current.waiting.length > 0)
        return void current.waiting.push({ key: undefined, message: accepted, counted: false })
      if (accepted.type === "submit" || accepted.type === "dismiss") release()
      send(accepted)
    }

    // A frame request while one is pending changes nothing, but its GPU batch is applied.
    const send = (accepted: LiveMessage) => {
      if (accepted.type !== "frame" || !current.requested) return apply(accepted)
      if (accepted.gpu) apply({ type: "gpu", ops: accepted.gpu.ops, bytes: accepted.gpu.bytes })
    }

    // The post rate (specs/v2/widgets-live.md): a token bucket of `BURST` tokens, refilled at `postsPerSecond`. A
    // `render` or `draw` post takes a token and goes out at once when nothing waits; otherwise it waits, in place of a
    // waiting post of its kind (the render, or the draw for its canvas key), and waiting posts go out in order, one per
    // token, as tokens come; a GPU batch waiting among them takes none.
    const refill = () => {
      const at = clock.now()
      current.bucket.tokens = Math.min(
        BURST,
        current.bucket.tokens + ((at - current.bucket.at) * postsPerSecond) / 1000,
      )
      current.bucket.at = at
    }
    const counted = (message: LiveMessage, key: string | undefined) => {
      refill()
      if (current.waiting.length === 0 && current.bucket.tokens >= 1 - EPSILON) {
        current.bucket.tokens -= 1
        return apply(message)
      }
      const index = current.waiting.findIndex((entry) =>
        message.type === "render"
          ? entry.message.type === "render"
          : entry.message.type === "draw" && entry.key === key,
      )
      if (index === -1) current.waiting.push({ key, message, counted: true })
      else current.waiting[index] = { key, message, counted: true }
      schedule()
    }
    const schedule = () => {
      if (current.slot || current.waiting.length === 0 || current.ended) return
      refill()
      const wait = Math.max(0, ((1 - current.bucket.tokens) * 1000) / postsPerSecond)
      current.slot = clock.schedule(wait, () => {
        current.slot = undefined
        refill()
        while (current.waiting.length > 0 && !current.ended) {
          const next = current.waiting[0]!
          if (next.counted && current.bucket.tokens < 1 - EPSILON) break
          if (next.counted) current.bucket.tokens -= 1
          current.waiting.shift()
          send(next.message)
        }
        schedule()
      })
    }
    // Applies every waiting post at once, in order.
    const release = () => {
      current.slot?.()
      current.slot = undefined
      current.waiting.splice(0).forEach((entry) => send(entry.message))
    }

    const apply = (accepted: LiveMessage) => {
      if (accepted.type === "render") current.view = accepted.node
      if (accepted.type === "draw") drawings.set(accepted.id, accepted.commands)
      if (accepted.type === "frame") {
        current.requested = true
        if (accepted.gpu) replay(accepted.gpu)
        gpu.frame()
      }
      if (accepted.type === "gpu") replay(accepted)
      options?.onMessage?.(accepted)
      if (accepted.type === "submit") return end({ type: "submit", value: accepted.value })
      if (accepted.type === "dismiss") return end({ type: "dismiss" })
      const ready = watchers.filter((watcher) => watcher.predicate(widget))
      ready.forEach((watcher) => {
        watchers.splice(watchers.indexOf(watcher), 1)
        watcher.resolve()
      })
    }

    // Checks one post and returns it as the client gets it; undefined when it is invalid (the run ends) or ignored.
    // A draw comes here with the id its key maps to.
    const accept = (message: unknown): LiveMessage | undefined => {
      if (!isRecord(message) || typeof message.type !== "string") return warn(`Ignored a post without a type`)
      if (message.type === "render") {
        const found: string[] = []
        const decoded = decodeNode(prune(message.node, found))
        if (Result.isFailure(decoded)) return void fail("invalid", decoded.failure.message)
        found.forEach((warning) => warn(warning))
        return { type: "render", node: decoded.success }
      }
      if (message.type === "draw") {
        const checked = checkDraw(message.commands)
        if ("error" in checked) return void fail("invalid", checked.error)
        return { type: "draw", id: message.id as string, commands: checked.commands }
      }
      if (message.type === "frame")
        return isRecord(message.gpu) ? { type: "frame", gpu: message.gpu as unknown as GpuBatch } : { type: "frame" }
      if (message.type === "gpu")
        return { type: "gpu", ops: message.ops as GpuBatch["ops"], bytes: message.bytes as ArrayBuffer }
      if (message.type === "submit") return { type: "submit", value: message.value ?? null }
      if (message.type === "dismiss") return { type: "dismiss" }
      if (message.type === "send") return { type: "send", value: message.value ?? null, wake: message.wake !== false }
      if (message.type === "storage") {
        // The prelude checks these; a program that posts around it fails like an invalid post.
        if (typeof message.key !== "string" || message.key.length === 0 || message.key.length > STORAGE_KEY)
          return void fail("invalid", `A storage post needs a key of 1 to ${STORAGE_KEY} characters`)
        if (message.value === undefined) return { type: "storage", key: message.key }
        if (typeof message.value !== "string" || new TextEncoder().encode(message.value).length > STORAGE_VALUE)
          return void fail("invalid", `A storage post's value must be JSON text of at most ${STORAGE_VALUE >> 10} KiB`)
        return { type: "storage", key: message.key, value: message.value }
      }
      if (message.type === "capture") {
        if (typeof message.value !== "boolean") return warn(`Ignored a capture post without a boolean value`)
        return { type: "capture", value: message.value }
      }
      return warn(`Ignored a post of unknown type "${message.type}"`)
    }

    const warn = (message: string) => {
      warnings.push(message)
      return undefined
    }

    const widget: LiveWidget = {
      get view() {
        return current.view
      },
      drawings,
      get frameRequested() {
        return current.requested
      },
      get paused() {
        return current.pausedAt !== undefined
      },
      warnings,
      gpuErrors,
      get ended() {
        return current.ended
      },
      done: ending.promise,
      event: (event) => deliver({ type: "event", event }),
      frame: (frame) => {
        if (!current.requested || current.pausedAt !== undefined || current.ended) return false
        current.requested = false
        deliver({ type: "frame", frame })
        return true
      },
      canvas: (key, ...size) => {
        const [width, height] = canvasSize(...size)
        deliver({ type: "canvas", key, width, height })
      },
      loseDevice: (reason, options) => {
        if (options?.finished !== false) current.finished = true
        if (options?.inFlight && current.finished) {
          const at = clock.now()
          const hang = current.strike !== undefined && at - current.strike <= STRIKE_MS ? gpu.hung() : undefined
          if (hang) gpuErrors.push(hang)
          current.strike = at
          current.finished = false
        }
        gpu.lost()
        deliver({ type: "gpu", lost: reason })
      },
      pause: () => {
        if (current.pausedAt !== undefined || current.ended) return
        current.pausedAt = clock.now()
        timers.forEach((timer) => timer.cancel())
      },
      resume: () => {
        if (current.pausedAt === undefined) return
        const pausedMs = clock.now() - current.pausedAt
        current.pausedMs += pausedMs
        current.pausedAt = undefined
        deliver({ type: "resumed", pausedMs })
        held.splice(0).forEach((run) => run())
        timers.forEach((timer) => (timer.cancel = clock.schedule(timer.due - now(), timer.fire)))
      },
      when: (predicate) => {
        if (predicate(widget)) return Promise.resolve()
        if (current.ended) return Promise.reject(new Error(`The live widget ended: ${current.ended.type}`))
        return new Promise((resolve, reject) => watchers.push({ predicate, resolve, reject }))
      },
      stop: () => {
        end({ type: "stop" })
        return ending.promise
      },
      storage: (key, value) =>
        deliver(value === undefined ? { type: "storage", key } : { type: "storage", key, value }),
    }

    const version = protocol(program)
    if (version > PROTOCOL) throw new Error(NEWER)
    if (version < PROTOCOL) {
      fail("invalid", OLDER)
      return widget
    }
    arm()
    Runtime.make({
      limits: { maxValueDepth: MAX_VALUE_DEPTH },
      typedArrays: TYPED_ARRAYS,
      globals: () => ({
        __input: Host.fn(() => ({
          data,
          ...(options?.gpu === false ? {} : { gpu: { available: true, format: options?.gpu?.format ?? "rgba8unorm" } }),
          ...(options?.storage === undefined ? {} : { storage: options.storage }),
        })),
        __host: {
          post: located((args) => post(args)),
          receive: located((args, call) => (checked("receive", args), receive(call.signal)), {
            type: "async",
            idempotent: true,
          }),
          sleep: located((args, call) => sleep(checked("sleep", args)[0], call.signal), {
            type: "async",
            idempotent: true,
          }),
          now: located((args) => (checked("now", args), now())),
          fetch: located((args, call) => fetch(checked("fetch", args)[0], call.signal), { type: "async" }),
        },
      }),
      translate: { functions: "mark" },
    })
      .execute(compiled(program + "\nreturn await __widget_live(__input(), true)"), { signal: controller.signal })
      .then(
        (result) => {
          if (result.ok) return end({ type: "return" })
          fail(result.error.kind === "TimeoutExceeded" ? "timeout" : "error", result.error.message)
        },
        (error: unknown) => {
          // Aborting is how `end` stops the run.
          if (!current.ended) fail("error", error instanceof Error ? error.message : String(error))
        },
      )
    return widget
  },
}

// The post rate's burst (specs/v2/widgets-live.md, Post rate), the tolerance for its floating-point tokens, and the
// failure of a draw post without a canvas key.
const BURST = 8
const EPSILON = 1e-9
const DRAW_KEY = "A draw post needs a string key"

// Host calls' arguments cross with markers, for a render's handlers; anywhere else a function fails the call, as
// it does without `"mark"`. `checked` gives the arguments from `from` on, throwing for a function.
const POSTED = "Argument 1 to __host.post"
const checked = (name: string, args: ReadonlyArray<unknown>, from = 0) =>
  args.map((arg, index) => (index < from ? arg : unmark(arg, `Argument ${index + 1} to __host.${name}`)))

const decodeNode = Schema.decodeUnknownResult(Node)

// Lets a program react to what just happened: it continues in microtasks and 1 ms slices between event-loop turns.
async function turns() {
  for (let index = 0; index < 20; index++) await new Promise((resolve) => setImmediate(resolve))
}

function fetchRequest(input: unknown): FetchRequest {
  if (!isRecord(input) || typeof input.url !== "string") throw failure("Network", "fetch needs a request with a url")
  const headers = isRecord(input.headers)
    ? Object.fromEntries(Object.entries(input.headers).map(([name, value]) => [name, String(value)]))
    : {}
  return {
    url: input.url,
    method: typeof input.method === "string" ? input.method.toUpperCase() : "GET",
    headers,
    ...(input.body === undefined || input.body === null ? {} : { body: String(input.body) }),
  }
}

function failure(kind: FetchErrorKind, message: string): FetchError {
  return { kind, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
