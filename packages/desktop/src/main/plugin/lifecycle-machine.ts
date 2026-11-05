import type { Scope } from "@opencode/plugin/gui/host"

/** One running copy of a plugin's main code; the machine only compares its scope. */
export type Managed = { readonly instance: { readonly scope: Scope } }

/** Settles one `activate`, `deactivate` or `reload` call. */
export type Reply = () => void

/** An operation waiting for the step in flight; a `deactivate` never waits, it takes over at once. */
export type Queued = { readonly kind: "activate" | "reload"; readonly reply: Reply }

/** The step in flight: the replies it settles, the operations behind it, and the failure shown meanwhile. */
type Step = {
  readonly attempt: number
  readonly error: string | undefined
  readonly replies: readonly Reply[]
  readonly queue: readonly Queued[]
}

/**
 * An instance of `revision` starting. `fallback` is the revision whose setup last succeeded, which a failed reload
 * returns to; `isFallback` marks the instance as that return, so its own failure has nothing left to return to.
 */
type Starting<Rev> = Step & { readonly revision: Rev; readonly fallback: Rev | undefined; readonly isFallback: boolean }

/**
 * Where one plugin stands. A plugin with no entry is stopped with no failure.
 *
 * - `loading`: its code loads. `kept` is the good instance a reload leaves running until the new code loaded.
 * - `creating`, `preparing`, `setting-up`: an instance of the loaded revision starts.
 * - `active`: its setup succeeded. `error` is a failed reload's, when the instance is the fallback.
 * - `disposing`: the instance withdrew everything at once and its finalizers run. `next` is the revision to start
 *   once they finished; `after` runs then, before the replies settle.
 */
export type PluginEntry<R extends Managed, Rev> =
  | { readonly status: "failed"; readonly error: string }
  | (Step & {
      readonly status: "loading"
      readonly kept: { readonly running: R; readonly revision: Rev } | undefined
      readonly fallback: Rev | undefined
    })
  | (Starting<Rev> & { readonly status: "creating" })
  | (Starting<Rev> & { readonly status: "preparing" | "setting-up"; readonly running: R })
  | { readonly status: "active"; readonly running: R; readonly revision: Rev; readonly error: string | undefined }
  | (Step & {
      readonly status: "disposing"
      readonly running: R
      readonly fallback: Rev | undefined
      readonly next: { readonly revision: Rev; readonly isFallback: boolean } | undefined
      readonly after: readonly (() => void)[]
    })

export type LifecycleState<R extends Managed, Rev> = {
  readonly issued: number
  readonly plugins: Readonly<Record<string, PluginEntry<R, Rev>>>
}

// `keep` is the scope a restart handoff keeps running, when one runs.
export type LifecycleEvent<R extends Managed, Rev> =
  | { readonly type: "activate.requested"; readonly id: string; readonly reply: Reply }
  | { readonly type: "deactivate.requested"; readonly id: string; readonly after?: () => void; readonly reply: Reply }
  | { readonly type: "reload.requested"; readonly id: string; readonly keep: Scope | undefined; readonly reply: Reply }
  | { readonly type: "stop.requested"; readonly id: string; readonly keep: Scope | undefined; readonly reply: Reply }
  | { readonly type: "forget.requested"; readonly id: string }
  | { readonly type: "load.started"; readonly id: string; readonly attempt: number }
  | { readonly type: "load.succeeded"; readonly id: string; readonly attempt: number; readonly revision: Rev }
  | { readonly type: "load.failed"; readonly id: string; readonly attempt: number; readonly error: unknown }
  | { readonly type: "load.cancelled"; readonly id: string; readonly attempt: number }
  | { readonly type: "instance.created"; readonly id: string; readonly attempt: number; readonly running: R }
  | { readonly type: "instance.ready"; readonly id: string; readonly attempt: number; readonly canRun: boolean }
  | { readonly type: "setup.succeeded"; readonly id: string; readonly attempt: number }
  | { readonly type: "setup.failed"; readonly id: string; readonly attempt: number; readonly error: unknown }
  | { readonly type: "dispose.settled"; readonly id: string; readonly attempt: number; readonly canRun: boolean }

