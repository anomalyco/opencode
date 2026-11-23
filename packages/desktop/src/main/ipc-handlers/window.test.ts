import { afterEach, describe, expect, test } from "bun:test"
import { focusWindow, showWindow } from "../windows/focus"

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

function fakeWindow(minimized: boolean, events: string[]) {
  return {
    isMinimized: () => minimized,
    restore: () => {
      events.push("win.restore")
    },
    show: () => {
      events.push("win.show")
    },
    focus: () => {
      events.push("win.focus")
    },
  }
}

describe("window show and focus handlers", () => {
  test.each([
    { minimized: false, expected: ["win.show"] },
    { minimized: true, expected: ["win.restore", "win.show"] },
  ])("showWindow with minimized=$minimized restores before showing", ({ minimized, expected }) => {
    const events: string[] = []
    showWindow(fakeWindow(minimized, events))
    expect(events).toEqual(expected)
    showWindow(null)
    expect(events).toEqual(expected)
  })

  test.each([
    { platform: "darwin" as const, minimized: false, expected: ["app.focus:steal", "win.focus"] },
    { platform: "darwin" as const, minimized: true, expected: ["win.restore", "app.focus:steal", "win.focus"] },
    { platform: "linux" as const, minimized: false, expected: ["win.focus"] },
    { platform: "linux" as const, minimized: true, expected: ["win.restore", "win.focus"] },
    { platform: "win32" as const, minimized: true, expected: ["win.restore", "win.focus"] },
  ])(
    "focusWindow on $platform with minimized=$minimized restores and activates the app before focusing",
    ({ platform, minimized, expected }) => {
      Object.defineProperty(process, "platform", { value: platform })
      const events: string[] = []

      const app = {
        focus: (options?: { steal: boolean }) => {
          events.push(options?.steal ? "app.focus:steal" : "app.focus")
        },
      }

      focusWindow(fakeWindow(minimized, events), app)
      expect(events).toEqual(expected)
      focusWindow(null, app)
      expect(events).toEqual(expected)
    },
  )
})
