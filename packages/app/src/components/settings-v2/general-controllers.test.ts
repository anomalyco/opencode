import { describe, expect, test, vi } from "bun:test"
import { createRoot } from "solid-js"
import { createShellOptions, createSoundPreviewController } from "./general-controller-behavior"

describe("settings v2 controllers", () => {
  test("normalizes shell names and preserves an unavailable configured shell", () => {
    expect(
      createShellOptions({
        shells: [
          { path: "/bin/bash", name: "bash", acceptable: true },
          { path: "/opt/bash", name: "bash", acceptable: false },
          { path: "/bin/zsh", name: "zsh", acceptable: true },
        ],
        current: "fish",
        automatic: "Automatic",
        terminalOnly: "Terminal only",
      }),
    ).toEqual([
      { id: "auto", value: "", label: "Automatic" },
      { id: "/bin/bash", value: "/bin/bash", label: "/bin/bash" },
      { id: "/opt/bash", value: "/opt/bash", label: "/opt/bash (Terminal only)" },
      { id: "/bin/zsh", value: "zsh", label: "zsh" },
      { id: "fish", value: "fish", label: "fish" },
    ])
  })

  test("debounces previews and stops owned audio on disposal", async () => {
    vi.useFakeTimers()
    try {
      const played: string[] = []
      const stopped: string[] = []
      const owned = createRoot((dispose) => ({
        dispose,
        preview: createSoundPreviewController(async (id) => {
          played.push(id ?? "")
          return () => stopped.push(id ?? "")
        }),
      }))

      owned.preview.play("first")
      vi.advanceTimersByTime(99)
      expect(played).toEqual([])

      owned.preview.play("second")
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(played).toEqual(["second"])

      owned.dispose()
      expect(stopped).toEqual(["second"])
    } finally {
      vi.useRealTimers()
    }
  })
})
