import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  addressRows,
  addressView,
  initialAddressState,
  nextAddressEpoch,
  transitionAddress,
  type AddressEffect,
  type AddressEpoch,
  type AddressEvent,
  type AddressPage,
  type AddressRow,
  type AddressState,
} from "./address-machine"
import type { HistoryPage } from "./history/ipc"
import { pageKey, type PageVisit } from "./history/page"
import { createPageIndex, findPages } from "./history/search"
import { HISTORY_ANSWER } from "./history/suggest"
import type { Visit } from "./history/visits"

const tabID = Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111")

const blank: AddressPage = { tabID, url: "", loading: false, generation: 1, error: undefined }

// Folds page reports the way the pane's memo does.
const reports = (...pages: readonly AddressPage[]) =>
  pages.reduce<AddressEpoch | undefined>((epoch, page) => nextAddressEpoch(epoch, page), undefined)!

const replay = (events: readonly AddressEvent[], state: AddressState = initialAddressState) =>
  events.reduce((current, event) => transitionAddress(current, event).state, state)

const view = (state: AddressState, epoch: AddressEpoch, visits: readonly Visit[] = []) =>
  addressView(state, epoch, addressRows(state, visits))

// A row as the tables name it: a page by its address, the typed text by what it does.
const label = (row: AddressRow) => (row.type === "page" ? row.url.replace("https://", "") : `${row.type}: ${row.text}`)

const labels = (state: AddressState, visits: readonly Visit[] = []) => addressRows(state, visits).map(label)

const visits: readonly Visit[] = [
  { url: "https://example.com/", title: "Example" },
  { url: "https://example.org/", title: "Example org" },
]

describe("a submitted address the browser has not reported yet", () => {
  test("stays in the field when the user focuses and leaves the field", () => {
    const epoch = reports(blank)

    const submitted = transitionAddress(initialAddressState, {
      type: "navigated",
      url: "https://example.com/",
      epoch,
    })

    expect(submitted.effects).toEqual([
      { type: "navigate", tabID, url: "https://example.com/" },
      { type: "blur-input" },
    ])

    const focused = transitionAddress(submitted.state, { type: "focused", epoch })
    // Focusing also has main read its history, ahead of the first question.
    expect(focused.effects).toEqual([{ type: "select-input" }, { type: "prepare" }])
    expect(view(focused.state, epoch).field).toBe("https://example.com/")

    const left = transitionAddress(focused.state, { type: "blurred", epoch })
    expect(view(left.state, epoch)).toMatchObject({ editing: false, field: "https://example.com/", navigating: true })

    // The page loads the address; its URL takes over the field.
    const loading = reports(blank, { ...blank, loading: true })
    expect(view(left.state, loading)).toMatchObject({ field: "https://example.com/", navigating: false })
    const landed = reports(blank, { ...blank, loading: true }, { ...blank, url: "https://example.com/", generation: 2 })
    expect(view(left.state, landed).field).toBe("https://example.com/")
    const redirected = reports(blank, { ...blank, url: "https://www.example.com/", generation: 2 })
    expect(view(left.state, redirected).field).toBe("https://www.example.com/")
  })

  test("a focus after the page reported starts from the page's URL", () => {
    const submitted = replay([{ type: "navigated", url: "https://example.com/", epoch: reports(blank) }])
    const moved = reports(blank, { ...blank, url: "https://other.example/", generation: 2 })
    const focused = transitionAddress(submitted, { type: "focused", epoch: moved }).state

    expect(view(focused, moved).field).toBe("https://other.example/")
    expect(transitionAddress(focused, { type: "blurred", epoch: moved }).state).toMatchObject({ status: "rest" })
  })
})

test("each blocked submission restores the page's URL, even a repeated one", () => {
  const page = { ...blank, url: "https://alpha.example/" }
  const blocked = { ...page, error: "Only web pages can open here." }
  const first = reports(page)
  const held = replay([{ type: "navigated", url: "https://blocked.example/", epoch: first }])
  expect(view(held, first).field).toBe("https://blocked.example/")

  const once = reports(page, blocked)
  expect(view(held, once).field).toBe("https://alpha.example/")

  const cleared = reports(page, blocked, page)
  const again = replay([{ type: "navigated", url: "https://blocked.example/", epoch: cleared }], held)
  expect(view(again, cleared).field).toBe("https://blocked.example/")
  expect(view(again, reports(page, blocked, page, blocked)).field).toBe("https://alpha.example/")
})