export type LifecycleCommand<R extends Managed, Rev> =
  | { readonly type: "load"; readonly id: string; readonly attempt: number }
  | { readonly type: "create"; readonly id: string; readonly attempt: number; readonly revision: Rev }
  | { readonly type: "await-ready"; readonly id: string; readonly attempt: number; readonly running: R }
  | { readonly type: "run-setup"; readonly id: string; readonly attempt: number; readonly running: R }
  /** Without `attempt`, the instance belongs to no step and nothing waits for it. */
  | { readonly type: "dispose"; readonly id: string; readonly attempt?: number; readonly running: R }
  | { readonly type: "run-after"; readonly callbacks: readonly (() => void)[] }
  | { readonly type: "resolve"; readonly replies: readonly Reply[] }
  | { readonly type: "notify-changed" }
  | { readonly type: "log-failure"; readonly id: string; readonly error: unknown }

export type LifecycleTransition<R extends Managed, Rev> = {
  readonly state: LifecycleState<R, Rev>
  readonly commands: readonly LifecycleCommand<R, Rev>[]
}

type Entry<R extends Managed, Rev> = PluginEntry<R, Rev> | undefined

/** Where a step leaves the plugin when nothing is in flight. */
type Settled<R extends Managed, Rev> = Extract<PluginEntry<R, Rev>, { status: "failed" | "active" }> | undefined

type Context<R extends Managed, Rev> = {
  readonly id: string
  issued: number
  readonly commands: LifecycleCommand<R, Rev>[]
}

export function createLifecycleState<R extends Managed, Rev>(): LifecycleState<R, Rev> {
  return { issued: 0, plugins: {} }
}

export function transitionLifecycle<R extends Managed, Rev>(
  state: LifecycleState<R, Rev>,
  event: LifecycleEvent<R, Rev>,
): LifecycleTransition<R, Rev> {
  const ctx: Context<R, Rev> = { id: event.id, issued: state.issued, commands: [] }
  const entry = Object.hasOwn(state.plugins, event.id) ? state.plugins[event.id] : undefined
  const next = step(ctx, entry, event)

  if (next === entry && ctx.issued === state.issued) return { state, commands: ctx.commands }

  return { state: { issued: ctx.issued, plugins: write(state.plugins, event.id, next) }, commands: ctx.commands }
}

/** The failure Settings shows for the plugin. */
export const selectPluginFailure = <R extends Managed, Rev>(state: LifecycleState<R, Rev>, id: string) =>
  Object.hasOwn(state.plugins, id) ? state.plugins[id].error : undefined

/** Whether a live instance has `scope`: the only scope a restart handoff may keep. */
export const selectHasPluginScope = <R extends Managed, Rev>(state: LifecycleState<R, Rev>, scope: Scope) =>
  Object.values(state.plugins).some((entry) => held(entry, scope) !== undefined)

/** The plugins a stop reaches: every one with an instance, a step in flight or a failure. */
export const selectPluginIds = <R extends Managed, Rev>(state: LifecycleState<R, Rev>) => Object.keys(state.plugins)

