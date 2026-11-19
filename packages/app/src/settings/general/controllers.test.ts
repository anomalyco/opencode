import { describe, expect, test, vi } from "bun:test"
import { createRoot } from "solid-js"
import { consoleTasksEnabled, createShellOptions, createSoundPreviewController } from "./behavior"

describe("settings controllers", () => {
  test("normalizes shell names and preserves an unavailable configured shell", () => {
    expect(
      createShellOptions({
        shells: [
          { path: "/bin/bash", name: "bash", acceptable: true },
          { path: "/opt/bash", name: "bash", acceptable: false },
          { path: "/bin/zsh", name: "zsh", acceptable: true },
        ],
        current: "fish",
      }),
    ).toEqual([
      { id: "auto", value: "", name: "", terminalOnly: false },
      { id: "/bin/bash", value: "/bin/bash", name: "/bin/bash", terminalOnly: false },
      { id: "/opt/bash", value: "/opt/bash", name: "/opt/bash", terminalOnly: true },
      { id: "/bin/zsh", value: "zsh", name: "zsh", terminalOnly: false },
      { id: "fish", value: "fish", name: "fish", terminalOnly: false },
    ])
  })

  test("reads OpenCode Console tasks as on unless a global config file sets console_tasks to false", () => {
    const file = (path: string, console_tasks?: boolean) =>
      ({ type: "document", path, info: console_tasks === undefined ? {} : { console_tasks } }) as const

    const directory = { type: "directory", path: "/project/.opencode" } as const

    expect(consoleTasksEnabled([])).toBe(true)
    expect(
      consoleTasksEnabled([file("/etc/opencode/opencode.json"), file("/config/opencode/opencode.json", false)]),
    ).toBe(false)
    // The last file that names it wins.
    expect(
      consoleTasksEnabled([file("/etc/opencode/opencode.json", false), file("/config/opencode/opencode.json", true)]),
    ).toBe(true)
    // Console's own document has no file and never decides it.
    expect(consoleTasksEnabled([{ type: "document", info: { console_tasks: false } }])).toBe(true)
    // Only the global part counts: what follows the first discovery directory is a project's.
    expect(
      consoleTasksEnabled([file("/config/opencode/opencode.json"), directory, file("/project/opencode.json", false)]),
    ).toBe(true)
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