test("a submit that lands on the same URL keeps the address until the load finishes", () => {
  const page = { ...blank, url: "https://example.com/" }
  const held = replay([{ type: "navigated", url: "example.com", epoch: reports(page) }])
  const loading = reports(page, { ...page, loading: true })

  expect(view(held, loading)).toMatchObject({ field: "example.com", navigating: false })
  expect(view(held, reports(page, { ...page, loading: true }, page)).field).toBe("https://example.com/")
})

describe("submitting the field", () => {
  test("an empty field blurs without navigating on a page that loaded", () => {
    const epoch = reports({ ...blank, url: "https://alpha.example/" })

    const editing = replay([
      { type: "focused", epoch },
      { type: "input.changed", value: "  ", completing: true, visits: [] },
    ])

    expect(transitionAddress(editing, { type: "submitted", epoch, visits: [], failed: false }).effects).toEqual([
      { type: "blur-input" },
    ])
  })

  test("an empty field opens a blank page on a failed page", () => {
    const epoch = reports({ ...blank, url: "https://alpha.example/" })

    const editing = replay([
      { type: "focused", epoch },
      { type: "input.changed", value: "", completing: false, visits: [] },
    ])

    const submitted = transitionAddress(editing, { type: "submitted", epoch, visits: [], failed: true })

    expect(submitted.effects[0]).toEqual({ type: "navigate", tabID, url: "about:blank" })
    expect(view(submitted.state, epoch).field).toBe("")
  })

  test("Enter opens the page whose address the typing completes", () => {
    const epoch = reports(blank)

    const editing = replay([
      { type: "focused", epoch },
      { type: "input.changed", value: "exa", completing: true, visits },
    ])

    // The field shows the rest of the address after the typed text, and the page is the first row.
    expect(view(editing, epoch, visits)).toMatchObject({ listed: true, active: 0, field: "example.com", completion: "mple.com" })
    expect(labels(editing, visits)).toEqual(["example.com/", "search: exa", "example.org/"])

    expect(transitionAddress(editing, { type: "submitted", epoch, visits, failed: false }).effects[0]).toEqual({
      type: "navigate",
      tabID,
      url: "https://example.com/",
    })
  })

  test("a field without a tab, as on the New tab page, opens what was entered without one", () => {
    const epoch = reports({ ...blank, tabID: undefined })

    const typed = replay([
      { type: "focused", epoch },
      { type: "input.changed", value: "example.com", completing: false, visits: [] },
    ])

    expect(transitionAddress(typed, { type: "submitted", epoch, visits: [], failed: false }).effects).toEqual([
      { type: "navigate", tabID: undefined, url: "example.com" },
      { type: "blur-input" },
    ])
  })
})

