import { Result, Schema } from "effect"
import { Host, Runtime } from "psychoscript"
import { type Command, DrawOutput, type Frame, Node, type WidgetEvent } from "./node.js"
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
import type { Capabilities } from "./template.js"

/** A display frame in live mode: like a canvas frame, without the canvas id. */
export type LiveFrame = Omit<Frame, "id">

/** What a live program posts to its client. */
export type LiveMessage =
  | { readonly type: "render"; readonly node: Node }
  | { readonly type: "draw"; readonly id: string; readonly commands: ReadonlyArray<Command> }
  | { readonly type: "frame" }
  | { readonly type: "submit"; readonly value: unknown }
  | { readonly type: "dismiss" }
  | { readonly type: "send"; readonly value: unknown; readonly wake: boolean }
  /** Ask for pointer capture (granted on the next click inside the widget) or give it back (widgets-input.md). */
  | { readonly type: "capture"; readonly value: boolean }

/** What a client sends a live program. */
export type LiveInput =
  | { readonly type: "event"; readonly event: WidgetEvent }
  | { readonly type: "frame"; readonly frame: LiveFrame }
  | { readonly type: "resumed"; readonly pausedMs: number }

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
  /** Posts per second beyond which `render`, `draw` and `frame` posts are dropped with a warning; default 240. */
  readonly postsPerSecond?: number
  /** Every valid message the program posts, in order. */
  readonly onMessage?: (message: LiveMessage) => void
  /** The template's capabilities; without `https`, `fetch` rejects with `CapabilityDenied`. */
  readonly capabilities?: Capabilities
  /** Performs `fetch` requests that passed the contract's checks; the platform `fetch` by default. */
  readonly transport?: Transport
}

/**
 * A running live widget (specs/v2/widgets-live.md) on the TypeScript interpreter: the reference host for client authors
 * and the test harness for live templates. Feed it client input with `event` and `frame`, `pause` and `resume` it as
 * the widget leaves and comes back into view, and read the last `view` and canvas `drawings`.
 */
export interface LiveWidget {
  readonly view: Node | undefined
  readonly drawings: ReadonlyMap<string, ReadonlyArray<Command>>
  /** The program asked for a frame and hasn't got it yet. */
  readonly frameRequested: boolean
  readonly paused: boolean
  readonly warnings: ReadonlyArray<string>
  readonly ended: LiveEnd | undefined
  readonly done: Promise<LiveEnd>
  readonly event: (event: WidgetEvent) => void
  /** Delivers a frame if the program asked for one and isn't paused; returns whether it did. */
  readonly frame: (frame: LiveFrame) => boolean
  /**
   * Holds everything for the program: events, timer firings and fetch results wait, and `now()` stops, until `resume`,
   * which first delivers `{ type: "resumed", pausedMs }`.
   */
  readonly pause: () => void
  readonly resume: () => void
  /** Resolves once `predicate` holds, checked now and after every post; rejects if the program ends first. */
  readonly when: (predicate: (widget: LiveWidget) => boolean) => Promise<void>
  readonly stop: () => Promise<LiveEnd>
}

export const LiveWidget = {
  /** Starts `<program>\nreturn await __widget_live(__input())` with `__input()` = `{ data }`. */
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
    const ending = Promise.withResolvers<LiveEnd>()
    const current = {
      view: undefined as Node | undefined,
      requested: false,
      pausedAt: undefined as number | undefined,
      pausedMs: 0,
      ended: undefined as LiveEnd | undefined,
      pending: 0,
      busy: undefined as ReturnType<typeof setTimeout> | undefined,
      window: { start: started, posts: 0, warned: false },
      fetches: { inFlight: 0, starts: [] as number[] },
    }
    // Inputs and fetch results that arrive while paused, released in order on resume.
    const held: Array<() => void> = []
    const timers = new Set<{ due: number; fire: () => void; cancel: () => void }>()
    // Running time: the clock minus the time spent paused; it stands still while paused.
    const now = () => (current.pausedAt ?? clock.now()) - started - current.pausedMs
    const later = (run: () => void) => (current.pausedAt === undefined ? run() : void held.push(run))

    const end = (result: LiveEnd) => {
      if (current.ended) return
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
    const fail = (kind: StepError["kind"], message: string) =>
      end({ type: "error", error: new StepError({ kind, message }) })

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

    const post = (message: unknown) => {
      if (current.ended) return
      const accepted = accept(message)
      if (!accepted) return
      options?.onMessage?.(accepted)
      if (accepted.type === "submit") return end({ type: "submit", value: accepted.value })
      if (accepted.type === "dismiss") return end({ type: "dismiss" })
      const ready = watchers.filter((watcher) => watcher.predicate(widget))
      ready.forEach((watcher) => {
        watchers.splice(watchers.indexOf(watcher), 1)
        watcher.resolve()
      })
    }

    // Validates one post, applies it and returns it; drops it (undefined) over the rate or when it is invalid.
    const accept = (message: unknown): LiveMessage | undefined => {
      if (!isRecord(message) || typeof message.type !== "string") return warn(`Ignored a post without a type`)
      if ((message.type === "render" || message.type === "draw" || message.type === "frame") && !admit()) return
      if (message.type === "render") {
        const found: string[] = []
        const decoded = decodeNode(prune(message.node, found))
        if (Result.isFailure(decoded)) return void fail("invalid", decoded.failure.message)
        found.forEach((warning) => warn(warning))
        current.view = decoded.success
        return { type: "render", node: decoded.success }
      }
      if (message.type === "draw") {
        const decoded = decodeDraw({ commands: message.commands })
        if (typeof message.id !== "string") return void fail("invalid", "A draw needs a canvas id")
        if (Result.isFailure(decoded)) return void fail("invalid", decoded.failure.message)
        drawings.set(message.id, decoded.success.commands)
        return { type: "draw", id: message.id, commands: decoded.success.commands }
      }
      if (message.type === "frame") {
        current.requested = true
        return { type: "frame" }
      }
      if (message.type === "submit") return { type: "submit", value: message.value ?? null }
      if (message.type === "dismiss") return { type: "dismiss" }
      if (message.type === "send") return { type: "send", value: message.value ?? null, wake: message.wake !== false }
      if (message.type === "capture") {
        if (typeof message.value !== "boolean") return warn(`Ignored a capture post without a boolean value`)
        return { type: "capture", value: message.value }
      }
      return warn(`Ignored a post of unknown type "${message.type}"`)
    }

    const admit = () => {
      const now = clock.now()
      if (now - current.window.start >= 1000) current.window = { start: now, posts: 0, warned: false }
      current.window.posts++
      if (current.window.posts <= postsPerSecond) return true
      if (!current.window.warned) warn(`Dropped posts beyond ${postsPerSecond} per second`)
      current.window.warned = true
      return false
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
    }

    arm()
    Runtime.make({
      globals: () => ({
        __input: Host.fn(() => ({ data })),
        __host: {
          post: Host.fn(([message]) => post(message)),
          receive: Host.fn((_, call) => receive(call.signal), { type: "async", idempotent: true }),
          sleep: Host.fn(([ms], call) => sleep(ms, call.signal), { type: "async", idempotent: true }),
          now: Host.fn(() => now()),
          fetch: Host.fn(([request], call) => fetch(request, call.signal), { type: "async" }),
        },
      }),
    })
      .execute(program + "\nreturn await __widget_live(__input())", { signal: controller.signal })
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

const decodeNode = Schema.decodeUnknownResult(Node)
const decodeDraw = Schema.decodeUnknownResult(DrawOutput)

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
