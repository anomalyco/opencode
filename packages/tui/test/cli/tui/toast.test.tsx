/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { BoxRenderable, EmbeddedTerminalRenderable } from "@opentui/core"
import { extend, testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { Toast, ToastProvider, useToast, type ToastContext } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

extend({ embeddedTerminal: EmbeddedTerminalRenderable })

function captureToast(setToast: (toast: ToastContext) => void) {
  return function Capture() {
    const toast = useToast()
    onMount(() => setToast(toast))
    return null
  }
}

test("activation runs an action and keeps a queued toast paused", async () => {
  let toast: ToastContext | undefined
  const Capture = captureToast((value) => (toast = value))
  const app = await testRender(() => (
    <ToastProvider>
      <Capture />
    </ToastProvider>
  ))

  try {
    await app.waitFor(() => toast !== undefined)
    let activated = false
    toast!.show({
      message: "Plugin failed",
      variant: "error",
      action: { label: "Open plugins", run: () => (activated = true) },
    })
    toast!.pause()
    toast!.show({ message: "Copied", variant: "success", duration: 5 })

    expect(toast!.currentToast?.message).toBe("Plugin failed")
    expect(toast!.pending).toBe(1)

    toast!.activate()

    expect(activated).toBe(true)
    expect(toast!.currentToast?.message).toBe("Copied")
    expect(toast!.pending).toBe(0)

    await Bun.sleep(10)
    expect(toast!.currentToast?.message).toBe("Copied")

    toast!.resume()
    await Bun.sleep(10)
    expect(toast!.currentToast).toBeNull()
  } finally {
    app.renderer.destroy()
  }
})

test("activation dismisses a toast without an action", async () => {
  let toast: ToastContext | undefined
  const Capture = captureToast((value) => (toast = value))
  const app = await testRender(() => (
    <ToastProvider>
      <Capture />
    </ToastProvider>
  ))

  try {
    await app.waitFor(() => toast !== undefined)
    toast!.show({ message: "Copied", variant: "success", duration: 5 })
    toast!.activate()
    expect(toast!.currentToast).toBeNull()
  } finally {
    app.renderer.destroy()
  }
})

async function renderToast(width: number) {
  let toast!: ToastContext
  let terminal!: EmbeddedTerminalRenderable
  let root!: BoxRenderable
  const input: string[] = []
  const Capture = captureToast((value) => (toast = value))
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <ToastProvider>
              <Capture />
              <box ref={(value) => (root = value)} width="100%" height="100%">
                <embeddedTerminal
                  ref={(value) => (terminal = value)}
                  position="absolute"
                  width="100%"
                  height="100%"
                  onData={(data, source) => {
                    if (source === "input") input.push(new TextDecoder().decode(data))
                  }}
                />
                <Toast />
              </box>
            </ToastProvider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 12, kittyKeyboard: true },
  )
  await app.renderOnce()
  terminal.focus()
  return { ...app, toast, terminal, root, input }
}

test.each([44, 100])("toast hides a covered terminal cursor without moving focus at width %i", async (width) => {
  const app = await renderToast(width)
  try {
    app.terminal.write(`\x1b[?25h\x1b[2;${width - 8}H`)
    await app.renderOnce()
    const cursor = app.renderer.getCursorState()
    expect(cursor.visible).toBe(true)

    app.toast.show({ message: "Copied to clipboard", variant: "info", duration: 60_000 })
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Copied to clipboard")
    expect(app.terminal.screen().cursor.visible).toBe(true)
    expect(app.renderer.getCursorState()).toEqual({ ...cursor, visible: false })
    expect(app.renderer.currentFocusedRenderable).toBe(app.terminal)

    app.mockInput.pressKey("x")
    expect(app.input).toEqual(["x"])
    await app.renderOnce()
    expect(app.renderer.getCursorState().visible).toBe(false)

    app.toast.dismiss()
    await app.renderOnce()
    expect(app.renderer.getCursorState()).toEqual(cursor)
    expect(app.renderer.currentFocusedRenderable).toBe(app.terminal)
  } finally {
    app.renderer.destroy()
  }
})

test.each([44, 100])("toast only hides cursor cells within its borders at width %i", async (width) => {
  const app = await renderToast(width)
  try {
    app.toast.show({ message: "Copied to clipboard", variant: "info", duration: 60_000 })
    await app.renderOnce()
    const surface = app.root.getChildren()[1]!

    for (const point of [
      { x: surface.x, y: surface.y, covered: true },
      { x: surface.x + surface.width - 1, y: surface.y + surface.height - 1, covered: true },
      { x: surface.x - 1, y: surface.y, covered: false },
      { x: surface.x + surface.width, y: surface.y, covered: false },
      { x: surface.x, y: surface.y - 1, covered: false },
      { x: surface.x, y: surface.y + surface.height, covered: false },
    ]) {
      app.terminal.write(`\x1b[?25h\x1b[${point.y + 1};${point.x + 1}H`)
      await app.renderOnce()
      expect(app.renderer.getCursorState()).toMatchObject({
        x: point.x + 1,
        y: point.y + 1,
        visible: !point.covered,
      })
    }
  } finally {
    app.renderer.destroy()
  }
})

test("toast cursor coverage follows terminal resizing", async () => {
  const app = await renderToast(100)
  try {
    app.terminal.write("\x1b[?25h\x1b[2;31H")
    app.toast.show({ message: "Copied to clipboard", variant: "info", duration: 60_000 })
    await app.renderOnce()
    expect(app.renderer.getCursorState().visible).toBe(true)

    app.resize(44, 12)
    await app.renderOnce()
    expect(app.renderer.getCursorState()).toMatchObject({ x: 31, y: 2, visible: false })

    app.resize(100, 12)
    await app.renderOnce()
    expect(app.renderer.getCursorState()).toMatchObject({ x: 31, y: 2, visible: true })
  } finally {
    app.renderer.destroy()
  }
})

test("dismissing a toast does not reveal a cursor hidden by the terminal application", async () => {
  const app = await renderToast(100)
  try {
    app.terminal.write("\x1b[?25l\x1b[2;92H")
    app.toast.show({ message: "Copied to clipboard", variant: "info", duration: 60_000 })
    await app.renderOnce()
    expect(app.renderer.getCursorState().visible).toBe(false)

    app.toast.dismiss()
    await app.renderOnce()
    expect(app.renderer.getCursorState().visible).toBe(false)

    app.terminal.write("\x1b[?25h")
    await app.renderOnce()
    expect(app.renderer.getCursorState().visible).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
