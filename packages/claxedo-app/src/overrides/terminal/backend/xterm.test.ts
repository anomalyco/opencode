import { beforeEach, describe, expect, mock, test } from "bun:test"

let writes: string[] = []
let bracketed: (() => boolean) | undefined

const xterm = {
  cols: 80,
  rows: 24,
  options: {} as Record<string, unknown>,
  textarea: null as HTMLTextAreaElement | null,
  element: null as HTMLElement | null,
  buffer: {
    active: {
      viewportY: 0,
      baseY: 0,
    },
  },
  loadAddon() {},
  write(data: string, callback?: () => void) {
    writes.push(data)
    callback?.()
  },
  onData() {
    return { dispose() {} }
  },
  onKey() {
    return { dispose() {} }
  },
  focus() {},
  getSelection() {
    return ""
  },
  hasSelection() {
    return false
  },
  scrollToLine() {},
  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  },
  refresh() {},
  dispose() {},
}

mock.module("@xterm/addon-serialize", () => ({
  SerializeAddon: class {
    serialize() {
      return ""
    }
  },
}))

mock.module("@xterm/xterm/css/xterm.css", () => ({}))
mock.module("../terminal.css", () => ({}))

mock.module("../helpers", () => ({
  createTerminalInstance: () => ({
    xterm,
    fitAddon: { fit() {} },
    cleanup() {},
  }),
  setupKeyboardHandler: () => () => {},
  setupPasteHandler: (_xterm: unknown, input: { isBracketedPasteEnabled: () => boolean }) => {
    bracketed = input.isBracketedPasteEnabled
    return () => {}
  },
  setupCopyHandler: () => () => {},
  setupResizeHandlers: () => () => {},
  scrollToBottom: () => {},
}))

const { createBackend } = await import("./xterm")

beforeEach(() => {
  writes = []
  bracketed = undefined
})

describe("xterm backend integration", () => {
  test("suppresses query responses through backend write path", async () => {
    const container = document.createElement("div")
    const backend = await createBackend(container, { theme: {}, fontFamily: "mono" })

    backend.write("a")
    backend.write("\u001b[12;")
    backend.write("34R")
    backend.write("\u001b[I")
    backend.write("\u001b[?2004;1$y")
    backend.write("b")

    expect(writes.join("")).toBe("ab")
    backend.dispose()
  })

  test("tracks bracketed paste mode across split chunks through backend write path", async () => {
    const container = document.createElement("div")
    const backend = await createBackend(container, { theme: {}, fontFamily: "mono" })

    expect(bracketed?.()).toBe(false)
    backend.write("xx\u001b[?20")
    backend.write("04hyy")
    expect(bracketed?.()).toBe(true)

    backend.write("\u001b[?2004l")
    expect(bracketed?.()).toBe(false)
    backend.dispose()
  })
})
