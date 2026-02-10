import { describe, expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { createVimHandler } from "../../../src/cli/cmd/tui/component/vim/vim-handler"
import { createVimState } from "../../../src/cli/cmd/tui/component/vim/vim-state"
import type { VimScroll } from "../../../src/cli/cmd/tui/component/vim/vim-scroll"
import { vimScroll } from "../../../src/cli/cmd/tui/component/vim/vim-scroll"
import type { VimJump } from "../../../src/cli/cmd/tui/component/vim/vim-motion-jump"

function rowColToOffset(text: string, row: number, col: number) {
  let index = 0
  let current = 0
  while (current < row) {
    const next = text.indexOf("\n", index)
    if (next === -1) return text.length
    index = next + 1
    current++
  }
  return Math.min(index + col, text.length)
}

function offsetToRowCol(text: string, offset: number) {
  let row = 0
  let col = 0
  let index = 0
  while (index < offset && index < text.length) {
    if (text[index] === "\n") {
      row++
      col = 0
      index++
      continue
    }
    col++
    index++
  }
  return { row, col }
}

function createTextarea(text: string) {
  const textarea = {
    plainText: text,
    cursorOffset: 0,
    get logicalCursor() {
      return offsetToRowCol(textarea.plainText, textarea.cursorOffset)
    },
    insertText(value: string) {
      const head = textarea.plainText.slice(0, textarea.cursorOffset)
      const tail = textarea.plainText.slice(textarea.cursorOffset)
      textarea.plainText = head + value + tail
      textarea.cursorOffset += value.length
    },
    deleteRange(startRow: number, startCol: number, endRow: number, endCol: number) {
      const start = rowColToOffset(textarea.plainText, startRow, startCol)
      const end = rowColToOffset(textarea.plainText, endRow, endCol)
      textarea.plainText = textarea.plainText.slice(0, start) + textarea.plainText.slice(end)
      textarea.cursorOffset = start
    },
  }
  return textarea as unknown as TextareaRenderable
}

function createEvent(name: string, options?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean }) {
  let prevented = false
  return {
    event: {
      name,
      shift: options?.shift,
      ctrl: options?.ctrl,
      meta: options?.meta,
      super: options?.super,
      preventDefault() {
        prevented = true
      },
    },
    prevented: () => prevented,
  }
}

function createHandler(
  text: string,
  options?: {
    enabled?: boolean
    mode?: "normal" | "insert"
    submit?: () => void
  },
) {
  const textarea = createTextarea(text)
  const [enabled] = createSignal(options?.enabled ?? true)
  const [mode, setMode] = createSignal<"normal" | "insert">(options?.mode ?? "normal")
  const [pending, setPending] = createSignal<"" | "c" | "d" | "g">("")
  const scrollCalls: VimScroll[] = []
  const jumpCalls: VimJump[] = []

  function clearPending() {
    setPending("")
  }

  function changeMode(next: "normal" | "insert") {
    clearPending()
    setMode(next)
  }

  const state: Pick<
    ReturnType<typeof createVimState>,
    "mode" | "setMode" | "reset" | "isInsert" | "pending" | "setPending" | "clearPending"
  > = {
    mode,
    setMode: changeMode,
    pending,
    setPending,
    clearPending,
    reset() {
      clearPending()
      setMode("insert")
    },
    isInsert: () => mode() === "insert",
  }
  const handler = createVimHandler({
    enabled,
    state,
    textarea: () => textarea,
    submit: options?.submit ?? (() => {}),
    scroll(action) {
      scrollCalls.push(action)
    },
    jump(action) {
      jumpCalls.push(action)
    },
  })

  return { textarea, handler, state, scrollCalls, jumpCalls }
}

