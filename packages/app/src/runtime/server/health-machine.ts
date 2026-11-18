import { endpointCredentials } from "./machine"
import type { PluginServerStatus } from "./plugin-machine"
import type { ServerConnection } from "./registry"

export const SERVER_HEALTH_POLL_MS = 10_000

/** The answer of one `/api/info` probe. */
export type ServerProbeResult =
  | { readonly type: "healthy"; readonly version?: string; readonly hostname?: string }
  | { readonly type: "unauthorized" }
  | { readonly type: "unreachable" }

/**
 * What the app knows about a server's health. `checking` waits for the first answer from the current endpoint; a
 * contributed server that is not ready reports its plugin's stage instead.
 */
export type ServerHealth =
  | ServerProbeResult
  | { readonly type: "checking"; readonly managed: boolean }
  | { readonly type: "incompatible" }
  | { readonly type: "starting" }
  | { readonly type: "auth" }
  | { readonly type: "stopped" }

type PluginStage = Exclude<PluginServerStatus["type"], "ready">

/** A listed server, as plain values: the health checks keep the endpoint they started with. */
export type ServerHealthInput =
  | { readonly type: "staged"; readonly key: ServerConnection.Key; readonly stage: PluginStage }
  | {
      readonly type: "endpoint"
      readonly key: ServerConnection.Key
      readonly http: ServerConnection.HttpBase
      /** The plugin re-resolves the endpoint, so a new one shows as connecting until it answers. */
      readonly managed: boolean
    }

type Endpoint = { readonly http: ServerConnection.HttpBase; readonly auth: string; readonly managed: boolean }

/**
 * One server. Every probe carries the slot's `attempt`; an answer for another attempt is stale. `checking` and
 * `refreshing` have a probe in flight, `settled` waits for the next poll.
 */
export type ServerHealthSlot =
  | { readonly type: "staged"; readonly stage: PluginStage; readonly attempt: number }
  | { readonly type: "checking"; readonly endpoint: Endpoint; readonly attempt: number }
  | {
      readonly type: "settled"
      readonly endpoint: Endpoint
      readonly result: ServerProbeResult
      readonly attempt: number
    }
  | {
      readonly type: "refreshing"
      readonly endpoint: Endpoint
      readonly result: ServerProbeResult
      readonly attempt: number
    }

/** A `retry` caller, waiting for each server's probe from at least the given attempt. */
type RetryWaiter = {
  readonly resolve: () => void
  readonly targets: ReadonlyMap<ServerConnection.Key, number>
}

export type ServerHealthState = {
  readonly entries: ReadonlyMap<ServerConnection.Key, ServerHealthSlot>
  readonly waiters: readonly RetryWaiter[]
}

/** An accepted probe answer, with the endpoint credentials it used. */
export type ServerProbe = {
  readonly key: ServerConnection.Key
  readonly auth: string
  readonly result: ServerProbeResult
}

export type ServerHealthEvent =
  | { readonly type: "servers.synced"; readonly servers: readonly ServerHealthInput[] }
  | { readonly type: "poll.due" }
  | { readonly type: "retry.requested"; readonly resolve: () => void }
  | {
      readonly type: "probe.settled"
      readonly key: ServerConnection.Key
      readonly attempt: number
      readonly result: ServerProbeResult
    }
  | { readonly type: "disposed" }

export type ServerHealthEffect =
  | {
      readonly type: "probe"
      readonly key: ServerConnection.Key
      readonly attempt: number
      readonly http: ServerConnection.HttpBase
    }
  | { readonly type: "notify.probe"; readonly probe: ServerProbe }
  | { readonly type: "timer.start"; readonly intervalMs: number }
  | { readonly type: "timer.stop" }
  | { readonly type: "waiters.resolve"; readonly resolvers: readonly (() => void)[] }

export type ServerHealthTransition = {
  readonly state: ServerHealthState
  readonly effects: readonly ServerHealthEffect[]
}

export function createServerHealthState(): ServerHealthState {
  return { entries: new Map(), waiters: [] }
}

