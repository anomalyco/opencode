// The browser's address field. At rest it shows the page's URL; editing shows the user's text and suggestions; a
// submitted address stays in the field until the page reports where it went. The page's reports are counted by
// `nextAddressEpoch`, and a submit keeps the counts it saw, so the next URL change, finished load or rejection ends
// the hold, even one that repeats a value, while focusing and leaving the field in between keeps it.
//
// The pages of the list come from two places: the window's own list of the last pages, at once, and main's history,
// which is asked on each change of the text and answers a moment later. The field never waits for it: each question
// takes the next number, and only the answer to the last one is kept.
//
// The list and its keys copy Chrome's address bar (`components/omnibox/browser` in Chromium). Its first row is what
// Enter opens and is always the chosen one: the typed text as a search or an address, or the page whose address the
// typing completes, which the field shows after the typed text, selected. Moving through the list puts each row's
// text in the field and holds the rows as they are.
import type { Browser } from "@opencode/plugin-browser/rpc"
import { resolveAddress, searchAddress, searches } from "./address"
import type { HistoryPage } from "./history/ipc"
import { filled, pageKey } from "./history/page"
import { suggestPages, type Suggestion } from "./history/suggest"
import type { Visit } from "./history/visits"

/** Pages of the history the address field lists, and pages the new tab page lists. */
export const ADDRESS_SUGGESTIONS = 5

/** A row of the address field's list. `url` is what it opens. */
export type AddressRow =
  /** A web search for what was typed. */
  | { readonly type: "search"; readonly text: string; readonly url: string }
  /** What was typed, opened as an address. */
  | { readonly type: "address"; readonly text: string; readonly url: string }
  /** A page of the history. */
  | { readonly type: "page"; readonly page: Suggestion; readonly url: string }

/** The list under the field while the person types. */
export type AddressList =
  /** It follows the typing, and its first row is the chosen one. */
  | { readonly type: "following" }
  /**
   * The person moved through it. Its rows stay as they were, whatever main answers later, and the field shows the
   * text of the row at `line`.
   */
  | { readonly type: "held"; readonly rows: readonly AddressRow[]; readonly line: number }
  /** Escape closed it. Typing or an arrow key opens it again. */
  | { readonly type: "closed" }

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

export type AddressState = {
  /** The last question main's history was asked for this field; an answer to any other is stale. */
  readonly asked: number
} & (
  | { readonly status: "rest" }
  | {
      readonly status: "editing"
      /** What the person typed. The field shows more: a completed address after it, or the text of a row. */
      readonly text: string
      /** The user typed since focusing; the list follows typing, not a focused URL. */
      readonly typed: boolean
      readonly list: AddressList
      /** A submitted address that had not been reported yet when the user focused; leaving the field keeps it. */
      readonly hold: SubmittedHold | undefined
      /**
       * Main's last answer. It stays while the next question is out, matched against the new text, so the list
       * narrows at once instead of emptying until the answer comes.
       */
      readonly answer: readonly HistoryPage[]
      /**
       * The last change of the text may complete an address: it typed at the end of the text, and did not delete,
       * paste or move the caret.
       */
      readonly completing: boolean
    }
  | { readonly status: "submitted"; readonly hold: SubmittedHold }
)

export type AddressEvent =
  | { readonly type: "focused"; readonly epoch: AddressEpoch }
  | { readonly type: "blurred"; readonly epoch: AddressEpoch }
  /**
   * The field's text is `value`: the person typed, deleted or pasted, or moved the caret off a completed address,
   * which takes it into the text. `completing` is whether an address may complete it: text typed at its end.
   */
  | {
      readonly type: "input.changed"
      readonly value: string
      readonly completing: boolean
      readonly visits: readonly Visit[]
    }
  | {
      readonly type: "key.pressed"
      readonly key: "ArrowDown" | "ArrowUp" | "Tab" | "Shift+Tab" | "Escape"
      readonly epoch: AddressEpoch
      readonly visits: readonly Visit[]
    }
  /** Shift+Delete: forgets the chosen row's page. */
  | { readonly type: "forget.pressed"; readonly visits: readonly Visit[] }
  /** Main answered question `attempt`; a question that failed is answered with no pages. */
  | {
      readonly type: "answered"
      readonly attempt: number
      readonly pages: readonly HistoryPage[]
      readonly visits: readonly Visit[]
    }
  /** Enter in the field; `failed` is whether the page failed to load, where an empty address opens a blank page. */
  | {
      readonly type: "submitted"
      readonly epoch: AddressEpoch
      readonly visits: readonly Visit[]
      readonly failed: boolean
    }
  /** A click on a row of the list or a recent page. */
  | { readonly type: "navigated"; readonly url: string; readonly epoch: AddressEpoch }
  /** The page reported a tab switch, a URL change or a finished load. */
  | { readonly type: "page.followed"; readonly epoch: AddressEpoch }

