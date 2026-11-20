import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { TAB_GROUP_COLORS, type TabGroupColor } from "@/shell/titlebar/tab-groups"
import { ServerKey } from "./schema"

/**
 * Pinned sessions and the groups that hold them. Groups only exist among pins (Arc's folders): grouping a session pins
 * it, and unpinning a session takes it out of its group. Every operation returns the same state when nothing changes.
 */

const SessionRef = Persistence.struct({ server: ServerKey, sessionId: Schema.String })

const PinnedSession = Persistence.struct({
  type: Schema.Literal("session"),
  server: ServerKey,
  sessionId: Schema.String,
})

const PinnedGroup = Persistence.struct({
  type: Schema.Literal("group"),
  id: Schema.String,
  name: Schema.String,
  color: Schema.Literals(TAB_GROUP_COLORS),
  sessions: Persistence.array(SessionRef),
})

export const PinsStateSchema = Persistence.struct({
  items: Persistence.array(Schema.Union([PinnedSession, PinnedGroup])),
  collapsed: Persistence.record(Schema.Boolean),
})

export type PinsState = typeof PinsStateSchema.Type

export type PinRef = typeof SessionRef.Type

export type PinItem = PinsState["items"][number]

export type PinGroup = Extract<PinItem, { type: "group" }>

export const EMPTY_PINS: PinsState = { items: [], collapsed: {} }

export const pinKey = (ref: PinRef) => `${ref.server}\0${ref.sessionId}`

const same = (a: PinRef, b: PinRef) => a.server === b.server && a.sessionId === b.sessionId

/** The group holding a pinned session, or undefined for a session pinned on its own (or not pinned). */
export function groupOf(state: PinsState, ref: PinRef) {
  return state.items.find(
    (item): item is PinGroup => item.type === "group" && item.sessions.some((session) => same(session, ref)),
  )
}

export function isPinned(state: PinsState, ref: PinRef) {
  return state.items.some((item) =>
    item.type === "session" ? same(item, ref) : item.sessions.some((session) => same(session, ref)),
  )
}

/** Every pinned session in display order, groups included. */
export function pinnedRefs(state: PinsState): PinRef[] {
  return state.items.flatMap((item) =>
    item.type === "session" ? [{ server: item.server, sessionId: item.sessionId }] : item.sessions,
  )
}

export function pin(state: PinsState, ref: PinRef): PinsState {
  if (isPinned(state, ref)) return state

  return { ...state, items: [...state.items, { type: "session", server: ref.server, sessionId: ref.sessionId }] }
}

/** Unpins a session wherever it is. A group left empty goes away. */
export function unpin(state: PinsState, ref: PinRef): PinsState {
  if (!isPinned(state, ref)) return state

  return withItems(
    state,
    state.items.flatMap((item): PinItem[] => {
      if (item.type === "session") return same(item, ref) ? [] : [item]
      const sessions = item.sessions.filter((session) => !same(session, ref))

      return sessions.length ? [{ ...item, sessions }] : []
    }),
  )
}

/** Starts a group with one session, where that session was pinned, or at the end if it was not pinned. */
export function createGroup(
  state: PinsState,
  ref: PinRef,
  group: { id: string; name: string; color: TabGroupColor },
): PinsState {
  const created: PinGroup = { type: "group", ...group, sessions: [{ server: ref.server, sessionId: ref.sessionId }] }
  const index = state.items.findIndex((item) => item.type === "session" && same(item, ref))

  if (index !== -1) return withItems(state, state.items.toSpliced(index, 1, created))
  const rest = unpin(state, ref)

  return withItems(rest, [...rest.items, created])
}

/** Moves a session into a group, pinning it first if needed. */
export function moveToGroup(state: PinsState, ref: PinRef, groupId: string): PinsState {
  const target = state.items.find((item) => item.type === "group" && item.id === groupId)

  if (!target || groupOf(state, ref)?.id === groupId) return state
  const rest = unpin(state, ref)

  return withItems(
    rest,
    rest.items.map((item) =>
      item.type === "group" && item.id === groupId
        ? { ...item, sessions: [...item.sessions, { server: ref.server, sessionId: ref.sessionId }] }
        : item,
    ),
  )
}

