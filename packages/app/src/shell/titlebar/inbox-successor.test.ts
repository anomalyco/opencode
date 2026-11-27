import { expect, test } from "bun:test"
import { inboxSuccessor } from "./inbox-successor"

const all = () => true

test("picks the row immediately below", () => {
  expect(inboxSuccessor(["a", "b", "c", "d"], "b", all)).toBe("c")
})

test("picks the row above when the last row leaves", () => {
  expect(inboxSuccessor(["a", "b", "c"], "c", all)).toBe("b")
})

test("skips rows that are gone, below first and then the nearest above", () => {
  expect(inboxSuccessor(["a", "b", "c", "d"], "b", (key) => key !== "c")).toBe("d")
  expect(inboxSuccessor(["a", "b", "c", "d"], "d", (key) => key !== "c")).toBe("b")
})

test("has no successor for the only row or a row the list didn't show", () => {
  expect(inboxSuccessor(["a"], "a", all)).toBeUndefined()
  expect(inboxSuccessor(["a", "b"], "x", all)).toBeUndefined()
})
