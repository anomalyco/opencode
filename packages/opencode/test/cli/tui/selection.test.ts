import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { BoxRenderable, CodeRenderable, SyntaxStyle, TextRenderable, type Renderable } from "@opentui/core"

const copy = mock(async (_text: string) => {})

mock.module("../../../src/cli/cmd/tui/util/clipboard", () => ({
  Clipboard: {
    copy,
  },
}))

const { Selection } = await import("../../../src/cli/cmd/tui/util/selection")

function evt(target: Renderable, x: number, y: number) {
  return {
    button: 0,
    target,
    x,
    y,
    preventDefault() {},
    stopPropagation() {},
  }
}

function toast() {
  return {
    show: mock(() => {}),
    error: mock(() => {}),
  }
}

async function scene(opts?: { content?: string; width?: number; height?: number }) {
  const view = await createTestRenderer({
    width: 30,
    height: 5,
    autoFocus: false,
    useConsole: false,
  })
  const text = new TextRenderable(view.renderer, {
    content: opts?.content ?? "hello world",
    width: opts?.width ?? 11,
    height: opts?.height ?? 1,
    wrapMode: "word",
  })
  view.renderer.root.add(text)
  await view.renderOnce()
  return {
    ...view,
    text,
  }
}

function find(frame: string, text: string) {
  return frame.split("\n")[0].indexOf(text)
}

beforeEach(() => {
  copy.mockClear()
})

