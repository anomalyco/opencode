import { describe, expect, test } from "bun:test"
import type { Browser } from "@opencode/plugin-browser/rpc"
import {
  addressSuggestions,
  addressView,
  initialAddressState,
  nextAddressEpoch,
  transitionAddress,
  type AddressEpoch,
  type AddressEvent,
  type AddressPage,
  type AddressState,
} from "./address-machine"
import type { Visit } from "./history"

const tabID = "tab_alpha" as Browser.TabID

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
    expect(focused.effects).toEqual([{ type: "select-input" }])
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
    expect(transitionAddress(focused, { type: "blurred", epoch: moved }).state).toEqual({ status: "rest" })
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

    expect(left).toEqual({ status: "rest" })
    expect(view(left, epoch, visits)).toMatchObject({ field: "", typed: false, listed: false, query: "" })
  })
})

test("a report that changes nothing keeps the same counts object", () => {
  const epoch = reports(blank)

  expect(nextAddressEpoch(epoch, { ...blank })).toBe(epoch)
})
