import { describe, expect, test, vi } from "bun:test"
import { createRoot } from "solid-js"
import { createShellOptions, createSoundPreviewController } from "./behavior"
import { createOptimisticSetting } from "./controllers"

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

  test("serializes rapid writes and rolls a failure back to the value the source saved", async () => {
    const writes: { value: string; done: PromiseWithResolvers<void> }[] = []
    const errors: string[] = []

    const owned = createRoot((dispose) => ({
      dispose,
      setting: createOptimisticSetting({
        source: () => "server",
        initial: "",
        initialMeta: undefined,
        load: async () => ({ value: "/bin/zsh", meta: undefined }),
        write: (value: string) => {
          const done = Promise.withResolvers<void>()
          writes.push({ value, done })

          return done.promise
        },
        onError: (failure) => errors.push(failure.kind),
      }),
    }))

    // A macrotask lets the read and every promise callback queued behind it settle.
    const settled = () => new Promise((resolve) => setTimeout(resolve))
    await settled()
    expect(owned.setting.value()).toBe("/bin/zsh")

    owned.setting.select("bash")
    owned.setting.select("fish")
    expect(owned.setting.value()).toBe("fish")
    expect(writes.map((write) => write.value)).toEqual(["bash"])

    writes[0]!.done.resolve()
    await settled()
    expect(writes.map((write) => write.value)).toEqual(["bash", "fish"])

    writes[1]!.done.reject(new Error("boom"))
    await settled()
    expect(owned.setting.value()).toBe("bash")
    expect(errors).toEqual(["failed"])

    owned.dispose()
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
