import { expect, test } from "bun:test"
import { nextOrdinal, ownMessages, quoteText } from "./transcript"

test("a new side chat takes the lowest number no open chat uses", () => {
  expect(nextOrdinal([])).toBe(1)
  expect(nextOrdinal([{ ordinal: 1 }, { ordinal: 2 }])).toBe(3)
  expect(nextOrdinal([{ ordinal: 2 }, { ordinal: 3 }])).toBe(1)
  expect(nextOrdinal([{ ordinal: 1 }, { ordinal: 3 }])).toBe(2)
})

test("a side chat shows only what follows the last inherited message", () => {
  const messages = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]

  expect(ownMessages(messages, "b")).toEqual([{ id: "c" }, { id: "d" }])
  expect(ownMessages(messages, "d")).toEqual([])
  // A loaded window that starts after the inherited history holds only the chat's own messages.
  expect(ownMessages([{ id: "x" }, { id: "y" }], "b")).toEqual([{ id: "x" }, { id: "y" }])
})

test("quotes every line, keeping blank ones, and ignores a blank selection", () => {
  expect(quoteText("one\r\n\r\ntwo\n")).toBe("> one\n>\n> two")
  expect(quoteText("  \n ")).toBe("")
})
