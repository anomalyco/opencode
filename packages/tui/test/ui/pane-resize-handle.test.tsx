/** @jsxImportSource @opentui/solid */
import { BoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { createPaneResize } from "../../src/ui/pane-resize"
import { PaneResizeHandle } from "../../src/ui/pane-resize-handle"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

for (const mode of ["dark", "light"] as const) {
  test(`${mode} pane resize handle renders themed hover, resize pointer and grip and keeps parent-owned dragging and reset`, async () => {
    const [value, setValue] = createSignal(20)
    const commits: number[] = []
    let resize!: ReturnType<typeof createPaneResize>
    let theme!: ReturnType<typeof useTheme>
    let parent!: BoxRenderable
    function Pane() {
      theme = useTheme()
      resize = createPaneResize({
        value,
        defaultValue: () => 16,
        clamp: (size) => Math.max(10, Math.min(40, size)),
        fromMouse: (event) => event.x + 1,
        contains: (event, size) => event.x >= size - 1 && event.x <= size,
        onCommit: (size) => {
          commits.push(size)
          setValue(size)
        },
      })
      return (
        <box
          ref={(element) => (parent = element)}
          width="100%"
          height="100%"
          onMouseDrag={resize.onMouseDrag}
          onMouseDragEnd={resize.onMouseDragEnd}
          onMouseUp={resize.onMouseUp}
        >
          <PaneResizeHandle resize={resize} left={resize.size() - 1} />
        </box>
      )
    }
    const app = await testRender(
      () => (
        <TestTuiContexts>
          <ConfigProvider config={createTuiResolvedConfig({ theme: { name: "opencode", mode } })}>
            <ThemeProvider mode={mode} source={emptyThemeSource}>
              <Pane />
            </ThemeProvider>
          </ConfigProvider>
        </TestTuiContexts>
      ),
      { width: 60, height: 5 },
    )

    const pointers: string[] = []
    // Where the grip mark is drawn, as [column, row] pairs.
    const grips = () =>
      app
        .captureCharFrame()
        .split("\n")
        .flatMap((row, y) => [...row].flatMap((char, x) => (char === "⋮" ? [[x, y]] : [])))
    app.renderer.setMousePointer = (style) => pointers.push(style)
    let renders = 0
    const requestRender = app.renderer.requestRender.bind(app.renderer)
    app.renderer.requestRender = () => {
      renders++
      requestRender()
    }

    try {
      app.renderer.start()
      await app.waitForFrame(() => parent?.height === 5)
      const handle = parent.getChildren()[0] as BoxRenderable
      // The columns painted in the highlight on every row.
      const lit = () => {
        const rows = app
          .captureSpans()
          .lines.map((row) => row.spans.flatMap((span) => Array.from({ length: span.width }, () => span.bg.toInts())))
        const high = theme.background.raised.high.toInts()
        return rows[0].flatMap((_, x) => (rows.every((row) => Bun.deepEquals(row[x], high)) ? [x] : []))
      }
      expect(handle).toMatchObject({ x: 19, y: 0, width: 2, height: 5, zIndex: 10 })
      expect(handle.getChildren()).toEqual([])
      expect(lit()).toEqual([])
      expect(handle.backgroundColor.a).toBe(0)
      expect(pointers).toEqual([])
      expect(grips()).toEqual([])

      setValue(24)
      await app.renderOnce()
      expect(handle.x).toBe(23)
      expect(commits).toEqual([])

      // The transparent second column is still part of the hitbox.
      await app.mockMouse.moveTo(24, 2)
      await app.renderOnce()
      expect(resize.hovered()).toBe(true)
      expect(resize.resizing()).toBe(false)
      expect(lit()).toEqual([23])
      expect(handle.backgroundColor.a).toBe(0)
      expect(pointers).toEqual(["ew-resize"])
      expect(grips()).toEqual([[23, 2]])
      await app.mockMouse.moveTo(24, 4)
      await app.renderOnce()
      expect(grips()).toEqual([[23, 4]])
      // Moving onto the grip itself keeps the hover: the grip draws no element of its own to leave to.
      for (const y of [4, 3, 3]) {
        await app.mockMouse.moveTo(23, y)
        await app.renderOnce()
        expect(resize.hovered()).toBe(true)
        expect(grips()).toEqual([[23, y]])
      }
      expect(pointers).toEqual(["ew-resize"])
      await app.mockMouse.moveTo(24, 4)
      await app.renderOnce()
      for (const row of app.captureSpans().lines) {
        const colors = row.spans.flatMap((span) => Array.from({ length: span.width }, () => span.bg.toInts()))
        expect(colors[23]).toEqual(theme.background.raised.high.toInts())
        expect(colors[24]).not.toEqual(colors[23])
      }

      // The line and grip are painted rather than element props, so leaving has to ask for a repaint.
      renders = 0
      await app.mockMouse.moveTo(5, 2)
      expect(renders).toBeGreaterThan(0)
      await app.renderOnce()
      expect(resize.hovered()).toBe(false)
      expect(lit()).toEqual([])
      expect(pointers).toEqual(["ew-resize", "default"])
      expect(grips()).toEqual([])

      await app.mockMouse.pressDown(24, 2)
      expect(resize.resizing()).toBe(true)
      // The grip stays on the row the drag started from and moves with the divider.
      await app.mockMouse.moveTo(30, 1)
      await app.renderOnce()
      expect(grips()).toEqual([[30, 2]])
      expect(resize.size()).toBe(31)
      expect(handle.x).toBe(30)
      expect(lit()).toEqual([30])
      // A small step lands the pointer on the moved handle itself; the grip still keeps its row.
      await app.mockMouse.moveTo(31, 1)
      await app.renderOnce()
      expect(grips()).toEqual([[31, 2]])
      expect(commits).toEqual([])

      // Clamping leaves the pointer outside the handle while the parent keeps dragging.
      await app.mockMouse.moveTo(50, 2)
      await app.renderOnce()
      expect(resize.size()).toBe(40)
      expect(handle.x).toBe(39)
      expect(resize.hovered()).toBe(false)
      expect(resize.resizing()).toBe(true)
      expect(lit()).toEqual([39])
      expect(pointers.at(-1)).toBe("ew-resize")
      expect(grips()).toEqual([[39, 2]])
      expect(
        app
          .captureSpans()
          .lines[2].spans.find((span) => span.text === "⋮")
          ?.fg.toInts(),
      ).toEqual(theme.text.action.primary.base.toInts())
      expect(commits).toEqual([])

      await app.mockMouse.release(55, 2)
      await app.renderOnce()
      expect(resize.resizing()).toBe(false)
      expect(resize.hovered()).toBe(false)
      expect(lit()).toEqual([])
      expect(value()).toBe(40)
      expect(commits).toEqual([40])
      expect(pointers).toEqual(["ew-resize", "default", "ew-resize", "default"])
      expect(grips()).toEqual([])

      await app.mockMouse.doubleClick(40, 2)
      await app.renderOnce()
      expect(value()).toBe(16)
      expect(handle.x).toBe(15)
      expect(resize.resizing()).toBe(false)
      expect(resize.hovered()).toBe(false)
      expect(lit()).toEqual([])
      expect(commits).toEqual([40, 16])
      expect(pointers.at(-1)).toBe("default")
    } finally {
      app.renderer.destroy()
    }
  })
}