/** Takes a session out of its group and keeps it pinned, right after the group. */
export function removeFromGroup(state: PinsState, ref: PinRef): PinsState {
  const group = groupOf(state, ref)

  if (!group) return state
  const sessions = group.sessions.filter((session) => !same(session, ref))
  const index = state.items.indexOf(group)
  const loose: PinItem = { type: "session", server: ref.server, sessionId: ref.sessionId }

  return withItems(
    state,
    state.items.toSpliced(index, 1, ...(sessions.length ? [{ ...group, sessions }, loose] : [loose])),
  )
}

/** Dissolves a group; its sessions stay pinned where the group was. */
export function ungroup(state: PinsState, groupId: string): PinsState {
  const index = state.items.findIndex((item) => item.type === "group" && item.id === groupId)
  const group = state.items[index]

  if (!group || group.type !== "group") return state

  return withItems(
    state,
    state.items.toSpliced(index, 1, ...group.sessions.map((session): PinItem => ({ type: "session", ...session }))),
  )
}

/** Removes a group and unpins everything in it. */
export function unpinGroup(state: PinsState, groupId: string): PinsState {
  if (!state.items.some((item) => item.type === "group" && item.id === groupId)) return state

  return withItems(
    state,
    state.items.filter((item) => item.type !== "group" || item.id !== groupId),
  )
}

export function updateGroup(
  state: PinsState,
  groupId: string,
  patch: Partial<Pick<PinGroup, "name" | "color">>,
): PinsState {
  return withItems(
    state,
    state.items.map((item) => (item.type === "group" && item.id === groupId ? { ...item, ...patch } : item)),
  )
}

/**
 * Expands one group and collapses the rest (accordion), or collapses it when it was open. The group holding the
 * current session is shown expanded by the view regardless, so leaving it lets it fold away again.
 */
export function toggleGroup(state: PinsState, groupId: string): PinsState {
  const open = !state.collapsed[groupId]

  const collapsed = Object.fromEntries(
    state.items.flatMap((item) => (item.type === "group" ? [[item.id, open || item.id !== groupId]] : [])),
  )

  return { ...state, collapsed }
}

/**
 * Where a dragged session lands: among the top-level pins, or inside a group. `index` counts the target list as it is
 * once the session has left its old place, so dropping a session back where it was changes nothing.
 */
export type PinTarget = { index: number; group?: string }

/** Pins a session at a target, or moves it there if it was pinned. A group the move empties goes away. */
export function place(state: PinsState, ref: PinRef, target: PinTarget): PinsState {
  const loose: PinRef = { server: ref.server, sessionId: ref.sessionId }

  if (target.group && !state.items.some((item) => item.type === "group" && item.id === target.group)) return state
  const rest = unpin(state, ref)

  // Moving a group's only session back into it would remove the group first; the group stays as it was.
  if (target.group && !rest.items.some((item) => item.type === "group" && item.id === target.group)) return state

  if (!target.group) {
    const index = Math.max(0, Math.min(target.index, rest.items.length))

    return withItems(rest, rest.items.toSpliced(index, 0, { type: "session", ...loose }))
  }

  return withItems(
    rest,
    rest.items.map((item) => {
      if (item.type !== "group" || item.id !== target.group) return item
      const index = Math.max(0, Math.min(target.index, item.sessions.length))

      return { ...item, sessions: item.sessions.toSpliced(index, 0, loose) }
    }),
  )
}

/** Moves a group among the top-level pins; `index` counts them without the group. */
export function moveGroup(state: PinsState, groupId: string, index: number): PinsState {
  const from = state.items.findIndex((item) => item.type === "group" && item.id === groupId)

  if (from === -1) return state
  const rest = state.items.toSpliced(from, 1)
  const to = Math.max(0, Math.min(index, rest.length))

  if (to === from) return state

  return withItems(state, rest.toSpliced(to, 0, state.items[from]))
}

/** Drops pins whose sessions are gone. */
export function prunePins(state: PinsState, missing: (ref: PinRef) => boolean): PinsState {
  const gone = pinnedRefs(state).filter(missing)

  return gone.reduce(unpin, state)
}

function withItems(state: PinsState, items: PinItem[]): PinsState {
  const ids = new Set(items.flatMap((item) => (item.type === "group" ? [item.id] : [])))
  const collapsed = Object.fromEntries(Object.entries(state.collapsed).filter(([id]) => ids.has(id)))

  return { items, collapsed }
}