export function transitionServerHealth(state: ServerHealthState, event: ServerHealthEvent): ServerHealthTransition {
  if (event.type === "servers.synced") return synced(state, event.servers)

  if (event.type === "poll.due") return polled(state)

  if (event.type === "retry.requested") return retried(state, event.resolve)

  if (event.type === "probe.settled") return answered(state, event)

  // Disposed: stop polling and release every `retry` caller.
  if (!state.entries.size && !state.waiters.length) return { state, effects: [] }

  return {
    state: createServerHealthState(),
    effects: [
      ...(polling(state) ? [{ type: "timer.stop" as const }] : []),
      ...resolved(state.waiters.map((waiter) => waiter.resolve)),
    ],
  }
}

/** Every listed server's health, keyed by server. */
export function selectServerHealthRecord(state: ServerHealthState) {
  return Object.fromEntries([...state.entries].map(([key, slot]) => [key, selectServerHealth(slot)]))
}

// Builds a new object on every call: the driver hands it to a store, which adopts and later changes it.
export function selectServerHealth(slot: ServerHealthSlot): ServerHealth {
  if (slot.type === "staged") return slot.stage === "failed" ? { type: "unreachable" } : { type: slot.stage }

  if (slot.type === "checking") return { type: "checking", managed: slot.endpoint.managed }

  return { ...slot.result }
}

export function isServerHealthy(health: ServerHealth | undefined) {
  return health?.type === "healthy"
}

/** The server can be used: it answered, or nothing says it cannot (not checked yet, or a check is in flight). */
export function canUseServer(health: ServerHealth | undefined) {
  return health === undefined || health.type === "healthy" || health.type === "checking"
}

/** The server's last answer, or its plugin, says it cannot be used. A check in flight is not a failure. */
export function isServerFailed(health: ServerHealth | undefined) {
  return health?.type === "unreachable" || health?.type === "unauthorized" || health?.type === "incompatible"
}

export function isServerUnauthorized(health: ServerHealth | undefined) {
  return health?.type === "unauthorized"
}

export function isServerIncompatible(health: ServerHealth | undefined) {
  return health?.type === "incompatible"
}

export function selectServerVersion(health: ServerHealth | undefined) {
  return health?.type === "healthy" ? health.version : undefined
}

export function selectServerHostname(health: ServerHealth | undefined) {
  return health?.type === "healthy" ? health.hostname : undefined
}

/** Sort rank: healthy first, then servers still settling, then failed ones. */
export function selectServerHealthRank(health: ServerHealth | undefined) {
  if (health?.type === "healthy") return 0

  if (isServerFailed(health)) return 2

  return 1
}

/** The status mark a server row shows. */
export function selectServerIndicator(health: ServerHealth | undefined) {
  if (health === undefined || health.type === "stopped") return "unknown"

  if (health.type === "auth" || health.type === "unauthorized") return "auth"

  if (health.type === "starting") return "connecting"

  if (health.type === "checking") return health.managed ? "connecting" : "unknown"

  return health.type
}

export type ServerIndicator = ReturnType<typeof selectServerIndicator>

function synced(state: ServerHealthState, servers: readonly ServerHealthInput[]): ServerHealthTransition {
  const steps = servers.map((input) => {
    const slot = state.entries.get(input.key)

    return { key: input.key, slot, next: listed(slot, input) }
  })

  const entries =
    steps.length === state.entries.size && steps.every((step) => step.next === step.slot)
      ? state.entries
      : new Map(steps.map((step) => [step.key, step.next]))

  return settle(
    state,
    entries,
    steps.flatMap((step) =>
      step.next.type === "checking" && step.next.attempt !== step.slot?.attempt ? [probe(step.key, step.next)] : [],
    ),
  )
}

function listed(slot: ServerHealthSlot | undefined, input: ServerHealthInput): ServerHealthSlot {
  if (input.type === "staged") {
    if (slot?.type === "staged" && slot.stage === input.stage) return slot

    // The probe in flight, if any, keeps its attempt and so can never land.
    return { type: "staged", stage: input.stage, attempt: slot?.attempt ?? 0 }
  }

  const auth = endpointCredentials(input.http)

  // Another endpoint is another target: its previous answer says nothing about the new one.
  if (!slot || slot.type === "staged" || slot.endpoint.auth !== auth)
    return {
      type: "checking",
      endpoint: { http: input.http, auth, managed: input.managed },
      attempt: (slot?.attempt ?? 0) + 1,
    }

  if (slot.endpoint.managed === input.managed) return slot

  return { ...slot, endpoint: { ...slot.endpoint, managed: input.managed } }
}

