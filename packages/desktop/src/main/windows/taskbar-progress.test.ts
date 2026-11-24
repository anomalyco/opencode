import { afterEach, describe, expect, test } from "bun:test"
import { selectTaskbarProgressMode, type TaskbarProgressMode } from "../../shared/ipc-contract"
import { setTaskbarProgress } from "./taskbar-progress"

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

function fakeWindow() {
  const calls: Array<{ progress: number; mode: string | undefined }> = []

  return {
    calls,
    win: {
      isDestroyed: () => false,
      setProgressBar: (progress: number, options?: { mode?: string }) => {
        calls.push({ progress, mode: options?.mode })
      },
    },
  }
}

describe("taskbar progress", () => {
  test.each([
    {
      name: "a waiting request wins over a failure and a running session",
      waiting: 1,
      failed: true,
      busy: true,
      mode: "paused",
    },
    { name: "a failure wins over a running session", waiting: 0, failed: true, busy: true, mode: "error" },
    { name: "a running session alone", waiting: 0, failed: false, busy: true, mode: "indeterminate" },
    { name: "nothing to show", waiting: 0, failed: false, busy: false, mode: "none" },
  ])("$name", ({ waiting, failed, busy, mode }) => {
    expect(selectTaskbarProgressMode({ waiting, failed, busy })).toBe(mode)
  })

  test("on win32 an idle launch makes no call and repeats are skipped", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    const fake = fakeWindow()
    const modes: TaskbarProgressMode[] = ["none", "indeterminate", "indeterminate", "paused", "none", "none"]
    modes.forEach((mode) => setTaskbarProgress(fake.win, mode))

    expect(fake.calls).toEqual([
      { progress: 2, mode: "indeterminate" },
      { progress: 1, mode: "paused" },
      { progress: -1, mode: "none" },
    ])
  })

  test.each(["darwin", "linux"] as const)("on %s it never touches the window", (platform) => {
    Object.defineProperty(process, "platform", { value: platform })
    const fake = fakeWindow()
    setTaskbarProgress(fake.win, "paused")

    expect(fake.calls).toEqual([])
  })
})
