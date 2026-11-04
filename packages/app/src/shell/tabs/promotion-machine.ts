import type { ServerConnection } from "@/runtime/server/registry"
import type { ComposerState } from "@/composer/state"
import type { DraftTab, PendingSession, SessionTab } from "./tabs"

export type ComposerTarget = ReturnType<ComposerState["capture"]>

type PromotionBase = {
  readonly attempt: number
  readonly session: SessionTab
  readonly pending: PendingSession
}

// A draft tab replaced by its pending session tab. `complete` and `rollback` each claim the entry before awaiting, so
// only one of them settles it.
export type PromotionEntry =
  | (PromotionBase & { readonly phase: "preparing" })
  | (PromotionBase & { readonly phase: "completing"; readonly target: ComposerTarget })
  | (PromotionBase & { readonly phase: "rolling-back"; readonly worktree: string | undefined })

export type TabPromotionState =
  | {
      readonly status: "active"
      readonly attempt: number
      readonly entries: Readonly<Record<string, PromotionEntry>>
    }
  | { readonly status: "disposed" }

export type TabPromotionEvent =
  | { readonly type: "prepare"; readonly key: string; readonly session: SessionTab; readonly pending: PendingSession }
  | { readonly type: "complete.start"; readonly key: string; readonly attempt: number; readonly target: ComposerTarget }
  | { readonly type: "complete.settled"; readonly key: string; readonly attempt: number }
  | { readonly type: "rollback.start"; readonly key: string; readonly attempt: number; readonly worktree?: string }
  // `open` says whether the pending session tab is in the tab strip when the rollback commits.
  | { readonly type: "rollback.settled"; readonly key: string; readonly attempt: number; readonly open: boolean }
  // The session's tab was removed for good (archived, deleted, unavailable), not closed by the user.
  | { readonly type: "abandon"; readonly keys: readonly string[] }
  | { readonly type: "abandon.server"; readonly server: ServerConnection.Key }
  | { readonly type: "keep.servers"; readonly servers: ReadonlySet<string> }
  | { readonly type: "dispose" }

export type TabPromotionEffect =
  | { readonly type: "composer.transfer"; readonly composer: ComposerState; readonly target: ComposerTarget }
  | { readonly type: "composer.recover"; readonly draft: DraftTab; readonly composer: ComposerState }
  | { readonly type: "tab.restore"; readonly key: string; readonly session: SessionTab; readonly draft: DraftTab }
  | { readonly type: "session.cleanup"; readonly key: string; readonly session: SessionTab }
  | { readonly type: "draft.dispose"; readonly draft: DraftTab }

export type TabPromotionTransition = {
  readonly state: TabPromotionState
  readonly effects: readonly TabPromotionEffect[]
}

const EMPTY_ENTRIES: Readonly<Record<string, PromotionEntry>> = Object.freeze({})

export const INITIAL_TAB_PROMOTION_STATE: TabPromotionState = Object.freeze({
  status: "active",
  attempt: 0,
  entries: EMPTY_ENTRIES,
})

const DISPOSED_TAB_PROMOTION_STATE: TabPromotionState = Object.freeze({ status: "disposed" })

export function transitionTabPromotion(state: TabPromotionState, event: TabPromotionEvent): TabPromotionTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "dispose") return { state: DISPOSED_TAB_PROMOTION_STATE, effects: [] }

  if (event.type === "prepare") {
    const previous = state.entries[event.key]
    const attempt = state.attempt + 1

    return {
      state: {
        status: "active",
        attempt,
        entries: {
          ...state.entries,
          [event.key]: { phase: "preparing", attempt, session: event.session, pending: event.pending },
        },
      },
      effects: previous ? [{ type: "draft.dispose", draft: previous.pending.draft }] : [],
    }
  }

  if (event.type === "abandon") return abandon(state, (key) => event.keys.includes(key))

  if (event.type === "abandon.server") return abandon(state, (_, entry) => entry.session.server === event.server)

  if (event.type === "keep.servers") return abandon(state, (_, entry) => !event.servers.has(entry.session.server))

  const entry = state.entries[event.key]

  if (!entry || entry.attempt !== event.attempt) return unchanged(state)

  if (event.type === "complete.start") {
    if (entry.phase !== "preparing") return unchanged(state)

    return { state: replace(state, event.key, { ...entry, phase: "completing", target: event.target }), effects: [] }
  }

  if (event.type === "rollback.start") {
    if (entry.phase !== "preparing") return unchanged(state)

    return {
      state: replace(state, event.key, { ...entry, phase: "rolling-back", worktree: event.worktree }),
      effects: [],
    }
  }

  if (event.type === "complete.settled") {
    if (entry.phase !== "completing") return unchanged(state)

    return {
      state: remove(state, [event.key]),
      effects: [
        { type: "composer.transfer", composer: entry.pending.composer, target: entry.target },
        { type: "draft.dispose", draft: entry.pending.draft },
      ],
    }
  }

  if (entry.phase !== "rolling-back") return unchanged(state)
  const cleanup = { type: "session.cleanup", key: event.key, session: entry.session } as const

  // A pending tab the user closed is gone with its draft; a visible one turns back into the draft.
  if (!event.open) return { state: remove(state, [event.key]), effects: [cleanup, draftDispose(entry)] }
  const draft = entry.pending.draft

  return {
    state: remove(state, [event.key]),
    effects: [
      { type: "composer.recover", draft, composer: entry.pending.composer },
      {
        type: "tab.restore",
        key: event.key,
        session: entry.session,
        draft: entry.worktree === undefined ? draft : { ...draft, worktree: entry.worktree, branch: undefined },
      },
      cleanup,
    ],
  }
}

// These events remove pending sessions from view, so they commit in the same transition as the tab strip and route.
export type TabPromotionCommit = Extract<
  TabPromotionEvent,
  { type: "complete.settled" | "rollback.settled" | "abandon" }
>

/** Disposing tab memory or a persisted draft waits until the transition that removes its screen commits. */
export function runsAfterCommit(effect: TabPromotionEffect) {
  return effect.type === "session.cleanup" || effect.type === "draft.dispose"
}

/** The pending session shown in place of a promoted draft until its promotion settles. */
export function pendingPromotion(state: TabPromotionState, key: string) {
  return state.status === "active" ? state.entries[key]?.pending : undefined
}

function abandon(
  state: Extract<TabPromotionState, { status: "active" }>,
  match: (key: string, entry: PromotionEntry) => boolean,
): TabPromotionTransition {
  const keys = Object.keys(state.entries).filter((key) => match(key, state.entries[key]!))

  if (keys.length === 0) return unchanged(state)

  return {
    state: remove(state, keys),
    effects: keys.flatMap((key) => {
      const entry = state.entries[key]!

      return [{ type: "session.cleanup" as const, key, session: entry.session }, draftDispose(entry)]
    }),
  }
}

function draftDispose(entry: PromotionEntry) {
  return { type: "draft.dispose", draft: entry.pending.draft } as const
}

function replace(state: Extract<TabPromotionState, { status: "active" }>, key: string, entry: PromotionEntry) {
  return { ...state, entries: { ...state.entries, [key]: entry } }
}

function remove(state: Extract<TabPromotionState, { status: "active" }>, keys: readonly string[]): TabPromotionState {
  const entries = Object.fromEntries(Object.entries(state.entries).filter(([key]) => !keys.includes(key)))

  return { ...state, entries: Object.keys(entries).length === 0 ? EMPTY_ENTRIES : entries }
}

function unchanged(state: TabPromotionState): TabPromotionTransition {
  return { state, effects: [] }
}