describe("editing", () => {
  const epoch = reports(blank)

  const typed = (value: string, completing = true) =>
    replay([
      { type: "focused", epoch },
      { type: "input.changed", value, completing, visits },
    ])

  const press = (state: AddressState, key: "ArrowDown" | "ArrowUp" | "Tab" | "Shift+Tab" | "Escape", at = epoch) =>
    transitionAddress(state, { type: "key.pressed", key, epoch: at, visits })

  const keys = (state: AddressState, ...pressed: ("ArrowDown" | "ArrowUp" | "Tab" | "Shift+Tab")[]) =>
    pressed.reduce((current, key) => press(current, key).state, state)

  test("a field focused on a blank tab follows the page's address until the person types", () => {
    const focused = replay([{ type: "focused", epoch }])
    const loaded = reports(blank, { ...blank, url: "https://example.org/", loading: true })
    const followed = transitionAddress(focused, { type: "page.followed", epoch: loaded })

    expect(view(followed.state, loaded).field).toBe("https://example.org/")
    expect(followed.effects).toEqual([{ type: "select-input" }])

    const kept = typed("exa")
    expect(transitionAddress(kept, { type: "page.followed", epoch: loaded }).state).toBe(kept)
  })

  test("deleting never completes: the typed text is the first row, and Enter opens it", () => {
    const deleted = typed("exa", false)

    expect(view(deleted, epoch, visits)).toMatchObject({ listed: true, active: 0, field: "exa", completion: "" })
    expect(labels(deleted, visits)).toEqual(["search: exa", "example.com/", "example.org/"])
    expect(transitionAddress(deleted, { type: "submitted", epoch, visits, failed: false }).effects[0]).toMatchObject({
      url: "https://www.google.com/search?q=exa",
    })
  })

  test("arrows and Tab move through the rows, around either end, and the field shows each row's text", () => {
    const start = typed("exa", false)

    expect(view(keys(start, "ArrowDown"), epoch, visits)).toMatchObject({ active: 1, field: "https://example.com" })
    expect(view(keys(start, "ArrowDown", "Tab"), epoch, visits)).toMatchObject({ active: 2, field: "https://example.org" })
    expect(view(keys(start, "ArrowDown", "ArrowDown", "ArrowDown"), epoch, visits)).toMatchObject({ active: 0, field: "exa" })
    expect(view(keys(start, "ArrowUp"), epoch, visits)).toMatchObject({ active: 2, field: "https://example.org" })
    expect(view(keys(start, "Shift+Tab", "Shift+Tab"), epoch, visits)).toMatchObject({ active: 1 })
    expect(press(start, "ArrowDown").effects).toEqual([{ type: "prevent-default" }])
  })

  test("without a list an arrow in an empty field and Tab are the input's own keys", () => {
    const focused = replay([{ type: "focused", epoch }])

    expect(press(focused, "ArrowDown").effects).toEqual([])
    expect(press(focused, "Tab").state).toBe(focused)
    expect(press(press(typed("exa"), "Escape").state, "Tab").effects).toEqual([])
  })

  test("an arrow opens the list for the address in the field, and chooses its first row", () => {
    const page = reports({ ...blank, url: "https://example.org/" })
    const opened = press(replay([{ type: "focused", epoch: page }]), "ArrowDown", page)

    expect(opened.effects).toEqual([{ type: "prevent-default" }, { type: "ask", attempt: 2, query: "https://example.org/" }])
    // The address is a page of the list, so that page is the first row: nothing was typed for an address to complete.
    expect(view(opened.state, page, visits)).toMatchObject({ listed: true, active: 0, field: "https://example.org/", completion: "" })
    expect(labels(opened.state, visits)).toEqual(["example.org/", "search: https://example.org/"])
  })

  test("Escape undoes one thing at a time: the row's text, the list, the typed text, then the focus", () => {
    const page = reports({ ...blank, url: "https://alpha.example/" })

    const stepped = replay([
      { type: "focused", epoch: page },
      { type: "input.changed", value: "exa", completing: true, visits },
      { type: "key.pressed", key: "ArrowDown", epoch: page, visits },
    ])

    expect(view(stepped, page, visits)).toMatchObject({ active: 1, field: "exa" })
    const reverted = press(stepped, "Escape", page)
    // The typed text is back with the address it completes, selected again, and the list stays open.
    expect(view(reverted.state, page, visits)).toMatchObject({ listed: true, active: 0, field: "example.com", completion: "mple.com" })
    expect(reverted.effects).toEqual([{ type: "prevent-default" }, { type: "select-completion", start: 3 }])

    const closed = press(reverted.state, "Escape", page)
    // The list closes and the completed part goes with it; Enter then opens the typed text.
    expect(view(closed.state, page, visits)).toMatchObject({ listed: false, active: -1, field: "exa", typed: true })
    expect(closed.effects).toEqual([{ type: "prevent-default" }])
    expect(transitionAddress(closed.state, { type: "submitted", epoch: page, visits, failed: false }).effects[0]).toMatchObject({
      url: "https://www.google.com/search?q=exa",
    })

    const restored = press(closed.state, "Escape", page)
    expect(view(restored.state, page, visits)).toMatchObject({ editing: true, typed: false, field: "https://alpha.example/" })
    expect(restored.effects).toEqual([{ type: "prevent-default" }, { type: "select-input" }])

    expect(press(restored.state, "Escape", page).effects).toEqual([{ type: "prevent-default" }, { type: "blur-input" }])
  })

  test("an arrow opens a list Escape closed, without moving", () => {
    const closed = press(typed("exa"), "Escape").state
    const opened = press(closed, "ArrowDown")

    expect(view(opened.state, epoch, visits)).toMatchObject({ listed: true, active: 0, field: "example.com" })
    expect(opened.effects).toEqual([
      { type: "prevent-default" },
      { type: "ask", attempt: 3, query: "exa" },
      { type: "select-completion", start: 3 },
    ])
  })

  test("a caret that leaves the end takes the completed address into the text", () => {
    // The pane reports the field's whole text when the selection is no longer the completed part.
    const accepted = transitionAddress(typed("exa"), { type: "input.changed", value: "example.com", completing: false, visits })

    expect(view(accepted.state, epoch, visits)).toMatchObject({ field: "example.com", completion: "", active: 0 })
    // The text is now the page's whole address, so the page stays the first row.
    expect(labels(accepted.state, visits)).toEqual(["example.com/", "search: example.com"])
  })

  test("input and keys outside an edit change nothing", () => {
    const submitted = replay([{ type: "navigated", url: "https://example.com/", epoch }])

    for (const state of [initialAddressState, submitted]) {
      expect(transitionAddress(state, { type: "input.changed", value: "x", completing: true, visits }).state).toBe(state)
      expect(press(state, "Escape").state).toBe(state)
    }
  })

  test("leaving the field drops what the edit typed", () => {
    const left = transitionAddress(typed("exa"), { type: "blurred", epoch }).state

    expect(left).toMatchObject({ status: "rest" })
    expect(view(left, epoch, visits)).toMatchObject({ field: "", typed: false, listed: false, query: "" })
  })
})

