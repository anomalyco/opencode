import { Result, Schema } from "effect"
import { Host, Runtime } from "psychoscript"
import { type Command, DrawOutput, type Frame, Node, type WidgetEvent } from "./node.js"
import { prune, StepError } from "./session.js"

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

/** What a client sends a live program. */
export type LiveInput =
  | { readonly type: "event"; readonly event: WidgetEvent }
  | { readonly type: "frame"; readonly frame: LiveFrame }
  | { readonly type: "visibility"; readonly visible: boolean }

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
}

/**
 * A running live widget (specs/v2/widgets-live.md) on the TypeScript interpreter: the reference host for client authors
 * and the test harness for live templates. Feed it client input with `event`, `frame` and `visibility`; read the last
 * `view` and canvas `drawings`.
 */
export interface LiveWidget {
  readonly view: Node | undefined
  readonly drawings: ReadonlyMap<string, ReadonlyArray<Command>>
  /** The program asked for a frame and hasn't got it yet. */
  readonly frameRequested: boolean
  readonly visible: boolean
  readonly warnings: ReadonlyArray<string>
  readonly ended: LiveEnd | undefined
  readonly done: Promise<LiveEnd>
  readonly event: (event: WidgetEvent) => void
  /** Delivers a frame if the program asked for one and the widget is visible; returns whether it did. */
  readonly frame: (frame: LiveFrame) => boolean
  readonly visibility: (visible: boolean) => void
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
      visible: true,
      ended: undefined as LiveEnd | undefined,
      pending: 0,
      busy: undefined as ReturnType<typeof setTimeout> | undefined,
      window: { start: started, posts: 0, warned: false },
    }

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

    const deliver = (input: LiveInput) => {
      if (current.ended) return
      const next = waiting.shift()
      if (next) next(input)
      else inbox.push(input)
    }

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
          const cancel = clock.schedule(Math.max(0, Number(ms) || 0), resolve)
          signal.addEventListener("abort", cancel, { once: true })
        }),
      )

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
      get visible() {
        return current.visible
      },
      warnings,
      get ended() {
        return current.ended
      },
      done: ending.promise,
      event: (event) => deliver({ type: "event", event }),
      frame: (frame) => {
        if (!current.requested || !current.visible || current.ended) return false
        current.requested = false
        deliver({ type: "frame", frame })
        return true
      },
      visibility: (visible) => {
        current.visible = visible
        deliver({ type: "visibility", visible })
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
          now: Host.fn(() => clock.now() - started),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
