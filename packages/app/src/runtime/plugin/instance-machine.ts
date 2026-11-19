import type { Cleanup, Messages } from "@opencode/plugin/gui"
import type { Entry } from "@opencode/plugin/gui/host"

export type PluginStatus = "loading" | "active" | "failed" | "disabled"

/** The last error a plugin raised: in its setup or an effect, or while one of its contributions rendered. */
export type PluginFailure = { readonly phase: "setup" | "render"; readonly error: string }

/** A window setup, as `Entry.windowEntry` loads it. */
export type PluginSetup = (ctx: never) => Cleanup | void

/** The definition a plugin was last listed with, and the one a reload replaced it with. */
type Listing = { readonly listed: Entry; readonly override: Entry | undefined }

export type PluginEntry<I> =
  /** Listed while startup waits for the enable settings; nothing loads yet. */
  | (Listing & { readonly status: "waiting" })
  | (Listing & { readonly status: "disabled" })
  /** The window entry and the current language's catalog load. */
  | (Listing & { readonly status: "loading"; readonly attempt: number })
  /** The instance exists: its global stores load, then setup runs. */
  | (Listing & {
      readonly status: "preparing"
      readonly attempt: number
      readonly instance: I
      readonly setup: PluginSetup
    })
  /** `instance` is undefined for a plugin without a window entry, which has nothing to run here. */
  | (Listing & {
      readonly status: "active"
      readonly attempt: number
      readonly instance: I | undefined
      readonly renderError: string | undefined
    })
  /** Waits for Reload, a new revision of its definition, or a disable and enable. */
  | (Listing & { readonly status: "failed"; readonly error: string })

type Running<I> = Extract<PluginEntry<I>, { status: "loading" | "preparing" | "active" }>

export type PluginHostState<I> = {
  /** `configuring` until the enable settings are known, when nothing may start. */
  readonly status: "configuring" | "running" | "disposed"
  readonly issued: number
  readonly plugins: Readonly<Record<string, PluginEntry<I>>>
}

export type PluginHostEvent<I> =
  | {
      readonly type: "reconcile"
      readonly definitions: readonly Entry[]
      /** Undefined while startup waits for the enable settings. */
      readonly disabled: ReadonlySet<string> | undefined
    }
  /** `next` replaces the definition, e.g. after a development hot update. */
  | { readonly type: "reload"; readonly id: string; readonly next: Entry | undefined }
  | {
      readonly type: "loaded"
      readonly id: string
      readonly attempt: number
      readonly setup: PluginSetup
      readonly messages: Messages
    }
  | {
      readonly type: "created"
      readonly id: string
      readonly attempt: number
      readonly instance: I
      readonly setup: PluginSetup
    }
  | { readonly type: "prepared"; readonly id: string; readonly attempt: number }
  | { readonly type: "started"; readonly id: string; readonly attempt: number }
  /** The load, the store read or setup failed, or one of the plugin's effects threw later. */
  | { readonly type: "failed"; readonly id: string; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "timeout"; readonly id: string; readonly attempt: number }
  /** A contribution threw while it rendered. */
  | { readonly type: "render.failed"; readonly id: string; readonly cause: unknown }
  | { readonly type: "disposed" }

export type PluginHostEffect<I> =
  | {
      readonly type: "load"
      readonly id: string
      readonly attempt: number
      readonly definition: Entry
      readonly load: NonNullable<Entry["windowEntry"]>
    }
  | {
      readonly type: "create"
      readonly id: string
      readonly attempt: number
      readonly definition: Entry
      readonly setup: PluginSetup
      readonly messages: Messages
    }
  | { readonly type: "prepare"; readonly id: string; readonly attempt: number; readonly instance: I }
  | {
      readonly type: "start"
      readonly id: string
      readonly attempt: number
      readonly instance: I
      readonly setup: PluginSetup
    }
  | { readonly type: "dispose"; readonly instance: I }
  /** Replaces the plugin's running activation timer. */
  | { readonly type: "timer.start"; readonly id: string; readonly attempt: number }
  | { readonly type: "timer.stop"; readonly id: string }
  /** Forgets which tokens the plugin provides, so the next definition under its id resolves them again. */
  | { readonly type: "forget"; readonly id: string }
  | { readonly type: "log"; readonly id: string; readonly cause: unknown }

export type PluginHostTransition<I> = {
  readonly state: PluginHostState<I>
  readonly effects: readonly PluginHostEffect<I>[]
}

export function createPluginHostState<I>(): PluginHostState<I> {
  return { status: "configuring", issued: 0, plugins: {} }
}

