import { describe, expect, test } from "bun:test"
import { createQuickUndo } from "./quick-undo"

describe("quick undo", () => {
  test("returns the submitted message on a second escape within two seconds", () => {
    const undo = createQuickUndo<string>()
    undo.submitted("msg_1", "hello", 1_000)

    expect(undo.escape(1_500)).toBeUndefined()
    expect(undo.escape(1_750)).toEqual({ messageID: "msg_1", value: "hello" })
    expect(undo.escape(1_800)).toBeUndefined()
  })

  test("expires two seconds after submission", () => {
    const undo = createQuickUndo<string>()
    undo.submitted("msg_1", "hello", 1_000)

    expect(undo.escape(2_500)).toBeUndefined()
    expect(undo.escape(3_001)).toBeUndefined()
  })

  test("a new submission replaces the previous one", () => {
    const undo = createQuickUndo<string>()
    undo.submitted("msg_1", "first", 1_000)
    undo.escape(1_100)
    undo.submitted("msg_2", "second", 1_200)

    expect(undo.escape(1_300)).toBeUndefined()
    expect(undo.escape(1_400)).toEqual({ messageID: "msg_2", value: "second" })
  })
})
