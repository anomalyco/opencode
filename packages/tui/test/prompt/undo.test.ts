import { describe, expect, test } from "bun:test"
import { copyPromptParts, createPromptUndo, PromptUndoPauseMs, type PromptUndoState } from "../../src/prompt/undo"

function rig(depth?: number) {
  let time = 0
  const undo = createPromptUndo({ depth: depth === undefined ? undefined : () => depth, now: () => time })
  let current: PromptUndoState = { input: "", parts: [], mode: "normal", cursor: 0 }
  undo.observe(current)
  const set = (input: string, extra: Partial<PromptUndoState> = {}) => {
    current = { ...current, input, cursor: input.length, ...extra }
    undo.observe(current)
  }
  return {
    undo,
    type(text: string) {
      for (const char of text) {
        time += 50
        set(current.input + char)
      }
    },
    backspace(count: number) {
      for (let i = 0; i < count; i++) {
        time += 50
        set(current.input.slice(0, -1))
      }
    },
    set,
    wait: (ms: number) => void (time += ms),
    moveCaret: (cursor: number) => {
      current = { ...current, cursor }
      undo.observe(current)
    },
    undoOnce() {
      const target = undo.undo(current)
      if (target) current = target
      undo.sync(current)
      return current.input
    },
    redoOnce() {
      const target = undo.redo(current)
      if (target) current = target
      undo.sync(current)
      return current.input
    },
  }
}

describe("prompt undo grouping", () => {
  test("typing comes back a word at a time, not a letter at a time", () => {
    const r = rig()
    r.type("hello brave world")
    expect(r.undoOnce()).toBe("hello brave ")
    expect(r.undoOnce()).toBe("hello ")
    expect(r.undoOnce()).toBe("")
    expect(r.undoOnce()).toBe("")
  })

  test("a pause starts a new group inside a word", () => {
    const r = rig()
    r.type("hel")
    r.wait(PromptUndoPauseMs + 1)
    r.type("lo")
    expect(r.undoOnce()).toBe("hel")
  })

  test("a newline is a group of its own", () => {
    const r = rig()
    r.type("one")
    r.type("\n")
    r.type("two")
    expect(r.undoOnce()).toBe("one\n")
    expect(r.undoOnce()).toBe("one")
  })

  test("a line delete such as ctrl+u is one step, separate from the typing before it", () => {
    const r = rig()
    r.type("twenty minutes of careful writing")
    r.set("")
    expect(r.undoOnce()).toBe("twenty minutes of careful writing")
    expect(r.undoOnce()).toBe("twenty minutes of careful ")
  })

  test("keys that arrive together still group as typing, and a longer insert is a step of its own", () => {
    const r = rig()
    r.type("hello")
    r.set("hello wo")
    r.set("hello world")
    expect(r.undoOnce()).toBe("hello")
    r.set("hello" + "x".repeat(17))
    expect(r.undoOnce()).toBe("hello")
  })

  test("a paste is one step", () => {
    const r = rig()
    r.type("see ")
    r.set("see a pasted block")
    expect(r.undoOnce()).toBe("see ")
  })

  test("backspaces coalesce, and switching between typing and deleting starts a group", () => {
    const r = rig()
    r.type("abcdef")
    r.backspace(3)
    r.type("xy")
    expect(r.undoOnce()).toBe("abc")
    expect(r.undoOnce()).toBe("abcdef")
    expect(r.undoOnce()).toBe("")
  })

  test("moving the caret ends the group", () => {
    const r = rig()
    r.type("abc")
    r.moveCaret(1)
    r.set("aXbc", { cursor: 2 })
    expect(r.undoOnce()).toBe("abc")
  })

  test("redo walks forward again and a new edit discards it", () => {
    const r = rig()
    r.type("one two")
    r.undoOnce()
    expect(r.redoOnce()).toBe("one two")
    r.undoOnce()
    r.type("x")
    expect(r.redoOnce()).toBe("one x")
  })

  test("keeps only the configured number of steps", () => {
    const r = rig(2)
    r.type("a b c d")
    expect(r.undoOnce()).toBe("a b c ")
    expect(r.undoOnce()).toBe("a b ")
    expect(r.undoOnce()).toBe("a b ")
  })

  test("a submit is undone back to what was sent, with its placeholder parts", () => {
    const r = rig()
    const part = {
      type: "text" as const,
      text: "pasted\ncontent\nhere",
      source: { text: { start: 4, end: 21, value: "[Pasted ~3 lines]" } },
    }
    r.set("see [Pasted ~3 lines] ", { parts: [part] })
    r.set("", { parts: [] })
    r.undoOnce()
    expect(r.redoOnce()).toBe("")
    expect(r.undoOnce()).toBe("see [Pasted ~3 lines] ")
  })

  test("a placeholder's text changing alone is a step", () => {
    const r = rig()
    const part = (text: string) => ({ type: "text" as const, text, source: { text: { start: 0, end: 3, value: "[P]" } } })
    r.set("[P]", { parts: [part("old")] })
    r.set("[P]", { parts: [part("new")] })
    const target = r.undo.undo({ input: "[P]", parts: [part("new")], mode: "normal", cursor: 3 })
    expect(target?.parts).toEqual([part("old")])
  })
})

test("copyPromptParts is unaffected by later edits to the positions it copied", () => {
  const parts = [{ type: "text" as const, text: "x", source: { text: { start: 1, end: 4, value: "[P]" } } }]
  const copy = copyPromptParts(parts)
  parts[0].source.text.start = 9
  expect(copy[0]).toEqual({ type: "text", text: "x", source: { text: { start: 1, end: 4, value: "[P]" } } })
})