export function transitionPluginHost<I>(state: PluginHostState<I>, event: PluginHostEvent<I>): PluginHostTransition<I> {
  if (state.status === "disposed") {
    // A root created as the host went away still has to go.
    if (event.type === "created") return step(state, [{ type: "dispose", instance: event.instance }])

    return step(state)
  }

  if (event.type === "disposed")
    return step(
      { status: "disposed", issued: state.issued, plugins: {} },
      Object.entries(state.plugins).flatMap(([id, entry]) => teardown(id, entry)),
    )

  if (event.type === "reconcile") return reconcile(state, event.definitions, event.disabled)

  const entry = state.plugins[event.id]

  if (event.type === "render.failed") {
    const log = [{ type: "log", id: event.id, cause: event.cause } as const]

    // A contribution that fails to render renders nothing; the plugin and its other contributions stay. A late
    // failure of a plugin that is no longer active records nothing.
    if (entry?.status !== "active") return step(state, log)

    const error = formatError(event.cause)

    if (entry.renderError === error) return step(state, log)

    return step(put(state, event.id, { ...entry, renderError: error }), log)
  }

  if (!entry) {
    if (event.type === "created") return step(state, [{ type: "dispose", instance: event.instance }])

    return step(state)
  }

  if (event.type === "reload") {
    const override = event.next ?? entry.override

    // A plugin that is off, or still waits for the settings, starts the replacement once it may start.
    if (entry.status === "waiting" || entry.status === "disabled") {
      if (override === entry.override) return step(state)

      return step(put(state, event.id, { ...entry, override }))
    }

    const started = start(state, event.id, entry.listed, override)

    return step(started.state, [...teardown(event.id, entry), ...started.effects])
  }

  if (event.type === "created") {
    if (entry.status !== "loading" || entry.attempt !== event.attempt)
      return step(state, [{ type: "dispose", instance: event.instance }])

    const effect = stores(entry.override ?? entry.listed)
      ? ({ type: "prepare", id: event.id, attempt: entry.attempt, instance: event.instance } as const)
      : ({ type: "start", id: event.id, attempt: entry.attempt, instance: event.instance, setup: event.setup } as const)

    return step(
      put(state, event.id, {
        status: "preparing",
        listed: entry.listed,
        override: entry.override,
        attempt: entry.attempt,
        instance: event.instance,
        setup: event.setup,
      }),
      [effect],
    )
  }

  if (event.type === "loaded") {
    if (entry.status !== "loading" || entry.attempt !== event.attempt) return step(state)

    return step(state, [
      {
        type: "create",
        id: event.id,
        attempt: entry.attempt,
        definition: entry.override ?? entry.listed,
        setup: event.setup,
        messages: event.messages,
      },
    ])
  }

  if (event.type === "prepared") {
    if (entry.status !== "preparing" || entry.attempt !== event.attempt) return step(state)

    return step(state, [
      { type: "start", id: event.id, attempt: entry.attempt, instance: entry.instance, setup: entry.setup },
    ])
  }

  if (event.type === "started") {
    if (entry.status !== "preparing" || entry.attempt !== event.attempt) return step(state)

    return step(
      put(state, event.id, {
        status: "active",
        listed: entry.listed,
        override: entry.override,
        attempt: entry.attempt,
        instance: entry.instance,
        renderError: undefined,
      }),
      [{ type: "timer.stop", id: event.id }],
    )
  }

  if (event.type === "failed") {
    if (!running(entry) || entry.attempt !== event.attempt) return step(state)

    return fail(state, event.id, entry, event.cause)
  }

  if (entry.status !== "loading" && entry.status !== "preparing") return step(state)

  if (entry.attempt !== event.attempt) return step(state)

  return fail(state, event.id, entry, new Error("Plugin activation timed out"))
}

/** What `host.status` reports: a plugin that waits for the settings has none yet. */
export function selectPluginStatus<I>(state: PluginHostState<I>, id: string): PluginStatus | undefined {
  const entry = state.plugins[id]

  if (!entry || entry.status === "waiting") return undefined

  if (entry.status === "preparing") return "loading"

  return entry.status
}

export function selectPluginFailure<I>(state: PluginHostState<I>, id: string): PluginFailure | undefined {
  const entry = state.plugins[id]

  if (entry?.status === "failed") return { phase: "setup", error: entry.error }

  if (entry?.status === "active" && entry.renderError !== undefined)
    return { phase: "render", error: entry.renderError }

  return undefined
}

/** The plugin's running instance, from the moment it exists until it goes away. */
export function selectPluginInstance<I>(state: PluginHostState<I>, id: string) {
  const entry = state.plugins[id]

  if (entry?.status === "preparing" || entry?.status === "active") return entry.instance

  return undefined
}

export function selectPluginInstances<I>(state: PluginHostState<I>) {
  return Object.values(state.plugins).flatMap((entry) =>
    (entry.status === "preparing" || entry.status === "active") && entry.instance !== undefined ? [entry.instance] : [],
  )
}

