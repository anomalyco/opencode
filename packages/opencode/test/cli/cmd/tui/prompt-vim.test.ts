import { describe, expect, test } from "bun:test"
import { createVimTextareaBindings, handleVimPromptKeyDown, type PromptKeyEvent, type VimLastFind, type VimMode, type VimPendingFind, type VimPendingOperator, type VimRuntime } from "../../../../src/cli/cmd/tui/component/prompt/vim"

type State = {
  text: string
  cursor: number
  enabled: boolean
  mode: VimMode
  pendingG: boolean
  pendingOperator: VimPendingOperator | undefined
  pendingFind: VimPendingFind | undefined
  lastFind: VimLastFind | undefined
  markers: string[]
}

function runtime(state: State): VimRuntime {
  return {
    get text() {
      return state.text
    },
    get cursor() {
      return state.cursor
    },
    get enabled() {
      return state.enabled
    },
    get mode() {
      return state.mode
    },
    get pendingG() {
      return state.pendingG
    },
    get pendingOperator() {
      return state.pendingOperator
    },
    get pendingFind() {
      return state.pendingFind
    },
    get lastFind() {
      return state.lastFind
    },
    setMode(mode) {
      state.mode = mode
    },
    setPendingG(value) {
      state.pendingG = value
    },
    setPendingOperator(value) {
      state.pendingOperator = value
    },
    setPendingFind(value) {
      state.pendingFind = value
    },
    setLastFind(value) {
      state.lastFind = value
    },
    moveCursor(offset) {
      state.cursor = Math.max(0, Math.min(offset, state.text.length))
    },
    replaceText(text) {
      state.text = text
    },
    syncPromptInput() {},
    writeMarker(phase) {
      state.markers.push(phase)
    },
  }
}

function createState(overrides: Partial<State> = {}): State {
  return { text: "", cursor: 0, enabled: true, mode: "normal", pendingG: false, pendingOperator: undefined, pendingFind: undefined, lastFind: undefined, markers: [], ...overrides }
}

function pressKeys(target: State, keys: string[]) {
  for (const key of keys) handleVimPromptKeyDown(event(key), runtime(target))
}

function event(name: string, opts: Partial<PromptKeyEvent> = {}) {
  let prevented = false
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    preventDefault() {
      prevented = true
    },
    get prevented() {
      return prevented
    },
    ...opts,
  }
}

