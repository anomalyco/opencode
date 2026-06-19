import { ColorScheme } from "@blocksuite/affine-model"
import { afterEach, describe, expect, test } from "bun:test"
import { parseKeybind } from "@/context/command"
import { createPage } from "./blocksuite-doc"
import { scheme } from "./theme"

type Page = Awaited<ReturnType<typeof createPage>>

const pages: Page[] = []

afterEach(async () => {
  await Promise.all(pages.splice(0).map((page) => page.dispose()))
})

async function page(input: Parameters<typeof createPage>[0]) {
  const next = await createPage(input)
  pages.push(next)
  return next
}

describe("createPage plain props", () => {
  test("applies plain theme on attach", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const next = await page({ theme: "dark" })
    await next.attach(host)
    const { ThemeProvider } = await import("@blocksuite/blocks")
    expect(next.editor.std.get(ThemeProvider).app$.value).toBe(scheme("dark"))
    expect(next.editor.std.get(ThemeProvider).app$.value).toBe(ColorScheme.Dark)
    host.remove()
  })

  test("calls onSubmit on matching keydown", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    let sent = 0
    const next = await page({ theme: "light", onSubmit: () => sent++ })
    await next.attach(host)
    next.editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    expect(sent).toBe(1)
    host.remove()
  })

  test("skips onSubmit while composing", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    let sent = 0
    const next = await page({ theme: "light", onSubmit: () => sent++ })
    await next.attach(host)
    next.editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }),
    )
    expect(sent).toBe(0)
    host.remove()
  })

  test("skips onSubmit on shift+enter default bind", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    let sent = 0
    const next = await page({ theme: "light", onSubmit: () => sent++ })
    await next.attach(host)
    next.editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }),
    )
    expect(sent).toBe(0)
    host.remove()
  })

  test("uses custom submitKey plain string", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    let sent = 0
    const next = await page({ theme: "light", onSubmit: () => sent++, submitKey: "mod+enter" })
    await next.attach(host)
    const kb = parseKeybind("mod+enter")[0]!
    next.editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: kb.ctrl,
        metaKey: kb.meta,
        shiftKey: kb.shift,
        altKey: kb.alt,
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(sent).toBe(1)
    next.editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    expect(sent).toBe(1)
    host.remove()
  })
})
