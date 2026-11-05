// The browser's address field. At rest it shows the page's URL; editing shows the user's text and suggestions; a
// submitted address stays in the field until the page reports where it went. The page's reports are counted by
// `nextAddressEpoch`, and a submit keeps the counts it saw, so the next URL change, finished load or rejection ends
// the hold, even one that repeats a value, while focusing and leaving the field in between keeps it.
import type { Browser } from "@opencode/plugin-browser/rpc"
import { resolveAddress, searches } from "./address"
import { completes, suggest, type Visit } from "./history"

/** Suggestions the address field lists, and pages the new tab page lists. */
export const ADDRESS_SUGGESTIONS = 5

/** Long text scrolls the input, which the inline hint cannot follow, so only a query this short shows it. */
export const ADDRESS_HINT_MAX_LENGTH = 48

/** What the page reports, read on every change. */
export type AddressPage = {
  readonly tabID: Browser.TabID | undefined
  /** The page's URL; empty for a blank page or no tab. */
  readonly url: string
  readonly loading: boolean
  readonly generation: number
  readonly error: string | undefined
}

/** The page's reports, counted: each count moves on every report, even one that repeats a value. */
export type AddressEpoch = AddressPage & {
  /** Finished loads. */
  readonly settled: number
  /** Tab switches, URL changes and finished loads. */
  readonly followed: number
  /** Rejections: a blocked or rejected request leaves the page where it was. */
  readonly rejected: number
  /** Any reported movement, including a rejection. A command clearing the last error is not one. */
  readonly moved: number
}

/** A submitted address, and the counts when it was submitted. */
export type SubmittedHold = {
  readonly text: string
  readonly followed: number
  readonly rejected: number
  readonly moved: number
}

export type AddressState =
  | { readonly status: "rest" }
  | {
      readonly status: "editing"
      readonly text: string
      /** The user typed since focusing; suggestions follow typing, not a focused URL. */
      readonly typed: boolean
      /** The suggestion Enter opens; -1 opens the typed text. */
      readonly active: number
      /** Escape closed the suggestions; typing opens them again. */
      readonly dismissed: boolean
      /** A submitted address that had not been reported yet when the user focused; leaving the field keeps it. */
      readonly hold: SubmittedHold | undefined
    }
  | { readonly status: "submitted"; readonly hold: SubmittedHold }

export type AddressEvent =
  | { readonly type: "focused"; readonly epoch: AddressEpoch }
  | { readonly type: "blurred"; readonly epoch: AddressEpoch }
  | {
      readonly type: "input.changed"
      readonly value: string
      readonly deleting: boolean
      readonly visits: readonly Visit[]
    }
  | { readonly type: "key.pressed"; readonly key: "ArrowDown" | "ArrowUp" | "Escape"; readonly visits: readonly Visit[] }
  /** Enter in the field; `failed` is whether the page failed to load, where an empty address opens a blank page. */
  | {
      readonly type: "submitted"
      readonly epoch: AddressEpoch
      readonly visits: readonly Visit[]
      readonly failed: boolean
    }
  /** A click on a suggestion or a recent page. */
  | { readonly type: "navigated"; readonly url: string; readonly epoch: AddressEpoch }

export type AddressEffect =
  | { readonly type: "select-input" }
  | { readonly type: "blur-input" }
  | { readonly type: "prevent-default" }
  | { readonly type: "navigate"; readonly tabID: Browser.TabID; readonly url: string }

export type AddressTransition = { readonly state: AddressState; readonly effects: readonly AddressEffect[] }

export const initialAddressState: AddressState = { status: "rest" }

const SELECT: AddressEffect = { type: "select-input" }

const BLUR: AddressEffect = { type: "blur-input" }

const PREVENT: AddressEffect = { type: "prevent-default" }