// A probe still in flight keeps running: a server slower than the poll interval still gets its answer.
function polled(state: ServerHealthState): ServerHealthTransition {
  const due = [...state.entries].flatMap(([key, slot]) =>
    slot.type === "settled" ? [{ key, next: { ...slot, type: "refreshing" as const, attempt: slot.attempt + 1 } }] : [],
  )

  if (!due.length) return { state, effects: [] }

  const entries = new Map(state.entries)
  due.forEach((item) => entries.set(item.key, item.next))

  return { state: { entries, waiters: state.waiters }, effects: due.map((item) => probe(item.key, item.next)) }
}

// A retry replaces any probe in flight, so one that hangs cannot hold the caller.
function retried(state: ServerHealthState, resolve: () => void): ServerHealthTransition {
  const restarted = [...state.entries].flatMap(([key, slot]) => {
    if (slot.type === "staged") return []

    const next: ServerHealthSlot =
      slot.type === "checking"
        ? { ...slot, attempt: slot.attempt + 1 }
        : { ...slot, type: "refreshing", attempt: slot.attempt + 1 }

    return [{ key, next }]
  })

  if (!restarted.length) return { state, effects: resolved([resolve]) }

  const entries = new Map(state.entries)
  restarted.forEach((item) => entries.set(item.key, item.next))

  return {
    state: {
      entries,
      waiters: [
        ...state.waiters,
        { resolve, targets: new Map(restarted.map((item) => [item.key, item.next.attempt])) },
      ],
    },
    effects: [
      ...restarted.map((item) => probe(item.key, item.next)),
      { type: "timer.start", intervalMs: SERVER_HEALTH_POLL_MS },
    ],
  }
}

function answered(
  state: ServerHealthState,
  event: Extract<ServerHealthEvent, { type: "probe.settled" }>,
): ServerHealthTransition {
  const slot = state.entries.get(event.key)

  // A superseded, unlisted or disposed probe changes nothing and reaches no listener.
  if (!slot || (slot.type !== "checking" && slot.type !== "refreshing") || slot.attempt !== event.attempt)
    return { state, effects: [] }

  return settle(
    state,
    new Map(state.entries).set(event.key, {
      type: "settled",
      endpoint: slot.endpoint,
      result: event.result,
      attempt: slot.attempt,
    }),
    [{ type: "notify.probe", probe: { key: event.key, auth: slot.endpoint.auth, result: event.result } }],
  )
}

/** Applies new entries: starts or stops the poll and resolves the `retry` callers whose probes all answered. */
function settle(
  state: ServerHealthState,
  entries: ServerHealthState["entries"],
  effects: readonly ServerHealthEffect[],
): ServerHealthTransition {
  if (entries === state.entries) return { state, effects }

  const remaining = state.waiters.map((waiter) => {
    const targets = [...waiter.targets].filter(([key, attempt]) => !answeredSince(entries.get(key), attempt))

    return targets.length === waiter.targets.size ? waiter : { resolve: waiter.resolve, targets: new Map(targets) }
  })

  const next = { entries, waiters: remaining.filter((waiter) => waiter.targets.size > 0) }

  return {
    state: next,
    effects: [
      ...effects,
      ...(!polling(state) && polling(next)
        ? [{ type: "timer.start" as const, intervalMs: SERVER_HEALTH_POLL_MS }]
        : []),
      ...(polling(state) && !polling(next) ? [{ type: "timer.stop" as const }] : []),
      ...resolved(remaining.flatMap((waiter) => (waiter.targets.size ? [] : [waiter.resolve]))),
    ],
  }
}

// A server that left the list or has no endpoint has nothing left to answer.
function answeredSince(slot: ServerHealthSlot | undefined, attempt: number) {
  return !slot || slot.type === "staged" || (slot.type === "settled" && slot.attempt >= attempt)
}

function polling(state: ServerHealthState) {
  return [...state.entries.values()].some((slot) => slot.type !== "staged")
}

function probe(key: ServerConnection.Key, slot: { readonly endpoint: Endpoint; readonly attempt: number }) {
  return { type: "probe" as const, key, attempt: slot.attempt, http: slot.endpoint.http }
}

function resolved(resolvers: readonly (() => void)[]): ServerHealthEffect[] {
  return resolvers.length ? [{ type: "waiters.resolve", resolvers }] : []
}