function step<R extends Managed, Rev>(
  ctx: Context<R, Rev>,
  entry: Entry<R, Rev>,
  event: LifecycleEvent<R, Rev>,
): Entry<R, Rev> {
  switch (event.type) {
    case "activate.requested": {
      if (entry === undefined || entry.status === "failed")
        return load(ctx, { kept: undefined, fallback: undefined, error: entry?.error, replies: [event.reply], queue: [] })

      if (entry.status !== "active") return { ...entry, queue: [...entry.queue, { kind: "activate", reply: event.reply }] }
      resolve(ctx, [event.reply])

      return entry
    }

    case "deactivate.requested":
      return deactivate(ctx, entry, event.after ? [event.after] : [], event.reply)

    case "stop.requested": {
      const kept = held(entry, event.keep)

      if (!kept) return deactivate(ctx, entry, [], event.reply)

      // A restart handoff keeps its caller's instance as it is: a reload it started ends, and so does what waited.
      if (kept.status === "loading") {
        resolve(ctx, [...kept.replies, ...replies(kept.queue), event.reply])

        return unloaded(kept, kept.error)
      }

      if (kept.status === "active") {
        resolve(ctx, [event.reply])

        return kept
      }

      resolve(ctx, [...replies(kept.queue), event.reply])

      return { ...kept, queue: [] }
    }

    case "reload.requested":
      return reload(ctx, entry, event.keep, event.reply)

    case "forget.requested": {
      if (entry === undefined) return entry

      if (entry.status === "failed") return undefined

      return entry.error === undefined ? entry : { ...entry, error: undefined }
    }

    case "load.started": {
      if (entry?.status !== "loading" || entry.attempt !== event.attempt || entry.error === undefined) return entry
      notify(ctx)

      return { ...entry, error: undefined }
    }

    case "load.cancelled": {
      if (entry?.status !== "loading" || entry.attempt !== event.attempt) return entry
      resolve(ctx, entry.replies)

      return drain(ctx, unloaded(entry, entry.error), entry.fallback, entry.queue)
    }

    case "load.failed": {
      if (entry?.status !== "loading" || entry.attempt !== event.attempt) return entry
      const error = fail(ctx, event)

      // With no good instance running, the last good revision starts again.
      if (!entry.kept && entry.fallback !== undefined)
        return create(ctx, { ...pending(entry), error, revision: entry.fallback, fallback: entry.fallback, isFallback: true })
      resolve(ctx, entry.replies)

      return drain(ctx, unloaded(entry, error), entry.fallback, entry.queue)
    }

    case "load.succeeded": {
      if (entry?.status !== "loading" || entry.attempt !== event.attempt) return entry

      // The good instance keeps running until the new code loaded; the new one starts once it finished.
      if (entry.kept)
        return dispose(ctx, {
          ...pending(entry),
          running: entry.kept.running,
          fallback: entry.fallback,
          next: { revision: event.revision, isFallback: false },
          after: [],
        })

      return create(ctx, { ...pending(entry), revision: event.revision, fallback: entry.fallback, isFallback: false })
    }

    case "instance.created": {
      if (entry?.status !== "creating" || entry.attempt !== event.attempt) {
        ctx.commands.push({ type: "dispose", id: ctx.id, running: event.running })

        return entry
      }

      ctx.commands.push({ type: "await-ready", id: ctx.id, attempt: entry.attempt, running: event.running })

      return { ...entry, status: "preparing", running: event.running }
    }

    case "instance.ready": {
      if (entry?.status !== "preparing" || entry.attempt !== event.attempt) return entry

      // Stopped meanwhile: setup never runs.
      if (!event.canRun)
        return dispose(ctx, {
          ...pending(entry),
          running: entry.running,
          fallback: entry.fallback,
          next: undefined,
          after: [],
        })

      ctx.commands.push({ type: "run-setup", id: ctx.id, attempt: entry.attempt, running: entry.running })

      return { ...entry, status: "setting-up" }
    }

    case "setup.succeeded": {
      if (entry?.status !== "setting-up" || entry.attempt !== event.attempt) return entry
      resolve(ctx, entry.replies)
      const error = entry.isFallback ? entry.error : undefined

      return drain(ctx, { status: "active", running: entry.running, revision: entry.revision, error }, entry.revision, entry.queue)
    }

    case "setup.failed": {
      if (entry?.status !== "setting-up" || entry.attempt !== event.attempt) return entry
      const error = fail(ctx, event)
      // A fallback that fails too leaves nothing to return to.
      const fallback = entry.isFallback ? undefined : entry.fallback

      return dispose(ctx, {
        ...pending(entry),
        error,
        running: entry.running,
        fallback,
        next: fallback === undefined ? undefined : { revision: fallback, isFallback: true },
        after: [],
      })
    }

    case "dispose.settled": {
      if (entry?.status !== "disposing" || entry.attempt !== event.attempt) return entry

      if (entry.next && event.canRun)
        return create(ctx, {
          ...pending(entry),
          revision: entry.next.revision,
          fallback: entry.fallback,
          isFallback: entry.next.isFallback,
        })

      runAfter(ctx, entry.after)
      resolve(ctx, entry.replies)

      return drain(ctx, idle(entry.error), entry.fallback, entry.queue)
    }
  }
}

