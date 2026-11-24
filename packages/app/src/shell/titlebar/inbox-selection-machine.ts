export type InboxSelectionState =
  | { readonly status: "idle" }
  | {
      readonly status: "selecting"
      readonly keys: ReadonlySet<string>
      readonly anchor: string
    }

export type InboxSelectionEvent =
  | { readonly type: "toggle"; readonly key: string }
  | {
      readonly type: "range"
      readonly target: string
      readonly ordered: readonly string[]
      readonly fallbackAnchor?: string
      readonly additive?: boolean
    }
  | { readonly type: "select.all"; readonly ordered: readonly string[] }
  | { readonly type: "section.toggle"; readonly keys: readonly string[] }
  | { readonly type: "sync.visible"; readonly visible: ReadonlySet<string> }
  | { readonly type: "clear" }

export const INITIAL_INBOX_SELECTION_STATE: InboxSelectionState = Object.freeze({ status: "idle" })

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>()

export function transitionInboxSelection(
  state: InboxSelectionState,
  event: InboxSelectionEvent,
): InboxSelectionState {
  if (event.type === "clear") return state.status === "idle" ? state : INITIAL_INBOX_SELECTION_STATE

  if (event.type === "toggle") return toggle(state, event.key)

  if (event.type === "range") return range(state, event)

  if (event.type === "select.all") return selectAll(state, event.ordered)

  if (event.type === "section.toggle") return toggleSection(state, event.keys)

  return syncVisible(state, event.visible)
}

export function selectInboxSelecting(state: InboxSelectionState) {
  return state.status === "selecting"
}

export function selectInboxSelectedCount(state: InboxSelectionState) {
  return state.status === "selecting" ? state.keys.size : 0
}

export function selectInboxIsSelected(state: InboxSelectionState, key: string) {
  return state.status === "selecting" && state.keys.has(key)
}

export function selectInboxSelectedKeys(state: InboxSelectionState): ReadonlySet<string> {
  return state.status === "selecting" ? state.keys : EMPTY_KEYS
}

export function selectInboxAllSelected(state: InboxSelectionState, keys: readonly string[]) {
  if (state.status !== "selecting" || keys.length === 0) return false

  return keys.every((key) => state.keys.has(key))
}

function toggle(state: InboxSelectionState, key: string): InboxSelectionState {
  if (state.status === "idle") {
    return { status: "selecting", keys: new Set([key]), anchor: key }
  }

  if (state.keys.has(key)) {
    const next = new Set([...state.keys].filter((item) => item !== key))

    if (next.size === 0) return INITIAL_INBOX_SELECTION_STATE

    const anchor = next.has(state.anchor) ? state.anchor : firstKey(next)

    return { status: "selecting", keys: next, anchor }
  }

  const next = new Set(state.keys)
  next.add(key)

  return { status: "selecting", keys: next, anchor: key }
}

function range(
  state: InboxSelectionState,
  event: Extract<InboxSelectionEvent, { type: "range" }>,
): InboxSelectionState {
  const targetIndex = event.ordered.indexOf(event.target)

  if (targetIndex === -1) return state

  const anchor = resolveAnchor(state, event.ordered, event.fallbackAnchor, event.target)
  const anchorIndex = event.ordered.indexOf(anchor)
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  const slice = event.ordered.slice(start, end + 1)

  const next =
    event.additive && state.status === "selecting" ? new Set([...state.keys, ...slice]) : new Set(slice)

  if (state.status === "selecting" && state.anchor === anchor && sameSet(state.keys, next)) return state

  return { status: "selecting", keys: next, anchor }
}

function selectAll(state: InboxSelectionState, ordered: readonly string[]): InboxSelectionState {
  if (ordered.length === 0) return state.status === "idle" ? state : INITIAL_INBOX_SELECTION_STATE

  const next = new Set(ordered)
  const anchor = state.status === "selecting" && next.has(state.anchor) ? state.anchor : ordered[0]

  if (state.status === "selecting" && state.anchor === anchor && sameSet(state.keys, next)) return state

  return { status: "selecting", keys: next, anchor }
}

function toggleSection(state: InboxSelectionState, keys: readonly string[]): InboxSelectionState {
  if (keys.length === 0) return state

  if (state.status === "selecting" && keys.every((key) => state.keys.has(key))) {
    const drop = new Set(keys)
    const next = new Set([...state.keys].filter((key) => !drop.has(key)))

    if (next.size === 0) return INITIAL_INBOX_SELECTION_STATE

    const anchor = next.has(state.anchor) ? state.anchor : firstKey(next)

    return { status: "selecting", keys: next, anchor }
  }

  const next = new Set([...(state.status === "selecting" ? state.keys : []), ...keys])
  const anchor = state.status === "selecting" && next.has(state.anchor) ? state.anchor : keys[0]

  return { status: "selecting", keys: next, anchor }
}

function syncVisible(state: InboxSelectionState, visible: ReadonlySet<string>): InboxSelectionState {
  if (state.status === "idle") return state

  const kept = [...state.keys].filter((key) => visible.has(key))

  if (kept.length === state.keys.size) return state

  if (kept.length === 0) return INITIAL_INBOX_SELECTION_STATE

  const next = new Set(kept)
  const anchor = next.has(state.anchor) ? state.anchor : kept[0]

  return { status: "selecting", keys: next, anchor }
}

function resolveAnchor(
  state: InboxSelectionState,
  ordered: readonly string[],
  fallbackAnchor: string | undefined,
  target: string,
) {
  if (state.status === "selecting" && ordered.includes(state.anchor)) return state.anchor

  if (fallbackAnchor && ordered.includes(fallbackAnchor)) return fallbackAnchor

  return target
}

function firstKey(keys: ReadonlySet<string>) {
  return keys.values().next().value ?? ""
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false

  return [...a].every((key) => b.has(key))
}