describe("selection", () => {
  test("single click does not create a custom selection", async () => {
    const view = await scene()
    const click = Selection.click()
    const note = toast()

    try {
      expect(Selection.press(click, view.renderer, evt(view.text, 1, 0) as any)).toBe(false)
      expect(Selection.release(click, view.renderer, note, evt(view.text, 1, 0) as any)).toBe(false)
      expect(Selection.active(view.renderer)).toBe(false)
    } finally {
      view.renderer.destroy()
    }
  })

  test("double click selects the visible word for concealed markdown/code", async () => {
    const view = await createTestRenderer({
      width: 40,
      height: 6,
      autoFocus: false,
      useConsole: false,
    })
    const click = Selection.click()
    const note = toast()
    const style = SyntaxStyle.create()
    const text = new CodeRenderable(view.renderer, {
      content: "**hello** world",
      filetype: "markdown",
      syntaxStyle: style,
      conceal: true,
      width: 20,
      height: 1,
    })
    view.renderer.root.add(text)
    await view.renderOnce()
    const x = find(view.captureCharFrame(), "world")

    try {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(Selection.press(click, view.renderer, evt(text, x, 0) as any)).toBe(false)
      expect(Selection.release(click, view.renderer, note, evt(text, x, 0) as any)).toBe(false)

      expect(Selection.press(click, view.renderer, evt(text, x, 0) as any)).toBe(true)
      expect(Selection.active(view.renderer)).toBe(true)

      expect(Selection.release(click, view.renderer, note, evt(text, x, 0) as any)).toBe(true)
      expect(copy).toHaveBeenCalledTimes(1)
      expect(copy).toHaveBeenCalledWith("world")
      expect(Selection.active(view.renderer)).toBe(true)
    } finally {
      view.renderer.destroy()
      style.destroy()
    }
  })

  test("double click works from either half of a wide character", async () => {
    const view = await createTestRenderer({
      width: 30,
      height: 5,
      autoFocus: false,
      useConsole: false,
    })
    const click = Selection.click()
    const note = toast()
    const text = new TextRenderable(view.renderer, {
      content: "你好吗 world",
      width: 12,
      height: 1,
    })
    view.renderer.root.add(text)
    await view.renderOnce()

    try {
      expect(Selection.press(click, view.renderer, evt(text, 3, 0) as any)).toBe(false)
      expect(Selection.release(click, view.renderer, note, evt(text, 3, 0) as any)).toBe(false)

      expect(Selection.press(click, view.renderer, evt(text, 3, 0) as any)).toBe(true)
      expect(Selection.release(click, view.renderer, note, evt(text, 3, 0) as any)).toBe(true)

      expect(copy).toHaveBeenCalledTimes(1)
      expect(copy).toHaveBeenCalledWith("你好吗")
    } finally {
      view.renderer.destroy()
    }
  })

  test("triple click selects the full visual line across siblings with layout gaps", async () => {
    const view = await createTestRenderer({
      width: 30,
      height: 5,
      autoFocus: false,
      useConsole: false,
    })
    const click = Selection.click()
    const note = toast()
    const row = new BoxRenderable(view.renderer, { flexDirection: "row", gap: 1 })
    const a = new TextRenderable(view.renderer, { content: "Parent", width: 6, height: 1 })
    const b = new TextRenderable(view.renderer, { content: "Prev", width: 4, height: 1 })
    const c = new TextRenderable(view.renderer, { content: "Next", width: 4, height: 1 })
    row.add(a)
    row.add(b)
    row.add(c)
    view.renderer.root.add(row)
    await view.renderOnce()

    try {
      expect(Selection.press(click, view.renderer, evt(a, 1, 0) as any)).toBe(false)
      expect(Selection.release(click, view.renderer, note, evt(a, 1, 0) as any)).toBe(false)

      expect(Selection.press(click, view.renderer, evt(a, 1, 0) as any)).toBe(true)
      expect(Selection.release(click, view.renderer, note, evt(a, 1, 0) as any)).toBe(true)
      copy.mockClear()

      expect(Selection.press(click, view.renderer, evt(a, 1, 0) as any)).toBe(true)
      expect(Selection.release(click, view.renderer, note, evt(a, 1, 0) as any)).toBe(true)

      expect(copy).toHaveBeenCalledTimes(1)
      expect(copy).toHaveBeenCalledWith("Parent Prev Next")
    } finally {
      view.renderer.destroy()
    }
  })

  test("plain copy keeps existing drag-copy behavior and clears the selection", async () => {
    const view = await scene()
    const note = toast()

    try {
      view.renderer.startSelection(view.text, 0, 0)
      view.renderer.updateSelection(view.text, 5, 0, { finishDragging: true })
      expect(view.renderer.getSelection()?.getSelectedText()).toBe("hello")

      expect(Selection.copy(view.renderer, note)).toBe(true)
      expect(copy).toHaveBeenCalledTimes(1)
      expect(copy).toHaveBeenCalledWith("hello")
      expect(view.renderer.getSelection()).toBeNull()
    } finally {
      view.renderer.destroy()
    }
  })

  test("click streak resets after the timeout window", async () => {
    const view = await scene()
    const click = Selection.click()

    try {
      expect(Selection.press(click, view.renderer, evt(view.text, 1, 0) as any)).toBe(false)
      click.time -= 351
      expect(Selection.press(click, view.renderer, evt(view.text, 1, 0) as any)).toBe(false)
      expect(click.count).toBe(1)
    } finally {
      view.renderer.destroy()
    }
  })

  test("changing target resets the streak and does not trigger selection", async () => {
    const view = await createTestRenderer({
      width: 30,
      height: 5,
      autoFocus: false,
      useConsole: false,
    })
    const click = Selection.click()
    const note = toast()
    const row = new BoxRenderable(view.renderer, { flexDirection: "row" })
    const a = new TextRenderable(view.renderer, { content: "hello", width: 5, height: 1 })
    const b = new TextRenderable(view.renderer, { content: "world", width: 5, height: 1 })
    row.add(a)
    row.add(b)
    view.renderer.root.add(row)
    await view.renderOnce()

    try {
      expect(Selection.press(click, view.renderer, evt(a, 1, 0) as any)).toBe(false)
      expect(Selection.release(click, view.renderer, note, evt(a, 1, 0) as any)).toBe(false)

      expect(Selection.press(click, view.renderer, evt(b, 6, 0) as any)).toBe(false)
      expect(Selection.release(click, view.renderer, note, evt(b, 6, 0) as any)).toBe(false)
      expect(Selection.active(view.renderer)).toBe(false)
      expect(copy).toHaveBeenCalledTimes(0)
    } finally {
      view.renderer.destroy()
    }
  })
})