describe("vim motion handler", () => {
  test("moves with h j k l and clamps to line", () => {
    const ctx = createHandler("abc\nxy")

    ctx.handler.handleKey(createEvent("l").event)
    ctx.handler.handleKey(createEvent("l").event)
    expect(ctx.textarea.cursorOffset).toBe(2)

    ctx.handler.handleKey(createEvent("j").event)
    expect(ctx.textarea.cursorOffset).toBe(5)

    ctx.handler.handleKey(createEvent("h").event)
    expect(ctx.textarea.cursorOffset).toBe(4)

    ctx.handler.handleKey(createEvent("k").event)
    expect(ctx.textarea.cursorOffset).toBe(0)
  })

  test("supports word and big-word key shapes", () => {
    const ctx = createHandler("foo,bar baz")

    const w = createEvent("w")
    expect(ctx.handler.handleKey(w.event)).toBe(true)
    expect(w.prevented()).toBe(true)
    expect(ctx.textarea.cursorOffset).toBe(4)

    const upperW = createEvent("W")
    expect(ctx.handler.handleKey(upperW.event)).toBe(true)
    expect(upperW.prevented()).toBe(true)
    expect(ctx.textarea.cursorOffset).toBe(8)

    ctx.textarea.cursorOffset = 0
    const shiftW = createEvent("w", { shift: true })
    expect(ctx.handler.handleKey(shiftW.event)).toBe(true)
    expect(shiftW.prevented()).toBe(true)
    expect(ctx.textarea.cursorOffset).toBe(8)

    const upperE = createEvent("E")
    expect(ctx.handler.handleKey(upperE.event)).toBe(true)
    expect(upperE.prevented()).toBe(true)
    expect(ctx.textarea.cursorOffset).toBe(10)

    const upperB = createEvent("B")
    expect(ctx.handler.handleKey(upperB.event)).toBe(true)
    expect(upperB.prevented()).toBe(true)
    expect(ctx.textarea.cursorOffset).toBe(8)
  })

  test("e stays on single-char word", () => {
    const ctx = createHandler("a")
    ctx.textarea.cursorOffset = 0
    ctx.handler.handleKey(createEvent("e").event)
    expect(ctx.textarea.cursorOffset).toBe(0)
  })

  test("e from end of word moves to next word end", () => {
    const ctx = createHandler("a b")
    ctx.textarea.cursorOffset = 0
    ctx.handler.handleKey(createEvent("e").event)
    expect(ctx.textarea.cursorOffset).toBe(2)
  })

  test("e from word end moves to next word end", () => {
    const ctx = createHandler("ab cd")
    ctx.textarea.cursorOffset = 1
    ctx.handler.handleKey(createEvent("e").event)
    expect(ctx.textarea.cursorOffset).toBe(4)
  })

  test("e from whitespace moves to next word end", () => {
    const ctx = createHandler("ab  cd")
    ctx.textarea.cursorOffset = 2
    ctx.handler.handleKey(createEvent("e").event)
    expect(ctx.textarea.cursorOffset).toBe(5)
  })

  test("0 moves to line beginning", () => {
    const ctx = createHandler("  hello")
    ctx.textarea.cursorOffset = 4
    ctx.handler.handleKey(createEvent("0").event)
    expect(ctx.textarea.cursorOffset).toBe(0)
  })

  test("0 on multiline moves to current line start", () => {
    const ctx = createHandler("abc\n  def")
    ctx.textarea.cursorOffset = 7
    ctx.handler.handleKey(createEvent("0").event)
    expect(ctx.textarea.cursorOffset).toBe(4)
  })

  test("^ moves to first non-whitespace", () => {
    const ctx = createHandler("  hello")
    ctx.textarea.cursorOffset = 5
    ctx.handler.handleKey(createEvent("^").event)
    expect(ctx.textarea.cursorOffset).toBe(2)
  })

  test("^ on line with no leading whitespace goes to column 0", () => {
    const ctx = createHandler("hello")
    ctx.textarea.cursorOffset = 3
    ctx.handler.handleKey(createEvent("^").event)
    expect(ctx.textarea.cursorOffset).toBe(0)
  })

  test("$ moves to last char of line", () => {
    const ctx = createHandler("hello")
    ctx.textarea.cursorOffset = 0
    ctx.handler.handleKey(createEvent("$").event)
    expect(ctx.textarea.cursorOffset).toBe(4)
  })

  test("$ on multiline moves to last char of current line", () => {
    const ctx = createHandler("abc\ndef")
    ctx.textarea.cursorOffset = 0
    ctx.handler.handleKey(createEvent("$").event)
    expect(ctx.textarea.cursorOffset).toBe(2)
  })

  test("$ on single char stays put", () => {
    const ctx = createHandler("a")
    ctx.textarea.cursorOffset = 0
    ctx.handler.handleKey(createEvent("$").event)
    expect(ctx.textarea.cursorOffset).toBe(0)
  })

  test("supports insert transitions for A I O", () => {
    const i0 = createHandler("abc")
    i0.textarea.cursorOffset = 1
    expect(i0.handler.handleKey(createEvent("i").event)).toBe(true)
    expect(i0.state.mode()).toBe("insert")
    expect(i0.textarea.cursorOffset).toBe(1)

    const i = createHandler("  abc")
    i.textarea.cursorOffset = 1
    expect(i.handler.handleKey(createEvent("I").event)).toBe(true)
    expect(i.state.mode()).toBe("insert")
    expect(i.textarea.cursorOffset).toBe(2)

    const a = createHandler("  abc")
    a.textarea.cursorOffset = 1
    expect(a.handler.handleKey(createEvent("A").event)).toBe(true)
    expect(a.state.mode()).toBe("insert")
    expect(a.textarea.cursorOffset).toBe(5)

    const o = createHandler("abc")
    o.textarea.cursorOffset = 1
    expect(o.handler.handleKey(createEvent("o", { shift: true }).event)).toBe(true)
    expect(o.state.mode()).toBe("insert")
    expect(o.textarea.plainText).toBe("\nabc")
  })

  test("x deletes under cursor and no-ops at end", () => {
    const a = createHandler("abc")
    a.textarea.cursorOffset = 1
    const x = createEvent("x")
    expect(a.handler.handleKey(x.event)).toBe(true)
    expect(x.prevented()).toBe(true)
    expect(a.textarea.plainText).toBe("ac")

    const b = createHandler("ab\ncd")
    b.textarea.cursorOffset = 2
    expect(b.handler.handleKey(createEvent("x").event)).toBe(true)
    expect(b.textarea.plainText).toBe("ab\ncd")
  })

  test("S clears current line and enters insert", () => {
    const ctx = createHandler("one\ntwo\nthree")
    ctx.textarea.cursorOffset = 5
    const s = createEvent("S")

    expect(ctx.handler.handleKey(s.event)).toBe(true)
    expect(s.prevented()).toBe(true)
    expect(ctx.state.mode()).toBe("insert")
    expect(ctx.textarea.plainText).toBe("one\n\nthree")
    expect(ctx.textarea.cursorOffset).toBe(4)
  })

  test("S clears single line", () => {
    const ctx = createHandler("abc")
    const s = createEvent("S")

    expect(ctx.handler.handleKey(s.event)).toBe(true)
    expect(s.prevented()).toBe(true)
    expect(ctx.state.mode()).toBe("insert")
    expect(ctx.textarea.plainText).toBe("")
    expect(ctx.textarea.cursorOffset).toBe(0)
  })

  test("S keeps empty buffer", () => {
    const ctx = createHandler("")
    const s = createEvent("S")

    expect(ctx.handler.handleKey(s.event)).toBe(true)
    expect(s.prevented()).toBe(true)
    expect(ctx.state.mode()).toBe("insert")
    expect(ctx.textarea.plainText).toBe("")
    expect(ctx.textarea.cursorOffset).toBe(0)
  })

  test("cc clears current line and enters insert", () => {
    const ctx = createHandler("one\ntwo\nthree")
    ctx.textarea.cursorOffset = 5

    const c1 = createEvent("c")
    expect(ctx.handler.handleKey(c1.event)).toBe(true)
    expect(c1.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("c")

    const c2 = createEvent("c")
    expect(ctx.handler.handleKey(c2.event)).toBe(true)
    expect(c2.prevented()).toBe(true)
    expect(ctx.state.mode()).toBe("insert")
    expect(ctx.textarea.plainText).toBe("one\n\nthree")
    expect(ctx.textarea.cursorOffset).toBe(4)
    expect(ctx.state.pending()).toBe("")
  })

  test("cw deletes to next word and enters insert", () => {
    const ctx = createHandler("hello world test")
    ctx.textarea.cursorOffset = 0

    const c = createEvent("c")
    expect(ctx.handler.handleKey(c.event)).toBe(true)
    expect(ctx.state.pending()).toBe("c")

    const w = createEvent("w")
    expect(ctx.handler.handleKey(w.event)).toBe(true)
    expect(w.prevented()).toBe(true)
    expect(ctx.textarea.plainText).toBe("world test")
    expect(ctx.textarea.cursorOffset).toBe(0)
    expect(ctx.state.mode()).toBe("insert")
    expect(ctx.state.pending()).toBe("")
  })

  test("pending c clears on escape", () => {
    const ctx = createHandler("hello world")

    expect(ctx.handler.handleKey(createEvent("c").event)).toBe(true)
    expect(ctx.state.pending()).toBe("c")

    const esc = createEvent("escape")
    expect(ctx.handler.handleKey(esc.event)).toBe(true)
    expect(esc.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("")
    expect(ctx.textarea.plainText).toBe("hello world")
  })

  test("pending c clears on modifier key", () => {
    const ctx = createHandler("abc")

    expect(ctx.handler.handleKey(createEvent("c").event)).toBe(true)
    expect(ctx.state.pending()).toBe("c")

    const mod = createEvent("j", { ctrl: true })
    expect(ctx.handler.handleKey(mod.event)).toBe(false)
    expect(mod.prevented()).toBe(false)
    expect(ctx.state.pending()).toBe("")
  })

  test("insert mode only handles escape", () => {
    const ctx = createHandler("abc", { mode: "insert" })

    const w = createEvent("w")
    expect(ctx.handler.handleKey(w.event)).toBe(false)
    expect(w.prevented()).toBe(false)

    const esc = createEvent("escape")
    expect(ctx.handler.handleKey(esc.event)).toBe(true)
    expect(esc.prevented()).toBe(true)
    expect(ctx.state.mode()).toBe("normal")
  })

  test("submit from normal keeps mode and clears pending", () => {
    let calls = 0
    const ctx = createHandler("", {
      mode: "normal",
      submit() {
        calls++
      },
    })
    ctx.state.setPending("d")

    ctx.handler.handleKey(createEvent("return").event)

    expect(calls).toBe(1)
    expect(ctx.state.mode()).toBe("normal")
    expect(ctx.state.pending()).toBe("")
  })

  test("vim disabled does not intercept keys", () => {
    const ctx = createHandler("abc", { enabled: false })
    const keys = [
      createEvent("h"),
      createEvent("x"),
      createEvent("d"),
      createEvent("g"),
      createEvent("d", { ctrl: true }),
    ]

    for (const key of keys) {
      expect(ctx.handler.handleKey(key.event)).toBe(false)
      expect(key.prevented()).toBe(false)
    }

    expect(ctx.scrollCalls.length).toBe(0)
    expect(ctx.jumpCalls.length).toBe(0)
  })

  test("dd deletes current line", () => {
    const ctx = createHandler("one\ntwo\nthree")
    ctx.textarea.cursorOffset = 5

    const d1 = createEvent("d")
    expect(ctx.handler.handleKey(d1.event)).toBe(true)
    expect(d1.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const d2 = createEvent("d")
    expect(ctx.handler.handleKey(d2.event)).toBe(true)
    expect(d2.prevented()).toBe(true)
    expect(ctx.textarea.plainText).toBe("one\nthree")
    expect(ctx.textarea.cursorOffset).toBe(4)
    expect(ctx.state.pending()).toBe("")
  })

  test("dd on last line lands at resulting line start", () => {
    const ctx = createHandler("one\ntwo")
    ctx.textarea.cursorOffset = 5

    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.textarea.plainText).toBe("one")
    expect(ctx.textarea.cursorOffset).toBe(0)
  })

  test("dw deletes to next word and clears pending", () => {
    const ctx = createHandler("hello world test")
    ctx.textarea.cursorOffset = 0

    const d = createEvent("d")
    expect(ctx.handler.handleKey(d.event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const w = createEvent("w")
    expect(ctx.handler.handleKey(w.event)).toBe(true)
    expect(w.prevented()).toBe(true)
    expect(ctx.textarea.plainText).toBe("world test")
    expect(ctx.textarea.cursorOffset).toBe(0)
    expect(ctx.state.pending()).toBe("")
  })

  test("pending d clears on escape", () => {
    const ctx = createHandler("hello world")

    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const esc = createEvent("escape")
    expect(ctx.handler.handleKey(esc.event)).toBe(true)
    expect(esc.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("")
    expect(ctx.textarea.plainText).toBe("hello world")
  })

  test("pending d clears on invalid key and key is handled normally", () => {
    const ctx = createHandler("abc")

    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const i = createEvent("i")
    expect(ctx.handler.handleKey(i.event)).toBe(true)
    expect(i.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("")
    expect(ctx.state.mode()).toBe("insert")
  })

  test("mode switch clears pending state", () => {
    const ctx = createHandler("abc")
    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    expect(ctx.handler.handleKey(createEvent("i").event)).toBe(true)
    expect(ctx.state.mode()).toBe("insert")
    expect(ctx.state.pending()).toBe("")

    expect(ctx.handler.handleKey(createEvent("escape").event)).toBe(true)
    expect(ctx.state.mode()).toBe("normal")
    expect(ctx.state.pending()).toBe("")

    const h = createEvent("h")
    expect(ctx.handler.handleKey(h.event)).toBe(true)
    expect(h.prevented()).toBe(true)
  })

  test("pending d clears on modifier key and event is not consumed", () => {
    const ctx = createHandler("abc")

    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const mod = createEvent("j", { ctrl: true })
    expect(ctx.handler.handleKey(mod.event)).toBe(false)
    expect(mod.prevented()).toBe(false)
    expect(ctx.state.pending()).toBe("")
  })

  test("ctrl scroll keys trigger actions", () => {
    const ctx = createHandler("abc")
    const keys: Array<[string, VimScroll]> = [
      ["e", "line-down"],
      ["y", "line-up"],
      ["d", "half-down"],
      ["u", "half-up"],
      ["f", "page-down"],
      ["b", "page-up"],
    ]

    for (const [key, action] of keys) {
      const evt = createEvent(key, { ctrl: true })
      expect(ctx.handler.handleKey(evt.event)).toBe(true)
      expect(evt.prevented()).toBe(true)
      expect(ctx.scrollCalls.at(-1)).toBe(action)
    }
  })

  test("ctrl scroll clears pending operator", () => {
    const ctx = createHandler("abc")
    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const evt = createEvent("d", { ctrl: true })
    expect(ctx.handler.handleKey(evt.event)).toBe(true)
    expect(evt.prevented()).toBe(true)
    expect(ctx.scrollCalls.at(-1)).toBe("half-down")
    expect(ctx.state.pending()).toBe("")
  })

  test("ctrl scroll not handled in insert mode", () => {
    const ctx = createHandler("abc", { mode: "insert" })
    const evt = createEvent("e", { ctrl: true })
    expect(ctx.handler.handleKey(evt.event)).toBe(false)
    expect(evt.prevented()).toBe(false)
    expect(ctx.scrollCalls.length).toBe(0)
  })

  test("ctrl scroll not handled when vim disabled", () => {
    const ctx = createHandler("abc", { enabled: false })
    const evt = createEvent("e", { ctrl: true })
    expect(ctx.handler.handleKey(evt.event)).toBe(false)
    expect(evt.prevented()).toBe(false)
    expect(ctx.scrollCalls.length).toBe(0)
  })

  test("g and G jump to top or bottom", () => {
    const ctx = createHandler("abc")

    const g = createEvent("g")
    expect(ctx.handler.handleKey(g.event)).toBe(true)
    expect(g.prevented()).toBe(true)
    expect(ctx.jumpCalls.length).toBe(0)
    expect(ctx.state.pending()).toBe("g")

    const g2 = createEvent("g")
    expect(ctx.handler.handleKey(g2.event)).toBe(true)
    expect(g2.prevented()).toBe(true)
    expect(ctx.jumpCalls.at(-1)).toBe("top")
    expect(ctx.state.pending()).toBe("")

    const G = createEvent("G")
    expect(ctx.handler.handleKey(G.event)).toBe(true)
    expect(G.prevented()).toBe(true)
    expect(ctx.jumpCalls.at(-1)).toBe("bottom")
  })

  test("pending g cancels on other keys", () => {
    const ctx = createHandler("abc")
    expect(ctx.handler.handleKey(createEvent("g").event)).toBe(true)
    expect(ctx.state.pending()).toBe("g")

    const w = createEvent("w")
    expect(ctx.handler.handleKey(w.event)).toBe(true)
    expect(w.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("")
  })

  test("pending transition d to g", () => {
    const ctx = createHandler("abc")
    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const g = createEvent("g")
    expect(ctx.handler.handleKey(g.event)).toBe(true)
    expect(g.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("g")

    const g2 = createEvent("g")
    expect(ctx.handler.handleKey(g2.event)).toBe(true)
    expect(g2.prevented()).toBe(true)
    expect(ctx.jumpCalls.at(-1)).toBe("top")
    expect(ctx.scrollCalls.length).toBe(0)
    expect(ctx.state.pending()).toBe("")
  })

  test("pending d then G clears and jumps", () => {
    const ctx = createHandler("abc")
    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const G = createEvent("G")
    expect(ctx.handler.handleKey(G.event)).toBe(true)
    expect(G.prevented()).toBe(true)
    expect(ctx.jumpCalls.at(-1)).toBe("bottom")
    expect(ctx.state.pending()).toBe("")
  })

  test("g not handled in insert mode", () => {
    const ctx = createHandler("abc", { mode: "insert" })
    const g = createEvent("g")
    expect(ctx.handler.handleKey(g.event)).toBe(false)
    expect(g.prevented()).toBe(false)
    expect(ctx.jumpCalls.length).toBe(0)
  })

  test("g not handled when vim disabled", () => {
    const ctx = createHandler("abc", { enabled: false })
    const g = createEvent("g")
    expect(ctx.handler.handleKey(g.event)).toBe(false)
    expect(g.prevented()).toBe(false)
    expect(ctx.jumpCalls.length).toBe(0)
  })

  test("repeated ctrl scroll keeps pending clear", () => {
    const ctx = createHandler("abc")
    expect(ctx.handler.handleKey(createEvent("d").event)).toBe(true)
    expect(ctx.state.pending()).toBe("d")

    const first = createEvent("d", { ctrl: true })
    expect(ctx.handler.handleKey(first.event)).toBe(true)
    expect(first.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("")

    const second = createEvent("d", { ctrl: true })
    expect(ctx.handler.handleKey(second.event)).toBe(true)
    expect(second.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("")

    expect(ctx.scrollCalls).toEqual(["half-down", "half-down"])
  })

  test("repeated G does not create pending", () => {
    const ctx = createHandler("abc")

    const first = createEvent("G")
    expect(ctx.handler.handleKey(first.event)).toBe(true)
    expect(first.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("")

    const second = createEvent("G")
    expect(ctx.handler.handleKey(second.event)).toBe(true)
    expect(second.prevented()).toBe(true)
    expect(ctx.state.pending()).toBe("")

    expect(ctx.jumpCalls).toEqual(["bottom", "bottom"])
  })
})

describe("vim scroll mapping", () => {
  test("vimScroll maps ctrl keys to actions", () => {
    expect(vimScroll(createEvent("e", { ctrl: true }).event)).toBe("line-down")
    expect(vimScroll(createEvent("y", { ctrl: true }).event)).toBe("line-up")
    expect(vimScroll(createEvent("d", { ctrl: true }).event)).toBe("half-down")
    expect(vimScroll(createEvent("u", { ctrl: true }).event)).toBe("half-up")
    expect(vimScroll(createEvent("f", { ctrl: true }).event)).toBe("page-down")
    expect(vimScroll(createEvent("b", { ctrl: true }).event)).toBe("page-up")
    expect(vimScroll(createEvent("b", { ctrl: true, meta: true }).event)).toBe(undefined)
    expect(vimScroll(createEvent("b", { ctrl: false }).event)).toBe(undefined)
  })
})
