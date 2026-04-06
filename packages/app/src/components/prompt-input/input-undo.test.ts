import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { createInputUndoEntry, createInputUndoState, recordInputUndo, stepInputUndo } from "./input-undo"

const text = (content: string): Prompt => [{ type: "text", content, start: 0, end: content.length }]

describe("prompt input undo", () => {
  test("keeps slow typing as separate undo steps", () => {
    let state = createInputUndoState(createInputUndoEntry(text(""), 0))
    let last = 0

    const push = (prev: string, next: string, time: number) => {
      state = recordInputUndo({
        state,
        prev: createInputUndoEntry(text(prev), prev.length),
        next: createInputUndoEntry(text(next), next.length),
        time,
        last,
      })
      last = time
    }

    push("", "a", 1000)
    push("a", "ab", 2200)
    push("ab", "abc", 3400)
    push("abc", "abcd", 4600)

    expect(state.entries).toHaveLength(5)

    const first = stepInputUndo(state, "undo")
    expect(first?.entry.prompt[0]?.type === "text" ? first.entry.prompt[0].content : "").toBe("abc")
    const second = stepInputUndo(first!.state, "undo")
    expect(second?.entry.prompt[0]?.type === "text" ? second.entry.prompt[0].content : "").toBe("ab")
  })

  test("merges rapid single-character typing into one undo step", () => {
    let state = createInputUndoState(createInputUndoEntry(text(""), 0))
    let last = 0

    const push = (prev: string, next: string, time: number) => {
      state = recordInputUndo({
        state,
        prev: createInputUndoEntry(text(prev), prev.length),
        next: createInputUndoEntry(text(next), next.length),
        time,
        last,
      })
      last = time
    }

    push("", "a", 1000)
    push("a", "ab", 1200)
    push("ab", "abc", 1400)

    expect(state.entries).toHaveLength(2)
    const undo = stepInputUndo(state, "undo")
    expect(undo?.entry.prompt[0]?.type === "text" ? undo.entry.prompt[0].content : "").toBe("")
  })

  test("starts a new undo step for non-text changes", () => {
    const base: Prompt = [{ type: "text", content: "a", start: 0, end: 1 }]
    const next: Prompt = [
      { type: "text", content: "a", start: 0, end: 1 },
      { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 1, end: 10 },
    ]

    const state = recordInputUndo({
      state: createInputUndoState(createInputUndoEntry(base, 1)),
      prev: createInputUndoEntry(base, 1),
      next: createInputUndoEntry(next, 10),
      time: 1000,
      last: 900,
    })

    expect(state.entries).toHaveLength(2)
  })

  test("supports redo after undo", () => {
    let state = createInputUndoState(createInputUndoEntry(text(""), 0))
    state = recordInputUndo({
      state,
      prev: createInputUndoEntry(text(""), 0),
      next: createInputUndoEntry(text("abc"), 3),
      time: 1000,
      last: 0,
    })

    const undo = stepInputUndo(state, "undo")
    expect(undo?.entry.prompt[0]?.type === "text" ? undo.entry.prompt[0].content : "").toBe("")

    const redo = stepInputUndo(undo!.state, "redo")
    expect(redo?.entry.prompt[0]?.type === "text" ? redo.entry.prompt[0].content : "").toBe("abc")
  })
})
