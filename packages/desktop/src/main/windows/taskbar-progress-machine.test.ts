import { afterEach, describe, expect, test } from "bun:test"
import {
  selectTaskbarProgressMode,
  type TaskbarProgressMode,
  type TaskbarProgressSummary,
} from "../../shared/ipc-contract"
import { clearTaskbarProgress, setTaskbarProgress } from "./taskbar-progress"
import {
  INITIAL_TASKBAR_PROGRESS_STATE,
  transitionTaskbarProgress,
  type TaskbarProgressEvent,
  type TaskbarProgressState,
  type TaskbarProgressTransition,
} from "./taskbar-progress-machine"

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

function replay(events: readonly TaskbarProgressEvent[], start: TaskbarProgressState = INITIAL_TASKBAR_PROGRESS_STATE) {
  return events.reduce<TaskbarProgressTransition>(
    (acc, event) => {
      const next = transitionTaskbarProgress(acc.state, event)

      return { state: next.state, commands: [...acc.commands, ...next.commands] }
    },
    { state: start, commands: [] },
  )
}

function fakeWindow(destroyed = false) {
  const calls: Array<{ progress: number; mode: string | undefined }> = []

  return {
    calls,
    win: {
      isDestroyed: () => destroyed,
      setProgressBar: (progress: number, options?: { mode?: string }) => {
        calls.push({ progress, mode: options?.mode })
      },
    },
  }
}

describe("selectTaskbarProgressMode", () => {
  test.each<{ name: string; summary: TaskbarProgressSummary; expected: TaskbarProgressMode }>([
    { name: "idle window", summary: { waiting: 0, failed: false, busy: false }, expected: "none" },
    { name: "busy session", summary: { waiting: 0, failed: false, busy: true }, expected: "indeterminate" },
    { name: "unread failed session beats busy", summary: { waiting: 0, failed: true, busy: true }, expected: "error" },
    {
      name: "waiting request beats failed and busy",
      summary: { waiting: 1, failed: true, busy: true },
      expected: "paused",
    },
  ])("$name -> $expected", ({ summary, expected }) => {
    expect(selectTaskbarProgressMode(summary)).toBe(expected)
  })
})

describe("transitionTaskbarProgress", () => {
  test("stays blank without commands when an idle window reports none", () => {
    const next = transitionTaskbarProgress(INITIAL_TASKBAR_PROGRESS_STATE, { type: "mode.reported", mode: "none" })
    expect(next.state).toBe(INITIAL_TASKBAR_PROGRESS_STATE)
    expect(next.commands).toEqual([])
  })

  test("applies Electron progress values and skips duplicate modes", () => {
    const result = replay([
      { type: "mode.reported", mode: "indeterminate" },
      { type: "mode.reported", mode: "indeterminate" },
      { type: "mode.reported", mode: "paused" },
      { type: "mode.reported", mode: "error" },
      { type: "mode.reported", mode: "none" },
      { type: "mode.reported", mode: "none" },
    ])

    expect(result.state).toEqual({ status: "showing", mode: "none" })
    expect(result.commands).toEqual([
      { type: "apply", progress: 2, mode: "indeterminate" },
      { type: "apply", progress: 1, mode: "paused" },
      { type: "apply", progress: 1, mode: "error" },
      { type: "apply", progress: -1, mode: "none" },
    ])
  })

  test("returns the same state object on unchanged mode", () => {
    const first = transitionTaskbarProgress(INITIAL_TASKBAR_PROGRESS_STATE, { type: "mode.reported", mode: "paused" })
    const second = transitionTaskbarProgress(first.state, { type: "mode.reported", mode: "paused" })
    expect(second.state).toBe(first.state)
    expect(second.commands).toEqual([])
  })

  test("resets to blank on window close", () => {
    const shown = transitionTaskbarProgress(INITIAL_TASKBAR_PROGRESS_STATE, { type: "mode.reported", mode: "error" })
    const closed = transitionTaskbarProgress(shown.state, { type: "window.closed" })
    expect(closed.state).toBe(INITIAL_TASKBAR_PROGRESS_STATE)
    expect(closed.commands).toEqual([])
  })
})

describe("setTaskbarProgress", () => {
  test.each<{ platform: NodeJS.Platform; calls: number }>([
    { platform: "darwin", calls: 0 },
    { platform: "linux", calls: 0 },
    { platform: "win32", calls: 1 },
  ])("on $platform calls setProgressBar $calls time(s)", ({ platform, calls }) => {
    Object.defineProperty(process, "platform", { value: platform })
    const target = fakeWindow()
    setTaskbarProgress(target.win, "indeterminate")
    expect(target.calls.length).toBe(calls)
  })

  test("deduplicates repeated modes and ignores destroyed windows on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    const target = fakeWindow()
    setTaskbarProgress(target.win, "none")
    setTaskbarProgress(target.win, "indeterminate")
    setTaskbarProgress(target.win, "indeterminate")
    setTaskbarProgress(target.win, "paused")
    setTaskbarProgress(target.win, "none")
    clearTaskbarProgress(target.win)
    expect(target.calls).toEqual([
      { progress: 2, mode: "indeterminate" },
      { progress: 1, mode: "paused" },
      { progress: -1, mode: "none" },
    ])

    const destroyed = fakeWindow(true)
    setTaskbarProgress(destroyed.win, "error")
    expect(destroyed.calls).toEqual([])
  })
})
