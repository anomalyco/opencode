/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ToastProvider, useToast, type ToastContext } from "../../../src/ui/toast"

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

test("history retains local notifications after replacement, dismissal and expiry without actions", async () => {
  let toast: ToastContext | undefined
  const Capture = captureToast((value) => (toast = value))
  const app = await testRender(() => (
    <ToastProvider>
      <Capture />
    </ToastProvider>
  ))
  try {
    await app.waitFor(() => toast !== undefined)
    const start = Date.now()
    const original = {
      title: "Local plugin",
      message: "First line\nSecond line",
      variant: "error" as const,
      action: {
        label: "Retry",
        run: () => {
          throw new Error("History must not execute actions")
        },
      },
    }
    toast!.show(original)
    toast!.show({ message: "Replaced", variant: "info" })
    toast!.dismiss()
    toast!.show({ message: "Expires", variant: "success", duration: 1 })
    await Bun.sleep(10)
    expect(toast!.currentToast).toBeNull()
    expect(toast!.history.map((item) => item.message)).toEqual(["Expires", "Replaced", "First line\nSecond line"])
    expect(toast!.history[2]).toMatchObject({ title: "Local plugin", variant: "error", truncated: false })
    expect(toast!.history[2]!.time).toBeGreaterThanOrEqual(start)
    expect(toast!.history[2]).not.toHaveProperty("action")
    original.message = "mutated caller object"
    expect(toast!.history[2]!.message).toBe("First line\nSecond line")
  } finally {
    app.renderer.destroy()
  }
})

test("history bounds count and total text, marks truncation, and clears independently", async () => {
  let toast: ToastContext | undefined
  const Capture = captureToast((value) => (toast = value))
  const app = await testRender(() => (
    <ToastProvider>
      <Capture />
    </ToastProvider>
  ))
  try {
    await app.waitFor(() => toast !== undefined)
    for (let i = 0; i < 110; i++) toast!.show({ message: `Message ${i}`, variant: "info" })
    expect(toast!.history).toHaveLength(100)
    expect(toast!.history.at(-1)!.message).toBe("Message 10")
    toast!.clearHistory()
    for (let i = 0; i < 12; i++) toast!.show({ title: `Title ${i}`, message: "😀".repeat(10000), variant: "warning" })
    expect(toast!.history.length).toBeLessThan(12)
    expect(
      toast!.history.reduce((sum, item) => sum + (item.title?.length ?? 0) + item.message.length, 0),
    ).toBeLessThanOrEqual(65536)
    expect(toast!.history.every((item) => item.truncated && item.message.isWellFormed())).toBe(true)
    const active = toast!.currentToast
    toast!.clearHistory()
    expect(toast!.history).toHaveLength(0)
    expect(toast!.currentToast).toBe(active)
  } finally {
    app.renderer.destroy()
  }
})