export function transitionAddress(state: AddressState, event: AddressEvent): AddressTransition {
  switch (event.type) {
    case "focused": {
      if (state.status === "editing") return unchanged(state)
      const hold = state.status === "submitted" ? activeHold(state.hold, event.epoch) : undefined

      return {
        state: {
          status: "editing",
          text: hold ? hold.text : event.epoch.url,
          typed: false,
          active: -1,
          dismissed: false,
          hold,
        },
        effects: [SELECT],
      }
    }
    // Leaving the field without submitting cancels the edit; a submitted address not reported yet stays.
    case "blurred": {
      if (state.status !== "editing") return unchanged(state)
      const hold = activeHold(state.hold, event.epoch)

      return { state: hold ? { status: "submitted", hold } : initialAddressState, effects: [] }
    }
    case "input.changed": {
      if (state.status !== "editing") return unchanged(state)
      const first = suggest(event.visits, event.value, 1)[0]
      // Typing completes the first suggestion, as a search would; deleting never does.
      const complete = !!first && !event.deleting && (completes(first, event.value) || searches(event.value))

      return {
        state: { ...state, text: event.value, typed: true, dismissed: false, active: complete ? 0 : -1 },
        effects: [],
      }
    }
    case "key.pressed": {
      if (state.status !== "editing") return unchanged(state)
      const suggestions = addressSuggestions(state, event.visits)

      if (event.key === "Escape") {
        if (listed(state, suggestions)) return { state: { ...state, dismissed: true, active: -1 }, effects: [PREVENT] }

        return { state, effects: [PREVENT, BLUR] }
      }

      const count = suggestions.length

      if (!count) return unchanged(state)
      const by = event.key === "ArrowDown" ? 1 : -1

      return {
        state: {
          ...state,
          dismissed: false,
          active: state.active + by < -1 ? count - 1 : ((state.active + by + 1) % (count + 1)) - 1,
        },
        effects: [PREVENT],
      }
    }
    case "submitted": {
      const suggestions = addressSuggestions(state, event.visits)
      const picked = chosen(state, suggestions)

      if (picked) return navigate(state, picked.url, event.epoch)
      const text = field(state, event.epoch).trim()

      if (text || event.failed) return navigate(state, resolveAddress(text), event.epoch)

      return { state, effects: [BLUR] }
    }
    case "navigated":
      return navigate(state, event.url, event.epoch)
  }
}

/** Folds a page report into the counts. Returns `previous` when nothing changed. */
export function nextAddressEpoch(previous: AddressEpoch | undefined, page: AddressPage): AddressEpoch {
  if (!previous) return { ...page, settled: 0, followed: 0, rejected: 0, moved: 0 }

  const tab = page.tabID !== previous.tabID
  const settled = previous.loading && !page.loading ? previous.settled + 1 : previous.settled
  const rejected = page.error && page.error !== previous.error ? previous.rejected + 1 : previous.rejected

  const followed =
    tab || page.url !== previous.url || settled !== previous.settled ? previous.followed + 1 : previous.followed

  const moved =
    tab || page.generation !== previous.generation || page.loading !== previous.loading || rejected !== previous.rejected
      ? previous.moved + 1
      : previous.moved

  if (
    !tab &&
    followed === previous.followed &&
    moved === previous.moved &&
    page.url === previous.url &&
    page.error === previous.error
  )
    return previous

  return { ...page, settled, followed, rejected, moved }
}

/** Suggestions follow what the user typed; a focused address is not a query. */
export function addressSuggestions(state: AddressState, visits: readonly Visit[]): readonly Visit[] {
  return state.status === "editing" && state.typed ? suggest(visits, state.text, ADDRESS_SUGGESTIONS) : []
}

/** What the address field draws. */
export function addressView(state: AddressState, epoch: AddressEpoch, suggestions: readonly Visit[]) {
  const editing = state.status === "editing"
  const shown = listed(state, suggestions)
  const active = shown && state.status === "editing" ? state.active : -1
  const hold = state.status === "rest" ? undefined : state.hold

  return {
    editing,
    /** The user's text while editing, a submitted address until the page reports, otherwise the page's URL. */
    field: field(state, epoch),
    /** What the user typed, which suggestions highlight; empty at rest. */
    query: state.status === "editing" ? state.text : "",
    typed: state.status === "editing" && state.typed,
    /** The suggestions popover is open. */
    listed: shown,
    active,
    /** The suggestion Enter opens. */
    chosen: active >= 0 ? suggestions[active] : undefined,
    /** A submitted navigation the browser has not reported yet; keeps the empty state hidden meanwhile. */
    navigating: !!hold && hold.moved === epoch.moved,
  }
}

function navigate(state: AddressState, url: string, epoch: AddressEpoch): AddressTransition {
  if (!epoch.tabID) return unchanged(state)

  // A blank page keeps the field empty.
  return {
    state: {
      status: "submitted",
      hold: {
        text: url === "about:blank" ? "" : url,
        followed: epoch.followed,
        rejected: epoch.rejected,
        moved: epoch.moved,
      },
    },
    effects: [{ type: "navigate", tabID: epoch.tabID, url }, BLUR],
  }
}

function field(state: AddressState, epoch: AddressEpoch) {
  if (state.status === "editing") return state.text

  return state.status === "submitted" && activeHold(state.hold, epoch) ? state.hold.text : epoch.url
}

function listed(state: AddressState, suggestions: readonly Visit[]) {
  return state.status === "editing" && suggestions.length > 0 && !state.dismissed
}

function chosen(state: AddressState, suggestions: readonly Visit[]) {
  return listed(state, suggestions) && state.status === "editing" ? suggestions[state.active] : undefined
}

/** The hold, while the page has not reported a URL change, a finished load or a rejection since the submit. */
function activeHold(hold: SubmittedHold | undefined, epoch: AddressEpoch) {
  return hold && hold.followed === epoch.followed && hold.rejected === epoch.rejected ? hold : undefined
}

function unchanged(state: AddressState): AddressTransition {
  return { state, effects: [] }
}
