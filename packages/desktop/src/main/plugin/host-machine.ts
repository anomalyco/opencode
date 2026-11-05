import type { BuiltinCatalog } from "@opencode/plugin/gui/builtin"
import type { Messages } from "@opencode/plugin/gui/main"
import { Predicate } from "effect"

export const WATCH_RETRY_MS = 1_000

export const LIST_TIMEOUT_MS = 30_000

/** How long a locale's catalog may load before the plugin falls back to English. */
export const CATALOG_TIMEOUT_MS = 5_000

export type HostCatalogLoader = () => Promise<{ readonly default: Messages }>

// A plugin instance's copy in the app locale. While a locale loads the instance keeps the copy it had; `ready` is the
// instance's setup waiting for its first copy, and is undefined once the instance runs.
export type HostCatalog =
  | {
      readonly status: "loading"
      readonly catalog: BuiltinCatalog | undefined
      readonly messages: Messages
      readonly attempt: number
      readonly ready: (() => void) | undefined
    }
  | { readonly status: "ready"; readonly catalog: BuiltinCatalog | undefined; readonly messages: Messages }

/** The app's own server as main reaches it. */
export type HostEndpoint = {
  readonly url: string
  readonly authorization: string | undefined
}

// The event stream of the app's own server: a stream that ends while its endpoint stays retries after a pause.
export type HostWatch =
  | { readonly status: "idle" }
  | { readonly status: "streaming"; readonly attempt: number }
  | { readonly status: "retrying"; readonly attempt: number }

// One listing of the server's plugins at a time; a change during a listing lists once more (`queued`).
export type HostList =
  | { readonly status: "idle" }
  | { readonly status: "listing"; readonly attempt: number; readonly queued: boolean }

// `menubarQueued` is a menubar publish waiting for its microtask, in either phase: quitting keeps the menu as it is.
// Plugin instances run in either phase too, so their catalogs follow the app locale in both.
type HostShared<Owner> = {
  readonly nextAttempt: number
  readonly menubarQueued: boolean
  readonly locale: string
  readonly catalogs: ReadonlyMap<Owner, HostCatalog>
}

export type HostState<Owner = unknown> =
  | ({ readonly status: "stopped" } & HostShared<Owner>)
  | ({
      readonly status: "following"
      readonly endpoint: HostEndpoint | undefined
      readonly watch: HostWatch
      readonly list: HostList
    } & HostShared<Owner>)

// `quitting` is the app lifecycle's answer when the event happened.
export type HostEvent<Listing, Owner = unknown> =
  | { readonly type: "started"; readonly endpoint: HostEndpoint | undefined; readonly quitting: boolean }
  | { readonly type: "resumed"; readonly endpoint: HostEndpoint | undefined; readonly quitting: boolean }
  | { readonly type: "stopped" }
  | { readonly type: "endpoint.changed"; readonly endpoint: HostEndpoint | undefined; readonly quitting: boolean }
  | { readonly type: "watch.ended"; readonly attempt: number; readonly quitting: boolean }
  | { readonly type: "watch.retry-due"; readonly attempt: number; readonly quitting: boolean }
  | { readonly type: "relist.requested"; readonly watchAttempt: number; readonly quitting: boolean }
  | { readonly type: "list.succeeded"; readonly attempt: number; readonly listing: Listing; readonly quitting: boolean }
  | { readonly type: "list.failed"; readonly attempt: number; readonly cause: unknown; readonly quitting: boolean }
  | { readonly type: "list.timed-out"; readonly attempt: number; readonly quitting: boolean }
  | { readonly type: "menubar.scheduled" }
  | { readonly type: "menubar.flushed"; readonly quitting: boolean }
  | { readonly type: "locale.changed"; readonly locale: string }
  /** A plugin instance was created; `reply` lets its setup run once its copy is in the app locale. */
  | {
      readonly type: "catalog.registered"
      readonly owner: Owner
      readonly catalog: BuiltinCatalog | undefined
      readonly reply: () => void
    }
  | { readonly type: "catalog.unregistered"; readonly owner: Owner }
  | { readonly type: "catalog.loaded"; readonly owner: Owner; readonly attempt: number; readonly messages: Messages }
  | { readonly type: "catalog.failed"; readonly owner: Owner; readonly attempt: number }
  | { readonly type: "catalog.timed-out"; readonly owner: Owner; readonly attempt: number }

