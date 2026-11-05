import type { BridgeMenubarItem, BridgeMessage } from "@opencode/plugin/gui/host"

/** One `bridge.on` call, so registering the same callback twice removes independently. */
export type PluginBridgeSubscription = { readonly listener: (message: BridgeMessage) => void }

type Subscriptions = ReadonlySet<PluginBridgeSubscription>

// The renderer listens to main's plugin events while any subscriber is registered. MenubarItem contributions change
// through events, so each attachment asks main once for the current items. `attempt` is the last ask; only the
// `seeding` one is current. A failed ask is retried when the next subscriber registers.
export type PluginBridgeState =
  | { readonly status: "detached"; readonly attempt: number }
  | { readonly status: "seeding"; readonly attempt: number; readonly subscriptions: Subscriptions }
  | { readonly status: "unseeded"; readonly attempt: number; readonly subscriptions: Subscriptions }
  | {
      readonly status: "synced"
      readonly attempt: number
      readonly subscriptions: Subscriptions
      readonly items: readonly BridgeMenubarItem[]
    }
  | { readonly status: "disposed" }

export type PluginBridgeEvent =
  | { readonly type: "listener.added"; readonly subscription: PluginBridgeSubscription }
  | { readonly type: "listener.removed"; readonly subscription: PluginBridgeSubscription }
  | { readonly type: "menubar.changed"; readonly items: readonly BridgeMenubarItem[] }
  | { readonly type: "menubar.seeded"; readonly attempt: number; readonly items: readonly BridgeMenubarItem[] }
  | { readonly type: "menubar.seed-failed"; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "disposed" }

export type PluginBridgeEffect =
  | { readonly type: "attach" }
  | { readonly type: "detach" }
  | { readonly type: "seed-menubar"; readonly attempt: number }
  | { readonly type: "notify"; readonly subscriptions: Subscriptions; readonly items: readonly BridgeMenubarItem[] }
  | { readonly type: "log-seed-error"; readonly cause: unknown }

export type PluginBridgeTransition = {
  readonly state: PluginBridgeState
  readonly effects: readonly PluginBridgeEffect[]
}

export function createPluginBridgeState(): PluginBridgeState {
  return { status: "detached", attempt: 0 }
}

export function transitionPluginBridge(state: PluginBridgeState, event: PluginBridgeEvent): PluginBridgeTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") {
    return { state: { status: "disposed" }, effects: state.status === "detached" ? [] : [{ type: "detach" }] }
  }

  if (state.status === "detached") {
    if (event.type !== "listener.added") return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "seeding", attempt, subscriptions: new Set([event.subscription]) },
      effects: [{ type: "attach" }, { type: "seed-menubar", attempt }],
    }
  }

  if (event.type === "listener.added") {
    if (state.subscriptions.has(event.subscription)) return unchanged(state)
    const subscriptions = new Set(state.subscriptions).add(event.subscription)

    if (state.status === "seeding") return { state: { ...state, subscriptions }, effects: [] }

    // A late subscriber gets the items the others already have.
    if (state.status === "synced") {
      return {
        state: { ...state, subscriptions },
        effects: [{ type: "notify", subscriptions: new Set([event.subscription]), items: state.items }],
      }
    }

    const attempt = state.attempt + 1

    return { state: { status: "seeding", attempt, subscriptions }, effects: [{ type: "seed-menubar", attempt }] }
  }

  if (event.type === "listener.removed") {
    if (!state.subscriptions.has(event.subscription)) return unchanged(state)
    const subscriptions = new Set(state.subscriptions)
    subscriptions.delete(event.subscription)

    if (subscriptions.size === 0) {
      return { state: { status: "detached", attempt: state.attempt }, effects: [{ type: "detach" }] }
    }

    return { state: { ...state, subscriptions }, effects: [] }
  }

  // Main's push is newer than any ask still on its way.
  if (event.type === "menubar.changed") return synced(state, event.items)

  if (state.status !== "seeding" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "menubar.seed-failed") {
    return {
      state: { status: "unseeded", attempt: state.attempt, subscriptions: state.subscriptions },
      effects: [{ type: "log-seed-error", cause: event.cause }],
    }
  }

  return synced(state, event.items)
}

/** Who hears main's other plugin events, which pass straight through. */
export function selectPluginSubscriptions(state: PluginBridgeState): Subscriptions {
  return state.status === "detached" || state.status === "disposed" ? NO_SUBSCRIPTIONS : state.subscriptions
}

const NO_SUBSCRIPTIONS: Subscriptions = new Set()

function synced(
  state: Extract<PluginBridgeState, { subscriptions: Subscriptions }>,
  items: readonly BridgeMenubarItem[],
): PluginBridgeTransition {
  return {
    state: { status: "synced", attempt: state.attempt, subscriptions: state.subscriptions, items },
    effects: [{ type: "notify", subscriptions: state.subscriptions, items }],
  }
}

function unchanged(state: PluginBridgeState): PluginBridgeTransition {
  return { state, effects: [] }
}
