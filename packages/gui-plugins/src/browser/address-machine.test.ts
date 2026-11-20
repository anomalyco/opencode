import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  addressSuggestions,
  addressView,
  initialAddressState,
  nextAddressEpoch,
  transitionAddress,
  type AddressEffect,
  type AddressEpoch,
  type AddressEvent,
  type AddressPage,
  type AddressState,
} from "./address-machine"
import type { HistoryPage } from "./history/ipc"
import type { Visit } from "./history/visits"

const tabID = Browser.TabID.make("tab_11111111-1111-1111-1111-111111111111")

const blank: AddressPage = { tabID, url: "", loading: false, generation: 1, error: undefined }

// Folds page reports the way the pane's memo does.
const reports = (...pages: readonly AddressPage[]) =>
  pages.reduce<AddressEpoch | undefined>((epoch, page) => nextAddressEpoch(epoch, page), undefined)!

const replay = (events: readonly AddressEvent[], state: AddressState = initialAddressState) =>
  events.reduce((current, event) => transitionAddress(current, event).state, state)

const view = (state: AddressState, epoch: AddressEpoch, visits: readonly Visit[] = []) =>
  addressView(state, epoch, addressSuggestions(state, visits))

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
      { type: "input.changed", value: "  ", deleting: false, visits: [] },
    ])

    expect(transitionAddress(editing, { type: "submitted", epoch, visits: [], failed: false }).effects).toEqual([
      { type: "blur-input" },
    ])
  })

  test("an empty field opens a blank page on a failed page", () => {
    const epoch = reports({ ...blank, url: "https://alpha.example/" })

    const editing = replay([
      { type: "focused", epoch },
      { type: "input.changed", value: "", deleting: true, visits: [] },
    ])

    const submitted = transitionAddress(editing, { type: "submitted", epoch, visits: [], failed: true })

    expect(submitted.effects[0]).toEqual({ type: "navigate", tabID, url: "about:blank" })
    expect(view(submitted.state, epoch).field).toBe("")
  })

  test("Enter opens the completed suggestion", () => {
    const epoch = reports(blank)

    const editing = replay([
      { type: "focused", epoch },
      { type: "input.changed", value: "exa", deleting: false, visits },
    ])

    expect(view(editing, epoch, visits)).toMatchObject({ listed: true, active: 0, chosen: visits[0] })
    expect(view(editing, epoch, visits).chosen?.completes).toBe(true)

    expect(transitionAddress(editing, { type: "submitted", epoch, visits, failed: false }).effects[0]).toEqual({
      type: "navigate",
      tabID,
      url: "https://example.com/",
    })
  })

  test("a page without a tab ignores the submit", () => {
    const epoch = reports({ ...blank, tabID: undefined })
    const editing = replay([{ type: "focused", epoch }])

    expect(transitionAddress(editing, { type: "navigated", url: "https://example.com/", epoch }).state).toBe(editing)
  })
})