describe("prompt vim", () => {
  test("textarea bindings exist only in normal mode", () => {
    expect(createVimTextareaBindings(true, "normal").map((item) => item.name)).toEqual(["return"])
    expect(createVimTextareaBindings(true, "insert")).toEqual([])
    expect(createVimTextareaBindings(false, "normal")).toEqual([])
  })

  test("escape exits insert mode and shifts cursor left by one", () => {
    const state: State = createState({ text: "hello", cursor: 5, mode: "insert" })
    const e = event("escape")
    handleVimPromptKeyDown(e, runtime(state))
    expect(state.mode).toBe("normal")
    expect(state.cursor).toBe(4)
    expect(state.markers).toContain("normal")
  })

  test("i, I, a, A enter insert at correct positions", () => {
    const start = (): State => createState({ text: "  abc", cursor: 4 })

    const iState = start()
    handleVimPromptKeyDown(event("i"), runtime(iState))
    expect(iState.mode).toBe("insert")
    expect(iState.cursor).toBe(4)

    const IState = start()
    handleVimPromptKeyDown(event("i", { shift: true }), runtime(IState))
    expect(IState.mode).toBe("insert")
    expect(IState.cursor).toBe(2)

    const aState = start()
    handleVimPromptKeyDown(event("a"), runtime(aState))
    expect(aState.mode).toBe("insert")
    expect(aState.cursor).toBe(5)

    const AState = start()
    handleVimPromptKeyDown(event("a", { shift: true }), runtime(AState))
    expect(AState.mode).toBe("insert")
    expect(AState.cursor).toBe(5)
  })

  test("word motions b/B and e/E move to expected offsets", () => {
    const wState: State = createState({ text: "alpha beta", cursor: 0 })
    handleVimPromptKeyDown(event("w"), runtime(wState))
    expect(wState.cursor).toBe(6)

    const bState: State = createState({ text: "alpha beta", cursor: 9 })
    handleVimPromptKeyDown(event("b"), runtime(bState))
    expect(bState.cursor).toBe(6)

    const BState: State = createState({ text: "alpha beta", cursor: 9 })
    handleVimPromptKeyDown(event("b", { shift: true }), runtime(BState))
    expect(BState.cursor).toBe(6)

    const eState: State = createState({ text: "alpha beta", cursor: 6 })
    handleVimPromptKeyDown(event("e"), runtime(eState))
    expect(eState.cursor).toBe(9)

    const EState: State = createState({ text: "alpha beta", cursor: 6 })
    handleVimPromptKeyDown(event("e", { shift: true }), runtime(EState))
    expect(EState.cursor).toBe(9)
  })

  test("line motions 0, caret, and dollar move to expected offsets", () => {
    const startState = createState({ text: "  alpha beta", cursor: 8 })
    handleVimPromptKeyDown(event("0"), runtime(startState))
    expect(startState.cursor).toBe(0)

    const firstTextState = createState({ text: "  alpha beta", cursor: 8 })
    handleVimPromptKeyDown(event("6", { shift: true }), runtime(firstTextState))
    expect(firstTextState.cursor).toBe(2)

    const endState = createState({ text: "  alpha beta", cursor: 2 })
    handleVimPromptKeyDown(event("4", { shift: true }), runtime(endState))
    expect(endState.cursor).toBe(12)
  })

  test("o and O open lines and enter insert", () => {
    const below: State = createState({ text: "alpha", cursor: 4 })
    handleVimPromptKeyDown(event("o"), runtime(below))
    expect(below.text).toBe("alpha\n")
    expect(below.mode).toBe("insert")
    expect(below.cursor).toBe(6)

    const above: State = createState({ text: "alpha", cursor: 4 })
    handleVimPromptKeyDown(event("o", { shift: true }), runtime(above))
    expect(above.text).toBe("\nalpha")
    expect(above.mode).toBe("insert")
    expect(above.cursor).toBe(0)
  })

  test("gg and G move to start and end", () => {
    const ggState: State = createState({ text: "a\nb\nc", cursor: 4 })
    handleVimPromptKeyDown(event("g"), runtime(ggState))
    expect(ggState.pendingG).toBe(true)
    handleVimPromptKeyDown(event("g"), runtime(ggState))
    expect(ggState.cursor).toBe(0)
    expect(ggState.pendingG).toBe(false)

    const GState: State = createState({ text: "a\nb\nc", cursor: 0 })
    handleVimPromptKeyDown(event("g", { shift: true }), runtime(GState))
    expect(GState.cursor).toBe(5)
  })

  test("ctrl+d and ctrl+u move across lines", () => {
    const state: State = createState({ text: "a\nb\nc\nd\ne", cursor: 0 })
    handleVimPromptKeyDown(event("d", { ctrl: true }), runtime(state))
    expect(state.cursor).toBe(6)
    handleVimPromptKeyDown(event("u", { ctrl: true }), runtime(state))
    expect(state.cursor).toBe(0)
  })

  test("disabled vim does nothing", () => {
    const state: State = createState({ text: "hello", cursor: 5, enabled: false })
    handleVimPromptKeyDown(event("i"), runtime(state))
    expect(state.mode).toBe("normal")
    expect(state.cursor).toBe(5)
  })

  test("disabled vim clears pending operator without editing", () => {
    const disabled = createState({ text: "alpha beta", cursor: 7, enabled: false, pendingOperator: { op: "delete" } })
    handleVimPromptKeyDown(event("w"), runtime(disabled))
    expect(disabled.text).toBe("alpha beta")
    expect(disabled.cursor).toBe(7)
    expect(disabled.mode).toBe("normal")
    expect(disabled.pendingOperator).toBeUndefined()
  })

  test("delete and change operators execute word text objects", () => {
    const deleteInnerWord = createState({ text: "alpha beta gamma", cursor: 7 })
    pressKeys(deleteInnerWord, ["d", "i", "w"])
    expect(deleteInnerWord.text).toBe("alpha  gamma")
    expect(deleteInnerWord.cursor).toBe(6)
    expect(deleteInnerWord.mode).toBe("normal")
    expect(deleteInnerWord.pendingOperator).toBeUndefined()

    const changeInnerWord = createState({ text: "alpha beta gamma", cursor: 7 })
    pressKeys(changeInnerWord, ["c", "i", "w"])
    expect(changeInnerWord.text).toBe("alpha  gamma")
    expect(changeInnerWord.cursor).toBe(6)
    expect(changeInnerWord.mode).toBe("insert")
    expect(changeInnerWord.pendingOperator).toBeUndefined()

    const deleteAroundWord = createState({ text: "alpha beta gamma", cursor: 7 })
    pressKeys(deleteAroundWord, ["d", "a", "w"])
    expect(deleteAroundWord.text).toBe("alpha gamma")
    expect(deleteAroundWord.cursor).toBe(6)
    expect(deleteAroundWord.mode).toBe("normal")
    expect(deleteAroundWord.pendingOperator).toBeUndefined()

    const changeAroundWord = createState({ text: "alpha beta gamma", cursor: 7 })
    pressKeys(changeAroundWord, ["c", "a", "w"])
    expect(changeAroundWord.text).toBe("alpha gamma")
    expect(changeAroundWord.cursor).toBe(6)
    expect(changeAroundWord.mode).toBe("insert")
    expect(changeAroundWord.pendingOperator).toBeUndefined()
  })

  test("delete operator executes e and b motions", () => {
    const deleteToEnd = createState({ text: "alpha beta gamma", cursor: 6 })
    pressKeys(deleteToEnd, ["d", "e"])
    expect(deleteToEnd.text).toBe("alpha  gamma")
    expect(deleteToEnd.cursor).toBe(6)
    expect(deleteToEnd.mode).toBe("normal")
    expect(deleteToEnd.pendingOperator).toBeUndefined()

    const deleteBack = createState({ text: "alpha beta gamma", cursor: 9 })
    pressKeys(deleteBack, ["d", "b"])
    expect(deleteBack.text).toBe("alpha a gamma")
    expect(deleteBack.cursor).toBe(6)
    expect(deleteBack.mode).toBe("normal")
    expect(deleteBack.pendingOperator).toBeUndefined()
  })

  test("pending operator cancels on escape and invalid keys", () => {
    const escapeState = createState({ text: "alpha beta", cursor: 6 })
    pressKeys(escapeState, ["d", "escape"])
    expect(escapeState.text).toBe("alpha beta")
    expect(escapeState.cursor).toBe(6)
    expect(escapeState.pendingOperator).toBeUndefined()

    const invalidState = createState({ text: "alpha beta", cursor: 6 })
    pressKeys(invalidState, ["d", "z"])
    expect(invalidState.text).toBe("alpha beta")
    expect(invalidState.cursor).toBe(6)
    expect(invalidState.pendingOperator).toBeUndefined()
  })

  test("normal find motions and repeat find match Vim f/t behavior", () => {
    const forwardTo = createState({ text: "alpha; beta; gamma", cursor: 0 })
    pressKeys(forwardTo, ["f", ";"])
    expect(forwardTo.cursor).toBe(5)
    expect(forwardTo.lastFind).toEqual({ find: "f", char: ";" })

    pressKeys(forwardTo, [";"])
    expect(forwardTo.cursor).toBe(11)
    pressKeys(forwardTo, [","])
    expect(forwardTo.cursor).toBe(5)

    const forwardTill = createState({ text: "alpha; beta", cursor: 0 })
    pressKeys(forwardTill, ["t", ";"])
    expect(forwardTill.cursor).toBe(4)

    const repeatForwardTill = createState({ text: "alpha; beta; gamma", cursor: 0 })
    pressKeys(repeatForwardTill, ["t", ";", ";", ","])
    expect(repeatForwardTill.cursor).toBe(6)

    const backwardTo = createState({ text: "alpha; beta", cursor: 10 })
    handleVimPromptKeyDown(event("f", { shift: true }), runtime(backwardTo))
    handleVimPromptKeyDown(event(";"), runtime(backwardTo))
    expect(backwardTo.cursor).toBe(5)

    const backwardTill = createState({ text: "alpha; beta", cursor: 10 })
    handleVimPromptKeyDown(event("t", { shift: true }), runtime(backwardTill))
    handleVimPromptKeyDown(event(";"), runtime(backwardTill))
    expect(backwardTill.cursor).toBe(6)
  })

  test("delete operator executes find motions", () => {
    const deleteFind = createState({ text: "alpha; beta", cursor: 0 })
    pressKeys(deleteFind, ["d", "f", ";"])
    expect(deleteFind.text).toBe(" beta")
    expect(deleteFind.cursor).toBe(0)
    expect(deleteFind.mode).toBe("normal")
    expect(deleteFind.lastFind).toEqual({ find: "f", char: ";" })
    expect(deleteFind.pendingOperator).toBeUndefined()

    const deleteTill = createState({ text: "alpha; beta", cursor: 0 })
    pressKeys(deleteTill, ["d", "t", ";"])
    expect(deleteTill.text).toBe("; beta")
    expect(deleteTill.cursor).toBe(0)
    expect(deleteTill.mode).toBe("normal")
    expect(deleteTill.lastFind).toEqual({ find: "t", char: ";" })
    expect(deleteTill.pendingOperator).toBeUndefined()

    const deleteBackwardFind = createState({ text: "alpha; beta", cursor: 10 })
    handleVimPromptKeyDown(event("d"), runtime(deleteBackwardFind))
    handleVimPromptKeyDown(event("f", { shift: true }), runtime(deleteBackwardFind))
    handleVimPromptKeyDown(event(";"), runtime(deleteBackwardFind))
    expect(deleteBackwardFind.text).toBe("alpha")
    expect(deleteBackwardFind.cursor).toBe(5)
    expect(deleteBackwardFind.lastFind).toEqual({ find: "F", char: ";" })
    expect(deleteBackwardFind.pendingOperator).toBeUndefined()

    const deleteBackwardTill = createState({ text: "alpha; beta", cursor: 10 })
    handleVimPromptKeyDown(event("d"), runtime(deleteBackwardTill))
    handleVimPromptKeyDown(event("t", { shift: true }), runtime(deleteBackwardTill))
    handleVimPromptKeyDown(event(";"), runtime(deleteBackwardTill))
    expect(deleteBackwardTill.text).toBe("alpha;")
    expect(deleteBackwardTill.cursor).toBe(6)
    expect(deleteBackwardTill.lastFind).toEqual({ find: "T", char: ";" })
    expect(deleteBackwardTill.pendingOperator).toBeUndefined()
  })
})