/** Startup no longer waits for the plugin: it settled, or left before it did. */
export function selectPluginSettled<I>(state: PluginHostState<I>, id: string) {
  const entry = state.plugins[id]

  if (!entry) return state.status === "running"

  return entry.status === "active" || entry.status === "failed" || entry.status === "disabled"
}

/** Each definition as the host runs it: replaced by its last reload's. */
export function selectPluginDefinitions<I>(state: PluginHostState<I>, definitions: readonly Entry[]) {
  return definitions.map((definition) => state.plugins[definition.id]?.override ?? definition)
}

function reconcile<I>(
  state: PluginHostState<I>,
  definitions: readonly Entry[],
  disabled: ReadonlySet<string> | undefined,
): PluginHostTransition<I> {
  const ids = new Set(definitions.map((definition) => definition.id))

  // Forgets everything about a plugin whose definition left, so a later one under its id starts afresh.
  const removed = Object.entries(state.plugins).flatMap(([id, entry]) =>
    ids.has(id) ? [] : [...teardown(id, entry), { type: "forget", id } as const],
  )

  const status: PluginHostState<I>["status"] = disabled ? "running" : state.status
  const initial = { state: { status, issued: state.issued, plugins: {} }, effects: removed }

  const next = definitions.reduce<PluginHostTransition<I>>((current, definition) => {
    const id = definition.id
    const previous = state.plugins[id]
    // A new object for a listed id is a new revision of the plugin: it starts afresh.
    const kept = previous?.listed === definition ? previous : undefined
    const replaced = previous && !kept ? [...teardown(id, previous), { type: "forget", id } as const] : []
    const listing = { listed: definition, override: kept?.override }
    const effects = [...current.effects, ...replaced]

    if (!disabled) return { state: put(current.state, id, kept ?? { ...listing, status: "waiting" }), effects }

    if (disabled.has(id)) {
      if (kept?.status === "disabled") return { state: put(current.state, id, kept), effects }

      // A plugin that is off shows no error from its last run.
      return {
        state: put(current.state, id, { ...listing, status: "disabled" }),
        effects: [...effects, ...(kept ? teardown(id, kept) : [])],
      }
    }

    // A loading, running or failed plugin keeps going; a failed one waits for Reload or a new revision.
    if (kept && kept.status !== "waiting" && kept.status !== "disabled")
      return { state: put(current.state, id, kept), effects }

    const started = start(current.state, id, listing.listed, listing.override)

    return { state: started.state, effects: [...effects, ...started.effects] }
  }, initial)

  const same =
    next.effects.length === 0 &&
    next.state.status === state.status &&
    Object.keys(state.plugins).length === definitions.length &&
    definitions.every((definition) => next.state.plugins[definition.id] === state.plugins[definition.id])

  return same ? step(state) : next
}

/** Starts a new attempt: a plugin without a window entry is active at once. */
function start<I>(state: PluginHostState<I>, id: string, listed: Entry, override: Entry | undefined) {
  const attempt = state.issued + 1
  const definition = override ?? listed
  const load = definition.windowEntry
  const issued = { ...state, issued: attempt }

  if (!load)
    return step(
      put(issued, id, { status: "active", listed, override, attempt, instance: undefined, renderError: undefined }),
    )

  return step(put(issued, id, { status: "loading", listed, override, attempt }), [
    { type: "load", id, attempt, definition, load },
    { type: "timer.start", id, attempt },
  ])
}

function fail<I>(state: PluginHostState<I>, id: string, entry: Running<I>, cause: unknown) {
  return step(
    put(state, id, { status: "failed", listed: entry.listed, override: entry.override, error: formatError(cause) }),
    [...teardown(id, entry), { type: "log", id, cause }],
  )
}

/** Stops whatever the entry runs: its activation timer and its instance. */
function teardown<I>(id: string, entry: PluginEntry<I>): PluginHostEffect<I>[] {
  if (entry.status === "loading") return [{ type: "timer.stop", id }]

  if (entry.status === "preparing")
    return [
      { type: "timer.stop", id },
      { type: "dispose", instance: entry.instance },
    ]

  if (entry.status === "active" && entry.instance !== undefined) return [{ type: "dispose", instance: entry.instance }]

  return []
}

function running<I>(entry: PluginEntry<I>): entry is Running<I> {
  return entry.status === "loading" || entry.status === "preparing" || entry.status === "active"
}

function stores(definition: Entry) {
  return Object.keys(definition.stores ?? {}).length > 0
}

function put<I>(state: PluginHostState<I>, id: string, entry: PluginEntry<I>): PluginHostState<I> {
  return { ...state, plugins: { ...state.plugins, [id]: entry } }
}

function formatError(cause: unknown) {
  return cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
}

function step<I>(state: PluginHostState<I>, effects: readonly PluginHostEffect<I>[] = []): PluginHostTransition<I> {
  return { state, effects }
}
