import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readMessageSelection } from "./message-selection"

const base = {
  x: 24,
  y: 48,
  width: 120,
  height: 18,
  top: 48,
  right: 144,
  bottom: 66,
  left: 24,
}

const makeRect = (input = {}) => {
  const box = { ...base, ...input }
  return {
    ...box,
    toJSON: () => box,
  } as DOMRect
}

const setRect = (range: Range, input: { box?: DOMRect; list?: DOMRect[] } = {}) => {
  const box = input.box ?? makeRect()
  const list = input.list ?? [box]
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: () => box,
  })
  Object.defineProperty(range, "getClientRects", {
    configurable: true,
    value: () => {
      return {
        length: list.length,
        item: (i: number) => list[i] ?? null,
        ...Object.fromEntries(list.map((box, i) => [i, box])),
      } as DOMRectList
    },
  })
}

const text = (id: string) => {
  const node = document.getElementById(id)?.firstChild
  if (node) return node
  throw new Error(`Missing text node for ${id}`)
}

const select = (input: {
  startID: string
  start: number
  endID?: string
  end: number
  box?: DOMRect
  list?: DOMRect[]
}) => {
  const range = document.createRange()
  range.setStart(text(input.startID), input.start)
  range.setEnd(text(input.endID ?? input.startID), input.end)
  setRect(range, { box: input.box, list: input.list })

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

beforeEach(() => {
  document.body.innerHTML = ""
  window.getSelection()?.removeAllRanges()
})

afterEach(() => {
  document.body.innerHTML = ""
  window.getSelection()?.removeAllRanges()
})

describe("readMessageSelection", () => {
  test("accepts a trimmed selection within one assistant message", () => {
    document.body.innerHTML = `
      <div data-message-id="turn-1">
        <div data-message-selection="true" data-message-selection-id="msg-a1" data-message-role="assistant">
          <span id="a1">assistant reply text</span>
        </div>
      </div>
    `

    select({ startID: "a1", start: 0, end: 9 })

    expect(readMessageSelection({ root: document.body })).toEqual({
      messageID: "msg-a1",
      role: "assistant",
      quote: "assistant",
      rect: base,
      anchor: base,
    })
  })

  test("accepts assistant selection in a multi-assistant turn", () => {
    document.body.innerHTML = `
      <div data-message-id="turn-1">
        <div data-message-selection="true" data-message-selection-id="msg-u1" data-message-role="user">
          <span id="u1">user prompt</span>
        </div>
        <div data-message-selection="true" data-message-selection-id="msg-a1" data-message-role="assistant">
          <span id="a1">first assistant reply</span>
        </div>
        <div data-message-selection="true" data-message-selection-id="msg-a2" data-message-role="assistant">
          <span id="a2">second assistant reply</span>
        </div>
      </div>
    `

    select({ startID: "a2", start: 7, end: 16 })

    expect(readMessageSelection({ root: document.body })).toEqual({
      messageID: "msg-a2",
      role: "assistant",
      quote: "assistant",
      rect: base,
      anchor: base,
    })
  })

  test("falls back to the range bounding box when client rects are empty", () => {
    const back = {
      x: 60,
      y: 80,
      width: 44,
      height: 16,
      top: 80,
      right: 104,
      bottom: 96,
      left: 60,
    }

    document.body.innerHTML = `
      <div data-message-id="turn-1">
        <div data-message-selection="true" data-message-selection-id="msg-a1" data-message-role="assistant">
          <span id="a1">assistant reply text</span>
        </div>
      </div>
    `

    select({
      startID: "a1",
      start: 0,
      end: 9,
      box: makeRect(back),
      list: [],
    })

    expect(readMessageSelection({ root: document.body })).toEqual({
      messageID: "msg-a1",
      role: "assistant",
      quote: "assistant",
      rect: back,
      anchor: back,
    })
  })

  test("returns the first rect and last rect for a multi-line selection", () => {
    const first = {
      x: 24,
      y: 48,
      width: 96,
      height: 18,
      top: 48,
      right: 120,
      bottom: 66,
      left: 24,
    }
    const last = {
      x: 148,
      y: 72,
      width: 32,
      height: 18,
      top: 72,
      right: 180,
      bottom: 90,
      left: 148,
    }

    document.body.innerHTML = `
      <div data-message-id="turn-1">
        <div data-message-selection="true" data-message-selection-id="msg-a1" data-message-role="assistant">
          <span id="a1">assistant reply text</span>
        </div>
      </div>
    `

    select({
      startID: "a1",
      start: 0,
      end: 20,
      list: [makeRect(first), makeRect(last)],
    })

    expect(readMessageSelection({ root: document.body })).toEqual({
      messageID: "msg-a1",
      role: "assistant",
      quote: "assistant reply text",
      rect: first,
      anchor: last,
    })
  })

  test("rejects a selection spanning two assistant messages in one turn", () => {
    document.body.innerHTML = `
      <div data-message-id="turn-1">
        <div data-message-selection="true" data-message-selection-id="msg-u1" data-message-role="user">
          <span id="u1">user prompt</span>
        </div>
        <div data-message-selection="true" data-message-selection-id="msg-a1" data-message-role="assistant">
          <span id="a1">first assistant reply</span>
        </div>
        <div data-message-selection="true" data-message-selection-id="msg-a2" data-message-role="assistant">
          <span id="a2">second assistant reply</span>
        </div>
      </div>
    `

    select({ startID: "a1", start: 6, endID: "a2", end: 6 })

    expect(readMessageSelection({ root: document.body })).toBeUndefined()
  })

  test("rejects a selection spanning two message wrappers", () => {
    document.body.innerHTML = `
      <div data-message-id="turn-1">
        <div data-message-selection="true" data-message-selection-id="msg-u1" data-message-role="user">
          <span id="u1">hello world</span>
        </div>
      </div>
      <div data-message-id="turn-2">
        <div data-message-selection="true" data-message-selection-id="msg-a2" data-message-role="assistant">
          <span id="a2">assistant reply</span>
        </div>
      </div>
    `

    select({ startID: "u1", start: 6, endID: "a2", end: 5 })

    expect(readMessageSelection({ root: document.body })).toBeUndefined()
  })

  test("rejects a whitespace-only selection", () => {
    document.body.innerHTML = `
      <div data-message-id="turn-1">
        <div data-message-selection="true" data-message-selection-id="msg-u1" data-message-role="user">
          <span id="blank">   </span>
        </div>
      </div>
    `

    select({ startID: "blank", start: 0, end: 3 })

    expect(readMessageSelection({ root: document.body })).toBeUndefined()
  })
})