export type AddressEffect =
  | { readonly type: "select-input" }
  /** Selects the completed address: the field's text from `start`, after what was typed, to its end. */
  | { readonly type: "select-completion"; readonly start: number }
  | { readonly type: "blur-input" }
  | { readonly type: "prevent-default" }
  /** Opens `url` in the page's tab; a field without a tab, as on the side panel's New tab page, opens it in a new one. */
  | { readonly type: "navigate"; readonly tabID: Browser.TabID | undefined; readonly url: string }
  /** The person is about to type: main reads its history into memory, ahead of the first question. */
  | { readonly type: "prepare" }
  /** Asks main's history for the pages that match `query`; the answer names `attempt`. */
  | { readonly type: "ask"; readonly attempt: number; readonly query: string }
  /** Forgets a page: in main's history, and in the window's list of the last pages. */
  | { readonly type: "forget"; readonly url: string }

export type AddressTransition = { readonly state: AddressState; readonly effects: readonly AddressEffect[] }

export const initialAddressState: AddressState = { status: "rest", asked: 0 }

const SELECT: AddressEffect = { type: "select-input" }

const BLUR: AddressEffect = { type: "blur-input" }

const PREVENT: AddressEffect = { type: "prevent-default" }

const PREPARE: AddressEffect = { type: "prepare" }

const FOLLOWING: AddressList = { type: "following" }

const CLOSED: AddressList = { type: "closed" }

type Editing = Extract<AddressState, { status: "editing" }>

