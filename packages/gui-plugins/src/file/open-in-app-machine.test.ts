import { describe, expect, test } from "bun:test"
import {
  OPEN_IN_APP_CHECK_TIMEOUT_MS,
  OPEN_IN_APP_LAUNCH_TIMEOUT_MS,
  createOpenInAppState,
  isOpenAppInstalled,
  isOpenInAppLaunching,
  transitionOpenInApp,
  type OpenInAppEffect,
  type OpenInAppEvent,
  type OpenInAppState,
} from "./open-in-app-machine"

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: OpenInAppState, ...events: OpenInAppEvent[]) {
  return events.reduce<{ state: OpenInAppState; effects: readonly OpenInAppEffect[] }>(
    (result, event) => {
      const next = transitionOpenInApp(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const header: OpenInAppEvent = {
  type: "launch.requested",
  app: "vscode",
  target: "/repo",
  openWith: "Visual Studio Code",
  reveal: false,
}

const tree: OpenInAppEvent = { type: "launch.requested", app: "cursor", target: "/repo/a.ts", openWith: "Cursor", reveal: false }

describe("launching", () => {
  test("one launch at a time across the header and a file tree's menu", () => {
    const first = play(createOpenInAppState(), header)

    expect(isOpenInAppLaunching(first.state)).toBe(true)
    expect(first.effects).toEqual([
      {
        type: "run-launch",
        attempt: 1,
        target: "/repo",
        openWith: "Visual Studio Code",
        reveal: false,
        timeoutMs: OPEN_IN_APP_LAUNCH_TIMEOUT_MS,
      },
    ])

    const second = transitionOpenInApp(first.state, tree)

    expect(second.state).toBe(first.state)
    expect(second.effects).toEqual([])

    const done = play(first.state, { type: "launch.succeeded", attempt: 1 }, tree)

    expect(done.effects).toEqual([
      { type: "clear-timer", attempt: 1 },
      expect.objectContaining({ type: "run-launch", attempt: 2, target: "/repo/a.ts" }),
    ])
  })

  test("a launch that never answers releases the controls, and its late failure shows nothing", () => {
    const timedOut = play(createOpenInAppState(), header, { type: "launch.timed-out", attempt: 1 })

    expect(isOpenInAppLaunching(timedOut.state)).toBe(false)

    const late = transitionOpenInApp(timedOut.state, { type: "launch.failed", attempt: 1, error: "exit 1" })

    expect(late.state).toBe(timedOut.state)
    expect(late.effects).toEqual([])
  })

  test("a failed launch releases the controls and reports the error", () => {
    const failed = play(createOpenInAppState(), header, { type: "launch.failed", attempt: 1, error: "ENOENT" })

    expect(isOpenInAppLaunching(failed.state)).toBe(false)
    expect(failed.effects.slice(1)).toEqual([
      { type: "clear-timer", attempt: 1 },
      { type: "toast-failed", error: "ENOENT" },
    ])
  })

  test("only the file manager reveals, and an empty target opens nothing", () => {
    const reveal = play(
      createOpenInAppState(),
      { ...header, reveal: true },
      { type: "launch.succeeded", attempt: 1 },
      { type: "launch.requested", app: "finder", target: "/repo/a.ts", reveal: true },
    )

    expect(reveal.effects).toEqual([
      expect.objectContaining({ type: "run-launch", attempt: 1, reveal: false }),
      { type: "clear-timer", attempt: 1 },
      expect.objectContaining({ type: "run-launch", attempt: 2, reveal: true }),
    ])

    const empty = createOpenInAppState()

    expect(transitionOpenInApp(empty, { ...header, target: "" }).state).toBe(empty)
  })
})

describe("installed checks", () => {
  const listed = () => play(createOpenInAppState(), { type: "apps.requested", openWith: ["Visual Studio Code", "Cursor"] })

  test("each app lists once its own check answers, while another still runs", () => {
    const state = listed()

    expect(state.effects).toEqual([
      { type: "check-app", attempt: 1, openWith: "Visual Studio Code", timeoutMs: OPEN_IN_APP_CHECK_TIMEOUT_MS },
      { type: "check-app", attempt: 2, openWith: "Cursor", timeoutMs: OPEN_IN_APP_CHECK_TIMEOUT_MS },
    ])

    const answered = play(state.state, {
      type: "app.checked",
      attempt: 1,
      openWith: "Visual Studio Code",
      installed: true,
    })

    expect(isOpenAppInstalled(answered.state, "Visual Studio Code")).toBe(true)
    expect(isOpenAppInstalled(answered.state, "Cursor")).toBe(false)
  })

  test("a failed or stalled check is retried on the next demand instead of hiding the app for good", () => {
    const dropped = play(
      listed().state,
      { type: "app.checked", attempt: 1, openWith: "Visual Studio Code", installed: true },
      { type: "app.check-dropped", attempt: 2, openWith: "Cursor" },
    )

    expect(dropped.effects).toEqual([
      { type: "clear-timer", attempt: 1 },
      { type: "clear-timer", attempt: 2 },
    ])

    const retried = play(dropped.state, { type: "apps.requested", openWith: ["Visual Studio Code", "Cursor"] })

    expect(retried.effects).toEqual([
      { type: "check-app", attempt: 3, openWith: "Cursor", timeoutMs: OPEN_IN_APP_CHECK_TIMEOUT_MS },
    ])
  })

  test("a demand while checks run or after they answered checks nothing again", () => {
    const state = listed().state
    const again = transitionOpenInApp(state, { type: "apps.requested", openWith: ["Cursor", "Cursor"] })

    expect(again.state).toBe(state)
    expect(again.effects).toEqual([])
  })

  test("ignores a stale answer", () => {
    const dropped = play(listed().state, { type: "app.check-dropped", attempt: 2, openWith: "Cursor" }).state
    const retried = play(dropped, { type: "apps.requested", openWith: ["Cursor"] }).state
    const late = transitionOpenInApp(retried, { type: "app.checked", attempt: 2, openWith: "Cursor", installed: true })

    expect(late.state).toBe(retried)
    expect(isOpenAppInstalled(late.state, "Cursor")).toBe(false)
  })
})

describe("disposed", () => {
  test("clears every timer and ignores later events", () => {
    const disposed = play(
      createOpenInAppState(),
      { type: "apps.requested", openWith: ["Zed", "code"] },
      { type: "app.checked", attempt: 1, openWith: "Zed", installed: true },
      { ...header },
      { type: "disposed" },
    )

    expect(disposed.effects.slice(-2)).toEqual([
      { type: "clear-timer", attempt: 2 },
      { type: "clear-timer", attempt: 3 },
    ])
    expect(isOpenInAppLaunching(disposed.state)).toBe(false)

    const late = play(disposed.state, { type: "launch.failed", attempt: 3, error: "exit 1" }, header)

    expect(late.state).toBe(disposed.state)
    expect(late.effects).toEqual([])
  })
})