describe("editing", () => {
  const epoch = reports(blank)

  const typed = (value: string, deleting = false) =>
    replay([
      { type: "focused", epoch },
      { type: "input.changed", value, deleting, visits },
    ])

  test("deleting never completes a suggestion", () => {
    expect(view(typed("exa", true), epoch, visits)).toMatchObject({ listed: true, active: -1, chosen: undefined })
  })

  test("arrows cycle through the suggestions and the typed text", () => {
    const keys = (state: AddressState, ...pressed: ("ArrowDown" | "ArrowUp")[]) =>
      pressed.reduce((current, key) => transitionAddress(current, { type: "key.pressed", key, visits }).state, state)

    const start = typed("exa", true)

    expect(view(keys(start, "ArrowDown"), epoch, visits).active).toBe(0)
    expect(view(keys(start, "ArrowDown", "ArrowDown"), epoch, visits).active).toBe(1)
    expect(view(keys(start, "ArrowDown", "ArrowDown", "ArrowDown"), epoch, visits).active).toBe(-1)
    expect(view(keys(start, "ArrowUp"), epoch, visits).active).toBe(1)
    expect(transitionAddress(start, { type: "key.pressed", key: "ArrowDown", visits }).effects).toEqual([
      { type: "prevent-default" },
    ])
  })

  test("arrows without suggestions leave the key to the input", () => {
    const focused = replay([{ type: "focused", epoch }])

    expect(transitionAddress(focused, { type: "key.pressed", key: "ArrowDown", visits }).effects).toEqual([])
  })

  test("Escape closes the suggestions first, then leaves the field", () => {
    const dismissed = transitionAddress(typed("exa"), { type: "key.pressed", key: "Escape", visits })
    expect(view(dismissed.state, epoch, visits)).toMatchObject({ listed: false, active: -1 })
    expect(dismissed.effects).toEqual([{ type: "prevent-default" }])

    expect(transitionAddress(dismissed.state, { type: "key.pressed", key: "Escape", visits }).effects).toEqual([
      { type: "prevent-default" },
      { type: "blur-input" },
    ])
  })

  test("input and keys outside an edit change nothing", () => {
    const submitted = replay([{ type: "navigated", url: "https://example.com/", epoch }])

    for (const state of [initialAddressState, submitted]) {
      expect(transitionAddress(state, { type: "input.changed", value: "x", deleting: false, visits }).state).toBe(state)
      expect(transitionAddress(state, { type: "key.pressed", key: "Escape", visits }).state).toBe(state)
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

  const type = (state: AddressState, value: string, deleting = false) =>
    transitionAddress(state, { type: "input.changed", value, deleting, visits: [] })

  const answer = (state: AddressState, attempt: number, pages: readonly HistoryPage[], local: readonly Visit[] = []) =>
    transitionAddress(state, { type: "answered", attempt, pages, visits: local })

  const asked = (effects: readonly AddressEffect[]) => effects.flatMap((effect) => (effect.type === "ask" ? [effect] : []))

  test("each change of the text asks main, without waiting: the field has the text at once", () => {
    const typed = type(focused, "gith")
    const [question] = asked(typed.effects)

    expect(question).toMatchObject({ type: "ask", query: "gith" })
    expect(view(typed.state, epoch)).toMatchObject({ field: "gith", listed: false, active: -1 })
    // Text with nothing to search for asks nothing.
    expect(type(focused, "   ").effects).toEqual([])
    expect(type(focused, "https://").effects).toHaveLength(1)
  })

  test("the answer to the last question joins the list and completes the address it begins", () => {
    const typed = type(focused, "gith")
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [github, rune])

    expect(view(answered.state, epoch)).toMatchObject({ listed: true, active: 0, chosen: { url: "https://github.com/", completes: true } })
    expect(transitionAddress(answered.state, { type: "submitted", epoch, visits: [], failed: false }).effects[0]).toEqual({
      type: "navigate",
      tabID,
      url: "https://github.com/",
    })
  })

  test("a page that matches without beginning with the text is listed, and Enter still opens the typed text", () => {
    const typed = type(focused, "rune")
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [rune])

    expect(view(answered.state, epoch)).toMatchObject({ listed: true, active: -1, chosen: undefined })
    expect(transitionAddress(answered.state, { type: "submitted", epoch, visits: [], failed: false }).effects[0]).toEqual({
      type: "navigate",
      tabID,
      url: "https://www.google.com/search?q=rune",
    })
    // One step down chooses it.
    const stepped = transitionAddress(answered.state, { type: "key.pressed", key: "ArrowDown", visits: [] }).state
    expect(transitionAddress(stepped, { type: "submitted", epoch, visits: [], failed: false }).effects[0]).toMatchObject({ url: rune.url })
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

    // GitLab no longer matches; the others show before main answers "gith".
    expect(addressSuggestions(more.state, []).map((page) => page.url)).toEqual([github.url, rune.url])
    expect(view(more.state, epoch).active).toBe(0)
    // Emptying the field drops it: no text has that answer.
    expect(addressSuggestions(type(more.state, "", true).state, [])).toEqual([])
  })

  test("deleting never completes, even once the answer comes", () => {
    const typed = type(focused, "gith", true)
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [github]).state

    expect(view(answered, epoch)).toMatchObject({ listed: true, active: -1, chosen: undefined })
  })

  test("an answer keeps the suggestion the person stepped to, wherever it lands", () => {
    const local: Visit[] = [{ url: "https://github.com/sst/opentui", title: "sst/opentui" }]
    const typed = transitionAddress(focused, { type: "input.changed", value: "gith", deleting: false, visits: local })
    // Down leaves the completed suggestion for the typed text; down again steps back onto it.
    const stepped = transitionAddress(typed.state, { type: "key.pressed", key: "ArrowDown", visits: local }).state
    const chosen = transitionAddress(stepped, { type: "key.pressed", key: "ArrowDown", visits: local }).state

    expect(view(chosen, epoch, local).chosen).toMatchObject({ url: local[0]?.url })
    const answered = answer(chosen, asked(typed.effects)[0]?.attempt ?? -1, [github, rune], local).state
    // Main's pages rank above it; it is still the one Enter opens.
    expect(addressSuggestions(answered, local).map((page) => page.url)).toEqual([github.url, rune.url, local[0]?.url])
    expect(view(answered, epoch, local)).toMatchObject({ active: 2, chosen: { url: local[0]?.url } })
  })

  test("a question main could not answer leaves what the window knows", () => {
    const local: Visit[] = [{ url: "https://github.com/sst/opentui", title: "sst/opentui" }]
    const typed = transitionAddress(focused, { type: "input.changed", value: "gith", deleting: false, visits: local })
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [], local).state

    expect(view(answered, epoch, local)).toMatchObject({ listed: true, active: 0, chosen: { url: local[0]?.url } })
  })

  test("Shift+Delete forgets the chosen suggestion at once, and is the field's own key without one", () => {
    const typed = type(focused, "gith")
    const answered = answer(typed.state, asked(typed.effects)[0]?.attempt ?? -1, [github, rune]).state
    const forgotten = transitionAddress(answered, { type: "forget.pressed", visits: [] })

    expect(forgotten.effects).toEqual([{ type: "prevent-default" }, { type: "forget", url: "https://github.com/" }])
    // The next suggestion takes its place and stays chosen.
    expect(view(forgotten.state, epoch)).toMatchObject({ listed: true, active: 0, chosen: { url: rune.url } })

    const none = transitionAddress(type(focused, "rune").state, { type: "forget.pressed", visits: [] })
    expect(none.effects).toEqual([])
    expect(transitionAddress(focused, { type: "forget.pressed", visits: [] }).state).toBe(focused)
  })
})

test("a report that changes nothing keeps the same counts object", () => {
  const epoch = reports(blank)

  expect(nextAddressEpoch(epoch, { ...blank })).toBe(epoch)
})