/**
 * Stops the plugin at once: whatever is in flight or waiting ends, and an instance withdraws everything now. The
 * replies settle, after `after` ran, once its finalizers finished.
 */
function deactivate<R extends Managed, Rev>(
  ctx: Context<R, Rev>,
  entry: Entry<R, Rev>,
  after: readonly (() => void)[],
  reply: Reply,
): Entry<R, Rev> {
  if (entry === undefined || entry.status === "failed") {
    runAfter(ctx, after)
    resolve(ctx, [reply])

    return entry
  }

  if (entry.status === "disposing")
    return {
      ...entry,
      fallback: undefined,
      next: undefined,
      replies: [...entry.replies, ...replies(entry.queue), reply],
      after: [...entry.after, ...after],
      queue: [],
    }

  const waiting = entry.status === "active" ? [] : [...entry.replies, ...replies(entry.queue)]
  const running = live(entry)

  if (!running) {
    resolve(ctx, waiting)
    runAfter(ctx, after)
    resolve(ctx, [reply])

    return idle(entry.error)
  }

  return dispose(ctx, {
    error: entry.error,
    replies: [...waiting, reply],
    queue: [],
    running,
    fallback: undefined,
    next: undefined,
    after,
  })
}

/**
 * Replaces the plugin with its current code. A good instance keeps running until that code loaded; one still
 * starting stops at once. Whatever was in flight or waiting ends. The kept instance of a restart handoff stays as it is.
 */
function reload<R extends Managed, Rev>(
  ctx: Context<R, Rev>,
  entry: Entry<R, Rev>,
  scope: Scope | undefined,
  reply: Reply,
): Entry<R, Rev> {
  if (held(entry, scope)) {
    resolve(ctx, [reply])

    return entry
  }

  // A new attempt clears the last failure; Settings and windows hear of it at once.
  if (entry?.error !== undefined) notify(ctx)

  if (entry === undefined || entry.status === "failed")
    return load(ctx, { kept: undefined, fallback: undefined, error: undefined, replies: [reply], queue: [] })

  if (entry.status === "active")
    return load(ctx, {
      kept: { running: entry.running, revision: entry.revision },
      fallback: entry.revision,
      error: undefined,
      replies: [reply],
      queue: [],
    })

  const superseded = [...entry.replies, ...replies(entry.queue)]

  if (entry.status === "disposing")
    return { ...entry, error: undefined, next: undefined, replies: superseded, queue: [{ kind: "reload", reply }] }

  if (entry.status === "preparing" || entry.status === "setting-up")
    return dispose(ctx, {
      error: undefined,
      replies: superseded,
      queue: [{ kind: "reload", reply }],
      running: entry.running,
      fallback: entry.fallback,
      next: undefined,
      after: [],
    })

  resolve(ctx, superseded)

  return load(ctx, {
    kept: entry.status === "loading" ? entry.kept : undefined,
    fallback: entry.fallback,
    error: undefined,
    replies: [reply],
    queue: [],
  })
}

/** Runs the operations that waited for the step that settled, until one starts a step of its own. */
function drain<R extends Managed, Rev>(
  ctx: Context<R, Rev>,
  settled: Settled<R, Rev>,
  fallback: Rev | undefined,
  queue: readonly Queued[],
): Entry<R, Rev> {
  const item = queue[0]

  if (!item) return settled
  const rest = queue.slice(1)

  if (item.kind === "activate") {
    if (settled?.status !== "active")
      return load(ctx, { kept: undefined, fallback: undefined, error: settled?.error, replies: [item.reply], queue: rest })
    resolve(ctx, [item.reply])

    return drain(ctx, settled, fallback, rest)
  }

  if (settled?.error !== undefined) notify(ctx)

  if (settled?.status === "active")
    return load(ctx, {
      kept: { running: settled.running, revision: settled.revision },
      fallback: settled.revision,
      error: undefined,
      replies: [item.reply],
      queue: rest,
    })

  return load(ctx, { kept: undefined, fallback, error: undefined, replies: [item.reply], queue: rest })
}