export function transitionAddress(state: AddressState, event: AddressEvent): AddressTransition {
  switch (event.type) {
    case "focused": {
      if (state.status === "editing") return unchanged(state)
      const hold = state.status === "submitted" ? activeHold(state.hold, event.epoch) : undefined

      return {
        state: {
          status: "editing",
          // A new edit: an answer still on its way to the last one is not for this one.
          asked: state.asked + 1,
          text: hold ? hold.text : event.epoch.url,
          typed: false,
          list: FOLLOWING,
          hold,
          answer: [],
          completing: false,
        },
        effects: [SELECT, PREPARE],
      }
    }

    // Leaving the field without submitting cancels the edit; a submitted address not reported yet stays.
    case "blurred": {
      if (state.status !== "editing") return unchanged(state)
      const hold = activeHold(state.hold, event.epoch)

      return { state: hold ? { status: "submitted", asked: state.asked, hold } : { status: "rest", asked: state.asked }, effects: [] }
    }

    case "input.changed": {
      if (state.status !== "editing") return unchanged(state)
      const asked = state.asked + 1
      const text = event.value
      // Text with nothing to search for asks nothing, and no answer to an earlier text fits it.
      const searching = text.trim().length > 0
      const next: Editing = { ...state, asked, text, typed: true, list: FOLLOWING, completing: event.completing, answer: searching ? state.answer : [] }

      return {
        state: next,
        effects: [...(searching ? [{ type: "ask" as const, attempt: asked, query: text }] : []), ...selecting(next, event.visits)],
      }
    }

    case "answered": {
      // Rows the person moved through stay as they were: Chrome ends its search at the first step.
      if (state.status !== "editing" || event.attempt !== state.asked || state.list.type === "held") return unchanged(state)
      const next: Editing = { ...state, answer: event.pages }

      // The answer may bring the page whose address the typing completes.
      return { state: next, effects: selecting(next, event.visits) }
    }

    case "forget.pressed": {
      if (state.status !== "editing") return unchanged(state)
      const rows = addressRows(state, event.visits)
      const line = state.list.type === "held" ? state.list.line : 0
      const picked = listed(state, rows) ? rows[line] : undefined

      // Only a page of the history can be forgotten. On any other row the key is the input's own.
      if (picked?.type !== "page") return unchanged(state)
      const key = pageKey(picked.url)
      const left = listRows(state.text, rows.flatMap((row) => (row.type === "page" && row !== picked ? [row.page] : [])), state.completing)

      // The row that takes its place is the chosen one, and the list is held: the page may still be in an answer.
      return {
        state: {
          ...state,
          answer: state.answer.filter((page) => page.url !== picked.url && (!key || pageKey(page.url) !== key)),
          list: { type: "held", rows: left, line: Math.min(line, left.length - 1) },
        },
        effects: [PREVENT, { type: "forget", url: picked.url }],
      }
    }

    case "key.pressed": {
      if (state.status !== "editing") return unchanged(state)
      const rows = addressRows(state, event.visits)
      const open = listed(state, rows)

      // Escape undoes one thing at a time: the row's text, the list, the typed text, then the focus.
      if (event.key === "Escape") {
        if (state.list.type === "held") {
          const next: Editing = { ...state, list: FOLLOWING }

          return { state: next, effects: [PREVENT, ...selecting(next, event.visits)] }
        }

        if (open) return { state: { ...state, list: CLOSED }, effects: [PREVENT] }

        if (!state.typed) return { state, effects: [PREVENT, BLUR] }
        const hold = activeHold(state.hold, event.epoch)

        return {
          state: { ...state, asked: state.asked + 1, text: hold ? hold.text : event.epoch.url, typed: false, list: FOLLOWING, hold, answer: [], completing: false },
          effects: [PREVENT, SELECT],
        }
      }

      if (!open) {
        // Without a list Tab leaves the field, and an empty field has nothing to list.
        if (event.key === "Tab" || event.key === "Shift+Tab" || !state.text.trim()) return unchanged(state)
        const asked = state.asked + 1
        // An arrow opens the list for the text in the field. A focused address was not typed, so nothing completes it.
        const next: Editing = { ...state, asked, typed: true, list: FOLLOWING, completing: state.typed && state.completing }

        return { state: next, effects: [PREVENT, { type: "ask", attempt: asked, query: state.text }, ...selecting(next, event.visits)] }
      }

      const line = state.list.type === "held" ? state.list.line : 0
      const by = event.key === "ArrowDown" || event.key === "Tab" ? 1 : -1

      // Past either end the choice goes to the other one.
      return { state: { ...state, list: { type: "held", rows, line: (line + by + rows.length) % rows.length } }, effects: [PREVENT] }
    }

    case "submitted": {
      const rows = addressRows(state, event.visits)
      const picked = chosen(state, rows)

      if (picked) return navigate(state, picked.url, event.epoch)
      const text = typedText(state, event.epoch).trim()

      if (text || event.failed) return navigate(state, resolveAddress(text), event.epoch)

      return { state, effects: [BLUR] }
    }

    case "navigated":
      return navigate(state, event.url, event.epoch)

    // A field focused before its page had an address, as a tab opened on a URL is, shows where the page went until the
    // person types, as it does at rest.
    case "page.followed": {
      if (
        state.status !== "editing" ||
        state.typed ||
        state.hold ||
        state.list.type !== "following" ||
        state.text === event.epoch.url
      )
        return unchanged(state)

      return { state: { ...state, text: event.epoch.url }, effects: [SELECT] }
    }
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
    tab ||
    page.generation !== previous.generation ||
    page.loading !== previous.loading ||
    rejected !== previous.rejected
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

/**
 * The rows of the list: they follow what the user typed, and a focused address is not typed. `visits` is the
 * window's list of the last pages, which main's answer joins.
 */
export function addressRows(state: AddressState, visits: readonly Visit[]): readonly AddressRow[] {
  if (state.status !== "editing" || !state.typed) return []

  if (state.list.type === "held") return state.list.rows

  return listRows(state.text, suggestPages(state.text, visits, state.answer, ADDRESS_SUGGESTIONS), state.completing)
}

/** What the address field draws. */
export function addressView(state: AddressState, epoch: AddressEpoch, rows: readonly AddressRow[]) {
  const editing = state.status === "editing"
  const shown = listed(state, rows)
  const picked = chosen(state, rows)
  const completed = completion(state, rows)
  const hold = state.status === "rest" ? undefined : state.hold

  return {
    editing,
    /**
     * The chosen row's text once the person moved through the list; else the user's text while editing, with the
     * address it completes after it, a submitted address until the page reports, otherwise the page's URL.
     */
    field: state.status === "editing" && state.list.type === "held" && picked ? rowText(picked) : typedText(state, epoch) + completed,
    /** What the user typed, whose words the pages of the list highlight; empty at rest. */
    query: state.status === "editing" ? state.text : "",
    typed: state.status === "editing" && state.typed,
    /** The list is open. */
    listed: shown,
    /** The chosen row's place in the list; -1 without a list. */
    active: picked ? rows.indexOf(picked) : -1,
    /** The row Enter opens. */
    chosen: picked,
    /** The end of `field` that completes what was typed, which the field selects; empty when nothing does. */
    completion: completed,
    /** Typing may complete an address: a caret that leaves the end of the text takes that away. */
    completing: state.status === "editing" && state.typed && state.list.type === "following" && state.completing,
    /** A submitted navigation the browser has not reported yet; keeps the empty state hidden meanwhile. */
    navigating: !!hold && hold.moved === epoch.moved,
  }
}

/** What a row puts in the field when the person moves to it: what was typed, or the page's address. */
export function rowText(row: AddressRow) {
  return row.type === "page" ? filled(row.url) : row.text
}

/**
 * The list for a text, in Chrome's order. The first row is the one Enter opens: the best page when its address is
 * the text, or begins with it while typing completes; else the text itself, as a search or as an address. A search
 * for the text follows when it is not first, then the pages. A page that only matches is never first.
 */
function listRows(text: string, pages: readonly Suggestion[], completing: boolean): readonly AddressRow[] {
  const typed = text.trim()

  if (!typed) return []
  const search: AddressRow = { type: "search", text: typed, url: searchAddress(typed) }
  const rows = pages.map((page): AddressRow => ({ type: "page", page, url: page.url }))
  const lead = pages[0]

  if (lead && (lead.completion === "" || (completing && lead.completion !== undefined))) return [...rows.slice(0, 1), search, ...rows.slice(1)]

  if (searches(typed)) return [search, ...rows]

  return [{ type: "address", text: typed, url: resolveAddress(typed) }, search, ...rows]
}

function navigate(state: AddressState, url: string, epoch: AddressEpoch): AddressTransition {
  // A blank page keeps the field empty.
  return {
    state: {
      status: "submitted",
      asked: state.asked,
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

/** The user's text while editing, a submitted address until the page reports, otherwise the page's URL. */
function typedText(state: AddressState, epoch: AddressEpoch) {
  if (state.status === "editing") return state.text

  return state.status === "submitted" && activeHold(state.hold, epoch) ? state.hold.text : epoch.url
}

function listed(state: AddressState, rows: readonly AddressRow[]) {
  return state.status === "editing" && state.typed && state.list.type !== "closed" && rows.length > 0
}

/** The row Enter opens: the one the person moved to, else the first. */
function chosen(state: AddressState, rows: readonly AddressRow[]) {
  if (state.status !== "editing" || !listed(state, rows)) return undefined

  return rows[state.list.type === "held" ? state.list.line : 0]
}

/**
 * The rest of the first row's address after the typed text, which the field shows selected: only while the list
 * follows the typing and the last change of the text may complete. Deleting never completes.
 */
function completion(state: AddressState, rows: readonly AddressRow[]) {
  const first = rows[0]

  if (state.status !== "editing" || !state.typed || state.list.type !== "following" || !state.completing || first?.type !== "page") return ""

  return first.page.completion ?? ""
}

/** Selects the completed address, when the field now shows one. */
function selecting(state: Editing, visits: readonly Visit[]): readonly AddressEffect[] {
  return completion(state, addressRows(state, visits)) ? [{ type: "select-completion", start: state.text.length }] : []
}

/** The hold, while the page has not reported a URL change, a finished load or a rejection since the submit. */
function activeHold(hold: SubmittedHold | undefined, epoch: AddressEpoch) {
  return hold && hold.followed === epoch.followed && hold.rejected === epoch.rejected ? hold : undefined
}

function unchanged(state: AddressState): AddressTransition {
  return { state, effects: [] }
}
