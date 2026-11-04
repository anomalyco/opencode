/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import { extend, testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { Toast, ToastProvider, useToast, type ToastContext } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
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

test("toast hides only the terminal cursor it covers, until dismissed", async () => {
  let toast!: ToastContext
  let terminal!: EmbeddedTerminalRenderable
  const Capture = captureToast((value) => (toast = value))
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <ToastProvider>
            <Capture />
            <embeddedTerminal ref={(value) => (terminal = value)} width="100%" height="100%" />
            <Toast />
          </ToastProvider>
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 60, height: 12 },
  )
  try {
    await app.renderOnce()
    terminal.focus()
    terminal.write("\x1b[?25h\x1b[2;1H")
    toast.show({ message: "Copied to clipboard", variant: "info", duration: 60_000 })
    await app.renderOnce()
    expect(app.renderer.getCursorState().visible).toBe(true)

    terminal.write("\x1b[2;52H")
    await app.renderOnce()
    expect(app.renderer.getCursorState().visible).toBe(false)

    toast.dismiss()
    await app.renderOnce()
    expect(app.renderer.getCursorState()).toMatchObject({ x: 52, y: 2, visible: true })
  } finally {
    app.renderer.destroy()
  }
})