function load<R extends Managed, Rev>(
  ctx: Context<R, Rev>,
  fields: Omit<Extract<PluginEntry<R, Rev>, { status: "loading" }>, "status" | "attempt">,
): PluginEntry<R, Rev> {
  const attempt = ++ctx.issued
  ctx.commands.push({ type: "load", id: ctx.id, attempt })

  return { ...fields, status: "loading", attempt }
}

function create<R extends Managed, Rev>(
  ctx: Context<R, Rev>,
  fields: Omit<Extract<PluginEntry<R, Rev>, { status: "creating" }>, "status" | "attempt">,
): PluginEntry<R, Rev> {
  const attempt = ++ctx.issued
  ctx.commands.push({ type: "create", id: ctx.id, attempt, revision: fields.revision })

  return { ...fields, status: "creating", attempt }
}

function dispose<R extends Managed, Rev>(
  ctx: Context<R, Rev>,
  fields: Omit<Extract<PluginEntry<R, Rev>, { status: "disposing" }>, "status" | "attempt">,
): PluginEntry<R, Rev> {
  const attempt = ++ctx.issued
  ctx.commands.push({ type: "dispose", id: ctx.id, attempt, running: fields.running })

  return { ...fields, status: "disposing", attempt }
}

/** The step's replies and waiting operations, carried into the next phase. */
function pending(entry: Step) {
  return { error: entry.error, replies: entry.replies, queue: entry.queue }
}

/** The kept instance again, or nothing, when a reload ends without replacing it. */
function unloaded<R extends Managed, Rev>(
  entry: Extract<PluginEntry<R, Rev>, { status: "loading" }>,
  error: string | undefined,
): Settled<R, Rev> {
  if (!entry.kept) return idle(error)

  return { status: "active", running: entry.kept.running, revision: entry.kept.revision, error }
}

function idle(error: string | undefined) {
  return error === undefined ? undefined : ({ status: "failed", error } as const)
}

/** The entry when its live instance has `scope`. */
function held<R extends Managed, Rev>(entry: Entry<R, Rev>, scope: Scope | undefined) {
  if (scope === undefined || entry === undefined || entry.status === "failed" || entry.status === "disposing")
    return undefined

  return live(entry)?.instance.scope === scope ? entry : undefined
}

/** The instance running or starting: the kept one while a reload loads, none while one is being created. */
function live<R extends Managed, Rev>(entry: Exclude<PluginEntry<R, Rev>, { status: "failed" | "disposing" }>) {
  if (entry.status === "loading") return entry.kept?.running

  if (entry.status === "creating") return undefined

  return entry.running
}

function replies(queue: readonly Queued[]) {
  return queue.map((item) => item.reply)
}

function resolve<R extends Managed, Rev>(ctx: Context<R, Rev>, list: readonly Reply[]) {
  if (list.length) ctx.commands.push({ type: "resolve", replies: list })
}

function notify<R extends Managed, Rev>(ctx: Context<R, Rev>) {
  ctx.commands.push({ type: "notify-changed" })
}

/** Records the failure the event reports and returns the message Settings shows. */
function fail<R extends Managed, Rev>(
  ctx: Context<R, Rev>,
  event: Extract<LifecycleEvent<R, Rev>, { type: "load.failed" | "setup.failed" }>,
) {
  ctx.commands.push({ type: "log-failure", id: ctx.id, error: event.error }, { type: "notify-changed" })

  return event.error instanceof Error ? event.error.message : String(event.error)
}

function runAfter<R extends Managed, Rev>(ctx: Context<R, Rev>, callbacks: readonly (() => void)[]) {
  if (callbacks.length) ctx.commands.push({ type: "run-after", callbacks })
}

function write<R extends Managed, Rev>(
  plugins: Readonly<Record<string, PluginEntry<R, Rev>>>,
  id: string,
  entry: Entry<R, Rev>,
) {
  if (entry) return { ...plugins, [id]: entry }

  return Object.fromEntries(Object.entries(plugins).filter(([key]) => key !== id))
}