describe("main's history answers after the field shows what was typed", () => {
  const epoch = reports(blank)
  const rune: HistoryPage = { url: "https://github.com/anomalyco/rune-desktop", title: "anomalyco/rune-desktop", score: 5 }
  const github: HistoryPage = { url: "https://github.com/", title: "GitHub", score: 17 }
  const gitlab: HistoryPage = { url: "https://gitlab.com/", title: "GitLab", score: 2 }

  const focused = replay([{ type: "focused", epoch }])

  const type = (state: AddressState, value: string, completing = true) =>
    transitionAddress(state, { type: "input.changed", value, completing, visits: [] })

  const answer = (state: AddressState, attempt: number, pages: readonly HistoryPage[], local: readonly Visit[] = []) =>
    transitionAddress(state, { type: "answered", attempt, pages, visits: local })

  const asked = (effects: readonly AddressEffect[]) => effects.flatMap((effect) => (effect.type === "ask" ? [effect] : []))

  const enter = (state: AddressState, local: readonly Visit[] = []) =>
    transitionAddress(state, { type: "submitted", epoch, visits: local, failed: false }).effects[0]

  test("each change of the text asks main, without waiting: the field has the text and its own row at once", () => {
    const typed = type(focused, "gith")
    const [question] = asked(typed.effects)

    expect(question).toMatchObject({ type: "ask", query: "gith" })
    expect(view(typed.state, epoch)).toMatchObject({ field: "gith", listed: true, active: 0 })
    expect(labels(typed.state)).toEqual(["search: gith"])
    // Text with nothing to search for asks nothing and lists nothing.
    expect(type(focused, "   ").effects).toEqual([])
    expect(view(type(focused, "   ").state, epoch).listed).toBe(false)
    expect(type(focused, "https://").effects).toHaveLength(1)
  })

  test("the answer to the last question joins the list and completes the address it begins", () => {
    const typed = type(focused, "gith")
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [github, rune])

    expect(answered.effects).toEqual([{ type: "select-completion", start: 4 }])
    expect(view(answered.state, epoch)).toMatchObject({ listed: true, active: 0, field: "github.com", completion: "ub.com" })
    expect(labels(answered.state)).toEqual(["github.com/", "search: gith", "github.com/anomalyco/rune-desktop"])
    expect(enter(answered.state)).toEqual({ type: "navigate", tabID, url: "https://github.com/" })
  })

  test("a page that matches without beginning with the text is listed below it and is never the first row", () => {
    const typed = type(focused, "rune")
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [rune])

    expect(answered.effects).toEqual([])
    expect(view(answered.state, epoch)).toMatchObject({ listed: true, active: 0, field: "rune", completion: "" })
    expect(labels(answered.state)).toEqual(["search: rune", "github.com/anomalyco/rune-desktop"])
    expect(enter(answered.state)).toEqual({ type: "navigate", tabID, url: "https://www.google.com/search?q=rune" })
    // One step down chooses it.
    const stepped = transitionAddress(answered.state, { type: "key.pressed", key: "ArrowDown", epoch, visits: [] }).state
    expect(enter(stepped)).toMatchObject({ url: rune.url })
  })

  test("an answer to an earlier text never replaces the answer to a later one", () => {
    const first = type(focused, "git")
    const second = type(first.state, "gith")
    const early = asked(first.effects)[0]?.attempt ?? -1
    const late = asked(second.effects)[0]?.attempt ?? -1

    expect(late).not.toBe(early)
    // The earlier answer arrives after the later question: ignored, as the same state object.
    expect(answer(second.state, early, [gitlab]).state).toBe(second.state)
    const answered = answer(second.state, late, [github]).state
    // And it is ignored when it arrives last, too.
    expect(answer(answered, early, [gitlab]).state).toBe(answered)
    expect(view(answered, epoch).chosen).toMatchObject({ url: "https://github.com/" })
  })

  test("an answer that arrives after the edit ended, or in the next edit, is dropped", () => {
    const typed = type(focused, "gith")
    const attempt = asked(typed.effects)[0]?.attempt ?? -1
    const left = transitionAddress(typed.state, { type: "blurred", epoch }).state

    expect(answer(left, attempt, [github]).state).toBe(left)
    const again = transitionAddress(left, { type: "focused", epoch }).state
    expect(answer(again, attempt, [github]).state).toBe(again)
    const submitted = transitionAddress(typed.state, { type: "submitted", epoch, visits: [], failed: false }).state
    expect(answer(submitted, attempt, [github]).state).toBe(submitted)
  })

  test("the last answer stays while the next question is out, narrowed to the new text", () => {
    const typed = type(focused, "git")
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [github, gitlab, rune]).state
    const more = type(answered, "gith")

    // GitLab no longer matches; the others show before main answers "gith", and GitHub's address is completed.
    expect(labels(more.state)).toEqual(["github.com/", "search: gith", "github.com/anomalyco/rune-desktop"])
    expect(more.effects).toContainEqual({ type: "select-completion", start: 4 })
    // Emptying the field drops it: no text has that answer.
    expect(labels(type(more.state, "", false).state)).toEqual([])
  })

  test("deleting never completes, even once the answer comes", () => {
    const typed = type(focused, "gith", false)
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [github])

    expect(answered.effects).toEqual([])
    expect(view(answered.state, epoch)).toMatchObject({ listed: true, active: 0, field: "gith", chosen: { type: "search" } })
    expect(labels(answered.state)).toEqual(["search: gith", "github.com/"])
  })

  test("a page whose whole address was typed is the first row, deleting or not", () => {
    const typed = type(focused, "github.com", false)
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [github, rune]).state

    expect(labels(answered)).toEqual(["github.com/", "search: github.com", "github.com/anomalyco/rune-desktop"])
    expect(view(answered, epoch)).toMatchObject({ active: 0, field: "github.com", completion: "" })
  })

  test("rows the person moved through stay as they were when the answer comes", () => {
    const local: Visit[] = [{ url: "https://github.com/sst/opentui", title: "sst/opentui" }]
    const typed = transitionAddress(focused, { type: "input.changed", value: "gith", completing: true, visits: local })
    // The window's page completes the text; one step down is the search for it.
    const stepped = transitionAddress(typed.state, { type: "key.pressed", key: "ArrowDown", epoch, visits: local }).state

    expect(view(stepped, epoch, local)).toMatchObject({ active: 1, field: "gith", chosen: { type: "search" } })
    // Chrome ends its search at the first step: the answer changes nothing, as the same state object.
    expect(answer(stepped, asked(typed.effects)[0]?.attempt ?? -1, [github, rune], local).state).toBe(stepped)
    expect(labels(stepped, local)).toEqual(["github.com/sst/opentui", "search: gith"])
    // Typing follows the list again, and asks anew.
    const more = transitionAddress(stepped, { type: "input.changed", value: "githu", completing: true, visits: local })
    expect(asked(more.effects)).toHaveLength(1)
    expect(view(more.state, epoch, local)).toMatchObject({ active: 0, field: "github.com/sst/opentui" })
  })

  test("a question main could not answer leaves what the window knows", () => {
    const local: Visit[] = [{ url: "https://github.com/sst/opentui", title: "sst/opentui" }]
    const typed = transitionAddress(focused, { type: "input.changed", value: "gith", completing: true, visits: local })
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [], local).state

    expect(view(answered, epoch, local)).toMatchObject({ listed: true, active: 0, chosen: { url: local[0]?.url } })
  })

  test("Shift+Delete forgets the chosen page at once, and is the field's own key on the typed text's row", () => {
    const typed = type(focused, "gith")
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [github, rune]).state
    const forgotten = transitionAddress(answered, { type: "forget.pressed", visits: [] })

    expect(forgotten.effects).toEqual([{ type: "prevent-default" }, { type: "forget", url: "https://github.com/" }])
    // The next page's address begins with the text too, so it takes the first row and stays chosen.
    expect(labels(forgotten.state)).toEqual(["github.com/anomalyco/rune-desktop", "search: gith"])
    expect(view(forgotten.state, epoch)).toMatchObject({ listed: true, active: 0, field: "https://github.com/anomalyco/rune-desktop" })
    // A later answer that still holds the forgotten page does not bring it back.
    expect(answer(forgotten.state, asked(typed.effects)[0]?.attempt ?? -1, [github, rune]).state).toBe(forgotten.state)

    const none = transitionAddress(type(focused, "rune").state, { type: "forget.pressed", visits: [] })
    expect(none.effects).toEqual([])
    expect(transitionAddress(focused, { type: "forget.pressed", visits: [] }).state).toBe(focused)
  })
})

