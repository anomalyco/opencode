import { describe, expect, test } from "bun:test"
import {
  combineCommandSections,
  createOpenPreviewFile,
  createOpenReviewFile,
  focusTerminalById,
  getTabReorderIndex,
  isPreviewablePath,
} from "./helpers"

describe("createOpenReviewFile", () => {
  test("opens and loads selected review file", () => {
    const calls: string[] = []
    const openReviewFile = createOpenReviewFile({
      showAllFiles: () => calls.push("show"),
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      loadFile: (path) => calls.push(`load:${path}`),
    })

    openReviewFile("src/a.ts")

    expect(calls).toEqual(["show", "tab:src/a.ts", "open:file://src/a.ts", "load:src/a.ts"])
  })
})

describe("createOpenPreviewFile", () => {
  test("stores and opens selected preview file", () => {
    const calls: string[] = []
    const openPreviewFile = createOpenPreviewFile({
      showAllFiles: () => calls.push("show"),
      openTab: (tab) => calls.push(`open:${tab}`),
      setPreviewPath: (path) => calls.push(`preview:${path}`),
      loadFile: (path) => calls.push(`load:${path}`),
    })

    openPreviewFile("src/a.html")

    expect(calls).toEqual(["show", "preview:src/a.html", "open:preview", "load:src/a.html"])
  })
})

describe("focusTerminalById", () => {
  test("focuses textarea when present", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-one"><div data-component="terminal"><textarea></textarea></div></div>`

    const focused = focusTerminalById("one")

    expect(focused).toBe(true)
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })

  test("falls back to terminal element focus", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-two"><div data-component="terminal" tabindex="0"></div></div>`
    const terminal = document.querySelector('[data-component="terminal"]') as HTMLElement
    let pointerDown = false
    terminal.addEventListener("pointerdown", () => {
      pointerDown = true
    })

    const focused = focusTerminalById("two")

    expect(focused).toBe(true)
    expect(document.activeElement).toBe(terminal)
    expect(pointerDown).toBe(true)
  })
})

describe("combineCommandSections", () => {
  test("keeps section order stable", () => {
    const result = combineCommandSections([
      [{ id: "a", title: "A" }],
      [
        { id: "b", title: "B" },
        { id: "c", title: "C" },
      ],
    ])

    expect(result.map((item) => item.id)).toEqual(["a", "b", "c"])
  })
})

describe("getTabReorderIndex", () => {
  test("returns target index for valid drag reorder", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "c")).toBe(2)
  })

  test("returns undefined for unknown droppable id", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "missing")).toBeUndefined()
  })
})

describe("isPreviewablePath", () => {
  test("matches previewable extensions", () => {
    expect(isPreviewablePath("reports/result.html")).toBe(true)
    expect(isPreviewablePath("assets/chart.PNG")).toBe(true)
    expect(isPreviewablePath("audio/voice.m4a")).toBe(true)
    expect(isPreviewablePath("docs/report.pdf")).toBe(true)
  })

  test("ignores non-previewable paths", () => {
    expect(isPreviewablePath("src/app.ts")).toBe(false)
    expect(isPreviewablePath("README")).toBe(false)
  })
})
