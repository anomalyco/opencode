import { describe, expect, test } from "bun:test"
import {
  CODE_TIMEOUT_MS,
  REMOTE_CHANGE_TIMEOUT_MS,
  REMOTE_READ_TIMEOUT_MS,
  TUNNEL_RETRIES,
  TUNNEL_TIMEOUT_MS,
  createPairingState,
  dialogUrl,
  remainingSeconds,
  transitionPairing,
  viewDialog,
  viewPairingPage,
  type PairingEffect,
  type PairingEvent,
  type PairingState,
} from "./machine"

const TUNNEL = "https://pair.example"

// Folds the events in order, keeping every effect the machine asked for.
const replay = (events: readonly PairingEvent[], state: PairingState = createPairingState()) =>
  events.reduce<{ state: PairingState; effects: readonly PairingEffect[] }>(
    (last, event) => {
      const next = transitionPairing(last.state, event)

      return { state: next.state, effects: [...last.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const step = (state: PairingState, event: PairingEvent) => transitionPairing(state, event)

// Main generation 1 is active and the server is listed; the first read is attempt 1.
const started = replay([
  { type: "server.changed", available: true },
  { type: "main.changed", main: { status: "active", generation: 1 } },
]).state

const setRemote = (attempt: number, enabled: boolean, restart: boolean): PairingEffect => ({
  type: "set-remote",
  generation: 1,
  attempt,
  enabled,
  restart,
  timeoutMs: REMOTE_CHANGE_TIMEOUT_MS,
})

// Remote access is on and the dialog polls for the tunnel with attempt 2.
const polling = replay(
  [{ type: "dialog.opened" }, { type: "read.succeeded", attempt: 1, enabled: true }],
  started,
).state

// The dialog shows a code that expires 60 s after it loaded at 1000.
const ready = replay(
  [
    { type: "tunnel.found", attempt: 2, tunnel: TUNNEL },
    { type: "code.loaded", attempt: 3, code: "abc", expiresIn: 60, now: 1_000 },
  ],
  polling,
).state

describe("transitionPairing", () => {
  test("starting reads the setting through the active generation", () => {
    expect(started.remote).toEqual({ status: "loading", generation: 1, attempt: 1 })
    expect(
      step(replay([{ type: "server.changed", available: true }]).state, {
        type: "main.changed",
        main: { status: "active", generation: 1 },
      }).effects,
    ).toEqual([{ type: "read-remote", generation: 1, attempt: 1, timeoutMs: REMOTE_READ_TIMEOUT_MS }])
  })

  test("main going inactive while the dialog turns remote access on shows unavailable, not an endless spinner", () => {
    const turning = replay([{ type: "dialog.opened" }, { type: "read.succeeded", attempt: 1, enabled: false }], started)

    expect(turning.effects).toContainEqual(setRemote(2, true, false))
    expect(viewDialog(turning.state.dialog)).toEqual({ kind: "loading", setup: true })

    const inactive = step(turning.state, { type: "main.changed", main: { status: "inactive" } })

    expect(inactive.effects).toEqual([{ type: "abort", attempt: 2 }])
    expect(viewDialog(inactive.state.dialog)).toEqual({ kind: "unavailable" })
    expect(viewPairingPage(inactive.state)).toMatchObject({ unavailable: true, pairDisabled: true, mainActive: false })

    // Main coming back reads the setting again and sets up pairing.
    const back = replay(
      [
        { type: "main.changed", main: { status: "active", generation: 2 } },
        { type: "read.succeeded", attempt: 3, enabled: true },
      ],
      inactive.state,
    )

    expect(back.state.dialog).toEqual({ status: "tunnel", attempt: 4, step: "polling", retries: 0 })
  })

  test("main going inactive turns a failed dialog unavailable, so Try again cannot call a missing main", () => {
    const failed = replay([{ type: "dialog.opened" }, { type: "read.failed", attempt: 1 }], started).state

    expect(viewDialog(failed.dialog)).toEqual({ kind: "failed" })

    const inactive = step(failed, { type: "main.changed", main: { status: "inactive" } }).state

    expect(viewDialog(inactive.dialog)).toEqual({ kind: "unavailable" })
    expect(step(inactive, { type: "retry" })).toEqual({ state: inactive, effects: [] })
  })

  test("the local server going away ends the code refresh and shows unavailable", () => {
    const refreshing = step(ready, { type: "code.refresh" }).state
    const gone = step(refreshing, { type: "server.changed", available: false })

    expect(gone.effects).toEqual([{ type: "abort", attempt: 4 }])
    expect(viewDialog(gone.state.dialog)).toEqual({ kind: "unavailable" })
    expect(viewPairingPage(gone.state).unavailable).toBe(true)
  })

  test("a failure after the code loaded replaces the QR code instead of stacking under it", () => {
    expect(viewDialog(ready.dialog)).toMatchObject({ kind: "ready", url: `${TUNNEL}/auth/connect/abc` })

    const failed = replay(
      [
        { type: "main.changed", main: { status: "active", generation: 2 } },
        { type: "read.failed", attempt: 4 },
      ],
      ready,
    ).state

    expect(viewDialog(failed.dialog)).toEqual({ kind: "failed" })
    expect(dialogUrl(failed.dialog)).toBeUndefined()
  })

  test("a failed switch change does not open the dialog into a failure: opening tries again", () => {
    const failed = replay(
      [
        { type: "read.succeeded", attempt: 1, enabled: false },
        { type: "toggled", enabled: true },
        { type: "change.failed", attempt: 2 },
      ],
      started,
    ).state

    expect(viewPairingPage(failed)).toMatchObject({ remoteError: true, remoteChecked: false, remoteDisabled: false })

    const opened = step(failed, { type: "dialog.opened" })

    expect(opened.effects).toEqual([{ type: "open-dialog" }, setRemote(3, true, false)])
    expect(viewDialog(opened.state.dialog)).toEqual({ kind: "loading", setup: true })

    const on = step(opened.state, { type: "change.succeeded", attempt: 3 }).state

    expect(viewPairingPage(on).remoteError).toBe(false)
    expect(on.dialog).toEqual({ status: "tunnel", attempt: 4, step: "polling", retries: 0 })
  })

  test("Try again after the tunnel never connected restarts the service and polls afresh", () => {
    const exhausted = Array.from({ length: TUNNEL_RETRIES * 2 + 1 }).reduce<PairingState>((state) => {
      const dialog = state.dialog

      if (dialog.status !== "tunnel") return state

      return step(
        state,
        dialog.step === "polling"
          ? { type: "tunnel.missing", attempt: dialog.attempt }
          : { type: "tunnel.due", attempt: dialog.attempt },
      ).state
    }, polling)

    expect(exhausted.dialog).toEqual({ status: "failed", reason: "tunnel" })

    // Remote access is still on: the failure waits for the user instead of polling again.
    const reread = replay(
      [
        { type: "main.changed", main: { status: "active", generation: 2 } },
        { type: "read.succeeded", attempt: exhausted.issued + 1, enabled: true },
      ],
      exhausted,
    ).state

    expect(reread.dialog).toEqual({ status: "failed", reason: "tunnel" })

    const retry = step(exhausted, { type: "retry" })

    expect(retry.effects).toEqual([setRemote(exhausted.issued + 1, true, true)])
    // The old tunnel failure no longer shows while the service restarts.
    expect(viewDialog(retry.state.dialog)).toEqual({ kind: "loading", setup: true })

    // A second click on the gone button changes nothing.
    expect(step(retry.state, { type: "retry" }).state).toBe(retry.state)

    const restarted = step(retry.state, { type: "change.succeeded", attempt: exhausted.issued + 1 })

    expect(restarted.state.dialog).toMatchObject({ status: "tunnel", step: "polling", retries: 0 })
    expect(viewDialog(restarted.state.dialog)).toEqual({ kind: "loading", setup: true })
  })

  test("Pair device during the first read waits for it instead of changing the setting alongside", () => {
    const opened = step(started, { type: "dialog.opened" })

    expect(opened.effects).toEqual([{ type: "open-dialog" }])

    const on = step(opened.state, { type: "read.succeeded", attempt: 1, enabled: true })

    expect(on.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "poll-tunnel", attempt: 2, timeoutMs: TUNNEL_TIMEOUT_MS },
    ])

    const off = step(opened.state, { type: "read.succeeded", attempt: 1, enabled: false })

    expect(off.effects).toEqual([{ type: "abort", attempt: 1 }, setRemote(2, true, false)])
    expect(step(off.state, { type: "dialog.opened" }).state).toBe(off.state)
  })

  test("main restarting is a suspension: the code stays on screen", () => {
    const pending = step(ready, { type: "main.changed", main: { status: "pending" } }).state

    expect(pending.dialog).toBe(ready.dialog)
    expect(viewPairingPage(pending).mainActive).toBe(false)

    const back = replay(
      [
        { type: "main.changed", main: { status: "active", generation: 2 } },
        { type: "read.succeeded", attempt: 4, enabled: true },
      ],
      pending,
    ).state

    expect(back.dialog).toBe(ready.dialog)
  })

  test("a refresh keeps the code on screen, and a failed one offers to try again", () => {
    const refreshing = step(ready, { type: "code.refresh" })

    expect(refreshing.effects).toEqual([{ type: "fetch-code", attempt: 4, timeoutMs: CODE_TIMEOUT_MS }])
    expect(viewDialog(refreshing.state.dialog)).toMatchObject({ kind: "ready", refreshing: true })
    expect(step(refreshing.state, { type: "code.refresh" }).state).toBe(refreshing.state)

    const failed = step(refreshing.state, { type: "code.failed", attempt: 4 }).state

    expect(viewDialog(failed.dialog)).toEqual({ kind: "code-error" })

    const again = step(failed, { type: "code.refresh" })

    expect(again.effects).toEqual([{ type: "fetch-code", attempt: 5, timeoutMs: CODE_TIMEOUT_MS }])
    expect(viewDialog(again.state.dialog)).toEqual({ kind: "loading", setup: false })

    const loaded = step(again.state, { type: "code.loaded", attempt: 5, code: "def", expiresIn: 60, now: 2_000 })

    expect(dialogUrl(loaded.state.dialog)).toBe(`${TUNNEL}/auth/connect/def`)
  })

  test("the clock replaces a code once it expires, even after the window slept past it", () => {
    expect(remainingSeconds(ready.dialog, 1_000)).toBe(60)
    expect(remainingSeconds(ready.dialog, 500)).toBe(60)
    expect(step(ready, { type: "tick", now: 60_999 }).state).toBe(ready)

    const expired = step(ready, { type: "tick", now: 600_000 })

    expect(remainingSeconds(ready.dialog, 600_000)).toBe(0)
    expect(expired.effects).toEqual([{ type: "fetch-code", attempt: 4, timeoutMs: CODE_TIMEOUT_MS }])
    expect(step(expired.state, { type: "tick", now: 601_000 }).state).toBe(expired.state)
  })

  test("answers for another attempt change nothing", () => {
    expect(step(started, { type: "read.succeeded", attempt: 9, enabled: true }).state).toBe(started)
    expect(step(polling, { type: "tunnel.found", attempt: 1, tunnel: TUNNEL }).state).toBe(polling)
    expect(step(polling, { type: "tunnel.due", attempt: 2 }).state).toBe(polling)
    expect(step(ready, { type: "code.loaded", attempt: 3, code: "x", expiresIn: 60, now: 0 }).state).toBe(ready)
    expect(step(ready, { type: "change.succeeded", attempt: 1 }).state).toBe(ready)
    expect(step(started, { type: "main.changed", main: { status: "active", generation: 1 } }).state).toBe(started)
  })

  test("closing the dialog ends its requests; the setting keeps changing", () => {
    const turning = replay(
      [{ type: "dialog.opened" }, { type: "read.succeeded", attempt: 1, enabled: false }],
      started,
    ).state

    const closed = step(turning, { type: "dialog.closed" }).state

    expect(closed.dialog).toEqual({ status: "closed" })
    expect(closed.remote).toMatchObject({ status: "changing", enabled: true })
    expect(step(polling, { type: "dialog.closed" }).effects).toEqual([{ type: "abort", attempt: 2 }])
  })

  test("the switch cannot open pairing while it turns remote access off", () => {
    const off = replay(
      [
        { type: "read.succeeded", attempt: 1, enabled: true },
        { type: "toggled", enabled: false },
      ],
      started,
    )

    expect(off.effects).toContainEqual(setRemote(2, false, false))
    expect(viewPairingPage(off.state)).toMatchObject({ pairDisabled: true, remoteChecked: false, remoteDisabled: true })
    expect(step(off.state, { type: "toggled", enabled: true }).state).toBe(off.state)
  })

  test("disposing ends every request, closes the dialog and ignores later answers", () => {
    const refreshing = step(ready, { type: "code.refresh" }).state
    const reading = step(refreshing, { type: "main.changed", main: { status: "active", generation: 2 } }).state
    const disposed = step(reading, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "abort", attempt: 5 },
      { type: "abort", attempt: 4 },
      { type: "close-dialog" },
    ])
    expect(step(disposed.state, { type: "code.loaded", attempt: 4, code: "x", expiresIn: 1, now: 0 }).state).toBe(
      disposed.state,
    )
    expect(step(disposed.state, { type: "dialog.opened" }).state).toBe(disposed.state)
  })
})