// Chrome's address bar, input by input. The pane is played as it runs: each character replaces the completed part of
// the field, as typing over a selection does; Backspace and Delete remove that part first; and every question to
// main is answered by the real search over this history.
describe("the list and its keys are Chrome's", () => {
  const now = Date.UTC(2026, 10, 20)
  const day = 86_400_000
  const epoch = reports({ ...blank, url: "https://start.example/" })

  const history: readonly PageVisit[] = [
    { url: "https://github.com/", title: "GitHub", visits: 40, typed: 12, visited: now - day },
    { url: "https://github.com/anomalyco/rune-desktop", title: "anomalyco/rune-desktop", visits: 25, typed: 2, visited: now - day },
    { url: "https://github.com/anomalyco/rune-desktop/pulls", title: "Pull requests", visits: 9, typed: 0, visited: now - 2 * day },
    { url: "https://github.com/sst/opentui", title: "sst/opentui", visits: 5, typed: 0, visited: now - 3 * day },
    { url: "https://github.com/oven-sh/bun", title: "oven-sh/bun", visits: 4, typed: 0, visited: now - 9 * day },
    { url: "https://docs.rune.example/guide", title: "Guide", visits: 6, typed: 0, visited: now - 5 * day },
  ]

  type Outcome = {
    readonly rows: readonly string[]
    readonly chosen: number
    readonly field: string
    /** The part of the field the pane selects. */
    readonly selected: string
    /** What Enter opens next; undefined when it opens nothing. */
    readonly enter: string | undefined
  }

  const keys = ["ArrowDown", "ArrowUp", "Tab", "Shift+Tab", "Escape"] as const

  // Plays text and `{keys}` through the machine, answering as main does.
  const play = (steps: readonly string[]) => {
    const index = createPageIndex()
    history.forEach((page, id) => index.set(id, page))
    const opened: string[] = []
    const left: string[] = []

    const run = (state: AddressState, event: AddressEvent): AddressState =>
      transitionAddress(state, event).effects.reduce((current, effect) => {
        if (effect.type === "navigate") opened.push(effect.url)

        if (effect.type === "blur-input") left.push("blur")

        if (effect.type === "forget") history.forEach((page, id) => page.url === effect.url && index.remove(id))

        if (effect.type !== "ask") return current
        const read = { shown: (id: number) => history[id], front: (host: string) => history.find((page) => pageKey(page.url) === host) }

        return run(current, { type: "answered", attempt: effect.attempt, pages: findPages(index, effect.query, HISTORY_ANSWER, now, read), visits: [] })
      }, transitionAddress(state, event).state)

    // What a key leaves of the field's text: a focused address is all selected, as is the completed part.
    const typedPart = (state: AddressState) => {
      const shown = view(state, epoch)

      return shown.typed ? shown.field.slice(0, shown.field.length - shown.completion.length) : ""
    }

    const state = steps.reduce<AddressState>(
      (current, step) => {
        if (step === "{Enter}") return run(current, { type: "submitted", epoch, visits: [], failed: false })

        if (step === "{Shift+Delete}") return run(current, { type: "forget.pressed", visits: [] })

        // The completed part is selected, so either key removes it and nothing else; without it Backspace takes a character.
        if (step === "{Backspace}" || step === "{Delete}") {
          const completed = view(current, epoch).completion
          const value = completed || step === "{Delete}" ? typedPart(current) : typedPart(current).slice(0, -1)

          return run(current, { type: "input.changed", value, completing: false, visits: [] })
        }

        const key = keys.find((name) => step === `{${name}}`)

        if (key) return run(current, { type: "key.pressed", key, epoch, visits: [] })

        return [...step].reduce((typing, character) => run(typing, { type: "input.changed", value: typedPart(typing) + character, completing: true, visits: [] }), current)
      },
      run(initialAddressState, { type: "focused", epoch }),
    )

    const shown = view(state, epoch)

    const outcome: Outcome = {
      rows: shown.listed ? labels(state) : [],
      chosen: shown.active,
      field: shown.field,
      selected: shown.completion,
      enter: transitionAddress(state, { type: "submitted", epoch, visits: [], failed: false }).effects.flatMap((effect) => (effect.type === "navigate" ? [effect.url] : []))[0],
    }

    return { outcome, opened, left }
  }

  const google = (text: string) => `https://www.google.com/search?q=${encodeURIComponent(text)}`
  const front = "github.com/"
  const desktop = "github.com/anomalyco/rune-desktop"
  const pulls = "github.com/anomalyco/rune-desktop/pulls"
  const guide = "docs.rune.example/guide"

  const cases: readonly (readonly [name: string, steps: readonly string[], outcome: Outcome])[] = [
    ["a word that begins no address searches, with the pages that hold it below", ["rune"], { rows: ["search: rune", desktop, pulls, guide], chosen: 0, field: "rune", selected: "", enter: google("rune") }],
    ["two words search", ["anom rune"], { rows: ["search: anom rune", desktop, pulls], chosen: 0, field: "anom rune", selected: "", enter: google("anom rune") }],
    ["a question searches", ["how to center a div"], { rows: ["search: how to center a div"], chosen: 0, field: "how to center a div", selected: "", enter: google("how to center a div") }],
    ["the start of a host completes to the site", ["gith"], { rows: [front, "search: gith", desktop, pulls, "github.com/sst/opentui", "github.com/oven-sh/bun"], chosen: 0, field: "github.com", selected: "ub.com", enter: "https://github.com/" }],
    ["the start of a path completes to the page", ["github.com/anom"], { rows: [desktop, "search: github.com/anom", pulls], chosen: 0, field: desktop, selected: "alyco/rune-desktop", enter: `https://${desktop}` }],
    ["a whole address of the history is its page", [desktop], { rows: [desktop, `search: ${desktop}`, pulls], chosen: 0, field: desktop, selected: "", enter: `https://${desktop}` }],
    ["an address that is not in the history opens as typed", ["example.org"], { rows: ["address: example.org", "search: example.org"], chosen: 0, field: "example.org", selected: "", enter: "example.org" }],
    ["a host with a port opens as typed", ["localhost:3000"], { rows: ["address: localhost:3000", "search: localhost:3000"], chosen: 0, field: "localhost:3000", selected: "", enter: "localhost:3000" }],
    ["Backspace removes the completed part and the typed text is first", ["gith", "{Backspace}"], { rows: ["search: gith", front, desktop, pulls, "github.com/sst/opentui", "github.com/oven-sh/bun"], chosen: 0, field: "gith", selected: "", enter: google("gith") }],
    ["Delete removes the completed part the same way", ["gith", "{Delete}"], { rows: ["search: gith", front, desktop, pulls, "github.com/sst/opentui", "github.com/oven-sh/bun"], chosen: 0, field: "gith", selected: "", enter: google("gith") }],
    ["typing after a deletion completes again", ["gith", "{Backspace}", "u"], { rows: [front, "search: githu", desktop, pulls, "github.com/sst/opentui", "github.com/oven-sh/bun"], chosen: 0, field: "github.com", selected: "b.com", enter: "https://github.com/" }],
    ["Down chooses the next row and shows its address", ["rune", "{ArrowDown}"], { rows: ["search: rune", desktop, pulls, guide], chosen: 1, field: `https://${desktop}`, selected: "", enter: `https://${desktop}` }],
    ["Up from the first row chooses the last", ["rune", "{ArrowUp}"], { rows: ["search: rune", desktop, pulls, guide], chosen: 3, field: `https://${guide}`, selected: "", enter: `https://${guide}` }],
    ["Down past the last row is the first again", ["rune", "{ArrowUp}", "{ArrowDown}"], { rows: ["search: rune", desktop, pulls, guide], chosen: 0, field: "rune", selected: "", enter: google("rune") }],
    ["Tab moves as Down does, Shift+Tab as Up", ["rune", "{Tab}", "{Tab}", "{Shift+Tab}"], { rows: ["search: rune", desktop, pulls, guide], chosen: 1, field: `https://${desktop}`, selected: "", enter: `https://${desktop}` }],
    ["Down from a completed address is the search for the typed text", ["gith", "{ArrowDown}"], { rows: [front, "search: gith", desktop, pulls, "github.com/sst/opentui", "github.com/oven-sh/bun"], chosen: 1, field: "gith", selected: "", enter: google("gith") }],
    ["Escape on a row brings back the typed text and the first row", ["rune", "{ArrowDown}", "{Escape}"], { rows: ["search: rune", desktop, pulls, guide], chosen: 0, field: "rune", selected: "", enter: google("rune") }],
    ["Escape on a row brings back the completed address, too", ["gith", "{ArrowDown}", "{ArrowDown}", "{Escape}"], { rows: [front, "search: gith", desktop, pulls, "github.com/sst/opentui", "github.com/oven-sh/bun"], chosen: 0, field: "github.com", selected: "ub.com", enter: "https://github.com/" }],
    ["Escape on the first row closes the list and drops the completed part", ["gith", "{Escape}"], { rows: [], chosen: -1, field: "gith", selected: "", enter: google("gith") }],
    ["Escape again brings back the page's address", ["gith", "{Escape}", "{Escape}"], { rows: [], chosen: -1, field: "https://start.example/", selected: "", enter: "https://start.example/" }],
    ["Shift+Delete forgets the chosen page; the row that takes its place is chosen", ["rune", "{ArrowDown}", "{Shift+Delete}"], { rows: ["search: rune", pulls, guide], chosen: 1, field: `https://${pulls}`, selected: "", enter: `https://${pulls}` }],
    ["Shift+Delete on the last row chooses the new last row", ["rune", "{ArrowUp}", "{Shift+Delete}"], { rows: ["search: rune", desktop, pulls], chosen: 2, field: `https://${pulls}`, selected: "", enter: `https://${pulls}` }],
    ["a forgotten page stays gone when typing asks again", ["rune", "{ArrowDown}", "{Shift+Delete}", "{Escape}", "-"], { rows: ["search: rune-", pulls], chosen: 0, field: "rune-", selected: "", enter: google("rune-") }],
  ]

  test.each(cases)("%s", (_name, steps, outcome) => {
    expect(play(steps).outcome).toEqual(outcome)
  })

  test("Enter opens the chosen row, first or not, and Escape past the page's address leaves the field", () => {
    expect(play(["gith", "{Enter}"]).opened).toEqual(["https://github.com/"])
    expect(play(["rune", "{Enter}"]).opened).toEqual([google("rune")])
    expect(play(["rune", "{ArrowDown}", "{ArrowDown}", "{Enter}"]).opened).toEqual([`https://${pulls}`])
    expect(play(["example.org", "{ArrowDown}", "{Enter}"]).opened).toEqual([google("example.org")])
    expect(play(["gith", "{Escape}", "{Escape}", "{Escape}"]).left).toEqual(["blur"])
  })
})

test("a report that changes nothing keeps the same counts object", () => {
  const epoch = reports(blank)

  expect(nextAddressEpoch(epoch, { ...blank })).toBe(epoch)
})