export type HostCommand<Listing, Owner = unknown> =
  | { readonly type: "subscribe-credentials" }
  | { readonly type: "unsubscribe-credentials" }
  | { readonly type: "start-watch"; readonly attempt: number; readonly endpoint: HostEndpoint }
  | { readonly type: "schedule-watch-retry"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-watch" }
  | {
      readonly type: "start-list"
      readonly attempt: number
      readonly endpoint: HostEndpoint
      readonly timeoutMs: number
    }
  | { readonly type: "cancel-list" }
  | { readonly type: "apply-listing"; readonly listing: Listing }
  | { readonly type: "log-list-error"; readonly cause: unknown }
  | { readonly type: "queue-menubar" }
  | { readonly type: "publish-menubar" }
  | {
      readonly type: "load-catalog"
      readonly owner: Owner
      readonly attempt: number
      readonly load: HostCatalogLoader
      readonly timeoutMs: number
    }
  | { readonly type: "cancel-catalog-timer"; readonly owner: Owner }
  | { readonly type: "resolve-catalog-ready"; readonly replies: readonly (() => void)[] }

export type HostTransition<Listing, Owner = unknown> = {
  readonly state: HostState<Owner>
  readonly commands: readonly HostCommand<Listing, Owner>[]
}

type Following<Owner> = Extract<HostState<Owner>, { status: "following" }>

export function createHostState<Owner = unknown>(locale: string): HostState<Owner> {
  return { status: "stopped", nextAttempt: 1, menubarQueued: false, locale, catalogs: new Map() }
}

export function transitionHost<Listing, Owner = unknown>(
  state: HostState<Owner>,
  event: HostEvent<Listing, Owner>,
): HostTransition<Listing, Owner> {
  switch (event.type) {
    case "locale.changed":
    case "catalog.registered":
    case "catalog.unregistered":
    case "catalog.loaded":
    case "catalog.failed":
    case "catalog.timed-out":
      return transitionCatalogs(state, event)

    case "menubar.scheduled":
      if (state.menubarQueued) return unchanged(state)

      return { state: { ...state, menubarQueued: true }, commands: [{ type: "queue-menubar" }] }

    case "menubar.flushed":
      if (!state.menubarQueued) return unchanged(state)

      // While quitting the menu keeps its items, a kept plugin's among them; resuming publishes it again.
      return {
        state: { ...state, menubarQueued: false },
        commands: event.quitting ? [] : [{ type: "publish-menubar" }],
      }

    case "resumed": {
      const queued = transitionHost<Listing, Owner>(state, { type: "menubar.scheduled" })
      const started = transitionHost<Listing, Owner>(queued.state, { ...event, type: "started" })

      return { state: started.state, commands: [...queued.commands, ...started.commands] }
    }

    case "started":
      if (state.status === "following") return follow(state, event.endpoint, event.quitting)

      if (event.quitting) return unchanged(state)

      return follow(
        { ...state, status: "following", endpoint: undefined, watch: IDLE_WATCH, list: IDLE_LIST },
        event.endpoint,
        false,
        [{ type: "subscribe-credentials" }],
      )

    case "stopped":
      if (state.status === "stopped") return unchanged(state)

      return {
        state: {
          status: "stopped",
          nextAttempt: state.nextAttempt,
          menubarQueued: state.menubarQueued,
          locale: state.locale,
          catalogs: state.catalogs,
        },
        commands: [{ type: "unsubscribe-credentials" }, ...cancelled<Listing, Owner>(state)],
      }
  }

  if (state.status !== "following") return unchanged(state)

  switch (event.type) {
    case "endpoint.changed":
      return follow(state, event.endpoint, event.quitting)

    case "watch.ended": {
      if (state.watch.status !== "streaming" || state.watch.attempt !== event.attempt) return unchanged(state)

      if (event.quitting) return { state: { ...state, watch: IDLE_WATCH }, commands: [] }
      const attempt = state.nextAttempt

      return {
        state: { ...state, nextAttempt: attempt + 1, watch: { status: "retrying", attempt } },
        commands: [{ type: "schedule-watch-retry", attempt, delayMs: WATCH_RETRY_MS }],
      }
    }

    case "watch.retry-due": {
      if (state.watch.status !== "retrying" || state.watch.attempt !== event.attempt) return unchanged(state)

      if (event.quitting || !state.endpoint) return { state: { ...state, watch: IDLE_WATCH }, commands: [] }
      const attempt = state.nextAttempt

      return {
        state: { ...state, nextAttempt: attempt + 1, watch: { status: "streaming", attempt } },
        commands: [{ type: "start-watch", attempt, endpoint: state.endpoint }],
      }
    }

    case "relist.requested": {
      if (event.quitting || !state.endpoint) return unchanged(state)

      if (state.watch.status !== "streaming" || state.watch.attempt !== event.watchAttempt) return unchanged(state)

      if (state.list.status === "listing")
        return state.list.queued
          ? unchanged(state)
          : { state: { ...state, list: { ...state.list, queued: true } }, commands: [] }

      return list(state, state.endpoint, [])
    }

    case "list.succeeded":
      if (!currentList(state, event.attempt)) return unchanged(state)

      if (event.quitting) return settleList(state, [], true)

      return settleList(state, [{ type: "apply-listing", listing: event.listing }], false)

    case "list.failed":
      if (!currentList(state, event.attempt)) return unchanged(state)

      return settleList(state, [{ type: "log-list-error", cause: event.cause }], event.quitting)

    case "list.timed-out":
      if (!currentList(state, event.attempt)) return unchanged(state)

      return settleList(
        state,
        [
          { type: "cancel-list" },
          { type: "log-list-error", cause: new Error(`Plugin listing timed out after ${LIST_TIMEOUT_MS} ms`) },
        ],
        event.quitting,
      )
  }
}

/** Whether a watch started with `attempt` is still the one to run. */
export function isCurrentHostWatch<Owner>(state: HostState<Owner>, attempt: number) {
  return state.status === "following" && state.watch.status === "streaming" && state.watch.attempt === attempt
}

export function sameHostEndpoint(a: HostEndpoint | undefined, b: HostEndpoint | undefined) {
  return a?.url === b?.url && a?.authorization === b?.authorization
}

const IDLE_WATCH: HostWatch = Object.freeze({ status: "idle" })

const IDLE_LIST: HostList = Object.freeze({ status: "idle" })

function currentList<Owner>(state: Following<Owner>, attempt: number) {
  return state.list.status === "listing" && state.list.attempt === attempt
}

// Every credential change follows the server anew, as each connection and reconnect publishes one. A listing keeps
// running only while the endpoint stays the same; one from a superseded endpoint never applies.
function follow<Listing, Owner>(
  state: Following<Owner>,
  endpoint: HostEndpoint | undefined,
  quitting: boolean,
  before: readonly HostCommand<Listing, Owner>[] = [],
): HostTransition<Listing, Owner> {
  const same = sameHostEndpoint(state.endpoint, endpoint)

  if (quitting && same && state.watch.status === "idle" && state.list.status === "idle" && before.length === 0)
    return unchanged(state)
  const stopsList = quitting || !same

  const commands: HostCommand<Listing, Owner>[] = [
    ...before,
    ...(state.watch.status === "idle" ? [] : [{ type: "cancel-watch" as const }]),
    ...(stopsList && state.list.status !== "idle" ? [{ type: "cancel-list" as const }] : []),
  ]

  const listing = stopsList ? IDLE_LIST : state.list

  if (quitting || !endpoint) return { state: { ...state, endpoint, watch: IDLE_WATCH, list: listing }, commands }
  const attempt = state.nextAttempt

  return {
    state: { ...state, endpoint, nextAttempt: attempt + 1, watch: { status: "streaming", attempt }, list: listing },
    commands: [...commands, { type: "start-watch", attempt, endpoint }],
  }
}

function list<Listing, Owner>(
  state: Following<Owner>,
  endpoint: HostEndpoint,
  before: readonly HostCommand<Listing, Owner>[],
): HostTransition<Listing, Owner> {
  const attempt = state.nextAttempt

  return {
    state: { ...state, nextAttempt: attempt + 1, list: { status: "listing", attempt, queued: false } },
    commands: [...before, { type: "start-list", attempt, endpoint, timeoutMs: LIST_TIMEOUT_MS }],
  }
}

// Ends the current listing and starts the queued one, if a change arrived meanwhile and the app is not quitting.
function settleList<Listing, Owner>(
  state: Following<Owner>,
  commands: readonly HostCommand<Listing, Owner>[],
  quitting: boolean,
): HostTransition<Listing, Owner> {
  if (!quitting && state.list.status === "listing" && state.list.queued && state.endpoint)
    return list(state, state.endpoint, commands)

  return { state: { ...state, list: IDLE_LIST }, commands }
}

function cancelled<Listing, Owner>(state: Following<Owner>): HostCommand<Listing, Owner>[] {
  return [
    ...(state.watch.status === "idle" ? [] : [{ type: "cancel-watch" as const }]),
    ...(state.list.status === "idle" ? [] : [{ type: "cancel-list" as const }]),
  ]
}

function unchanged<Listing, Owner>(state: HostState<Owner>): HostTransition<Listing, Owner> {
  return { state, commands: [] }
}

/** The plugin instance's copy in the app locale; English while its locale loads for the first time. */
export function selectCatalogMessages<Owner>(state: HostState<Owner>, owner: Owner): Messages {
  return state.catalogs.get(owner)?.messages ?? {}
}

type CatalogEvent<Owner> = Extract<
  HostEvent<unknown, Owner>,
  {
    type:
      | "locale.changed"
      | "catalog.registered"
      | "catalog.unregistered"
      | "catalog.loaded"
      | "catalog.failed"
      | "catalog.timed-out"
  }
>

// Each locale load carries an attempt, so a load a newer locale superseded (even one that switched back) never
// applies. A load that fails or hangs leaves English, and the instance's setup waits for its first copy either way.
function transitionCatalogs<Listing, Owner>(
  state: HostState<Owner>,
  event: CatalogEvent<Owner>,
): HostTransition<Listing, Owner> {
  switch (event.type) {
    case "catalog.registered": {
      const source = catalogSource(event.catalog, state.locale)

      if (source.kind === "sync")
        return {
          state: {
            ...state,
            catalogs: put(state.catalogs, event.owner, {
              status: "ready",
              catalog: event.catalog,
              messages: source.messages,
            }),
          },
          commands: [{ type: "resolve-catalog-ready", replies: [event.reply] }],
        }
      const attempt = state.nextAttempt

      return {
        state: {
          ...state,
          nextAttempt: attempt + 1,
          catalogs: put(state.catalogs, event.owner, {
            status: "loading",
            catalog: event.catalog,
            messages: event.catalog?.en ?? {},
            attempt,
            ready: event.reply,
          }),
        },
        commands: [loadCatalog(event.owner, attempt, source.load)],
      }
    }

    case "catalog.unregistered": {
      const entry = state.catalogs.get(event.owner)

      if (!entry) return unchanged(state)
      const catalogs = new Map(state.catalogs)
      catalogs.delete(event.owner)

      if (entry.status === "ready") return { state: { ...state, catalogs }, commands: [] }

      return publishWhenLoaded(
        {
          state: { ...state, catalogs },
          commands: [{ type: "cancel-catalog-timer", owner: event.owner }, ...waiting<Listing, Owner>(entry)],
        },
        !entry.ready,
      )
    }

    case "catalog.loaded":
    case "catalog.failed":
    case "catalog.timed-out": {
      const entry = state.catalogs.get(event.owner)

      if (entry?.status !== "loading" || entry.attempt !== event.attempt) return unchanged(state)
      const english = entry.catalog?.en ?? {}

      return publishWhenLoaded(
        {
          state: {
            ...state,
            catalogs: put(state.catalogs, event.owner, {
              status: "ready",
              catalog: entry.catalog,
              messages: event.type === "catalog.loaded" ? { ...english, ...event.messages } : english,
            }),
          },
          commands: [{ type: "cancel-catalog-timer", owner: event.owner }, ...waiting<Listing, Owner>(entry)],
        },
        !entry.ready,
      )
    }

    case "locale.changed": {
      if (event.locale === state.locale) return publishWhenLoaded({ state, commands: [] }, true)
      const commands: HostCommand<Listing, Owner>[] = []
      const replies: (() => void)[] = []
      const first = state.nextAttempt

      const catalogs = new Map(
        [...state.catalogs].map(([owner, entry], index): [Owner, HostCatalog] => {
          const source = catalogSource(entry.catalog, event.locale)
          const ready = entry.status === "loading" ? entry.ready : undefined

          if (source.kind === "async") {
            const attempt = first + index
            commands.push(loadCatalog(owner, attempt, source.load))

            // A running instance keeps its copy until the new locale loads.
            return [owner, { status: "loading", catalog: entry.catalog, messages: entry.messages, attempt, ready }]
          }

          if (entry.status === "loading") commands.push({ type: "cancel-catalog-timer", owner })

          if (ready) replies.push(ready)

          return [owner, { status: "ready", catalog: entry.catalog, messages: source.messages }]
        }),
      )

      return publishWhenLoaded(
        {
          state: { ...state, nextAttempt: first + state.catalogs.size, locale: event.locale, catalogs },
          commands: [...commands, ...(replies.length ? [{ type: "resolve-catalog-ready" as const, replies }] : [])],
        },
        true,
      )
    }
  }
}

type CatalogSource =
  | { readonly kind: "sync"; readonly messages: Messages }
  | { readonly kind: "async"; readonly load: HostCatalogLoader }

function catalogSource(catalog: BuiltinCatalog | undefined, locale: string): CatalogSource {
  const english = catalog?.en ?? {}
  const source = locale === "en" ? undefined : catalog?.[locale]

  if (!source) return { kind: "sync", messages: english }

  if (Predicate.isFunction(source)) return { kind: "async", load: source }

  return { kind: "sync", messages: { ...english, ...source } }
}

function loadCatalog<Listing, Owner>(
  owner: Owner,
  attempt: number,
  load: HostCatalogLoader,
): HostCommand<Listing, Owner> {
  return { type: "load-catalog", owner, attempt, load, timeoutMs: CATALOG_TIMEOUT_MS }
}

/** Lets an instance's setup run once its first copy settled, or once it went away. */
function waiting<Listing, Owner>(entry: HostCatalog): HostCommand<Listing, Owner>[] {
  return entry.status === "loading" && entry.ready ? [{ type: "resolve-catalog-ready", replies: [entry.ready] }] : []
}

function put<Owner>(catalogs: ReadonlyMap<Owner, HostCatalog>, owner: Owner, entry: HostCatalog) {
  return new Map(catalogs).set(owner, entry)
}

// The menubar shows running instances' copy, so it publishes once none of them still loads a locale. Instances whose
// setup waits for their first copy contribute no items yet.
function publishWhenLoaded<Listing, Owner>(
  next: HostTransition<Listing, Owner>,
  running: boolean,
): HostTransition<Listing, Owner> {
  if (!running) return next

  if ([...next.state.catalogs.values()].some((entry) => entry.status === "loading" && !entry.ready)) return next
  const queued = transitionHost<Listing, Owner>(next.state, { type: "menubar.scheduled" })

  return { state: queued.state, commands: [...next.commands, ...queued.commands] }
}
