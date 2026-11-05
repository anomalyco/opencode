import { describe, expect, test } from "bun:test"
import {
  CODE_TIMEOUT_MS,
  REMOTE_CHANGE_TIMEOUT_MS,
  REMOTE_READ_RETRIES,
  REMOTE_READ_TIMEOUT_MS,
  SCREEN_TIMEOUT_MS,
  TUNNEL_RETRIES,
  TUNNEL_RETRY_DELAY_MS,
  TUNNEL_TIMEOUT_MS,
  createPairingState,
  dialogUrl,
  pairingEffectFailed,
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

// Fails every read of one setting, and ends every wait between them, until the machine stops reading it.
const failReads = (state: PairingState, setting: "remote" | "screen" = "remote") =>
  Array.from({ length: (REMOTE_READ_RETRIES + 1) * 2 }).reduce<{
    state: PairingState
    effects: readonly PairingEffect[]
  }>(
    (last) => {
      const current = last.state[setting]

      if (current.status !== "loading") return last

      const attempt = current.attempt
      const reading = current.step === "reading"

      const remote: PairingEvent = reading
        ? { type: "read.failed", attempt }
        : { type: "wait.ended", for: "read", attempt }

      const screen: PairingEvent = reading
        ? { type: "screen.read.failed", attempt }
        : { type: "wait.ended", for: "screen", attempt }

      const next = step(last.state, setting === "remote" ? remote : screen)

      return { state: next.state, effects: [...last.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

// Main generation 1 is active and the server is listed; the first reads are attempt 1 (remote access) and 2 (display).
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

// Remote access is on and the dialog polls for the tunnel with attempt 3.
const polling = replay(
  [{ type: "dialog.opened" }, { type: "read.succeeded", attempt: 1, enabled: true }],
  started,
).state

// The dialog shows a code that expires 60 s after it loaded at 1000.
const ready = replay(
  [
    { type: "tunnel.found", attempt: 3, tunnel: TUNNEL },
    { type: "code.loaded", attempt: 4, code: "abc", expiresIn: 60, now: 1_000 },
  ],
  polling,
).state

const setScreen = (generation: number, attempt: number, enabled: boolean): PairingEffect => ({
  type: "set-screen",
  generation,
  attempt,
  enabled,
  timeoutMs: SCREEN_TIMEOUT_MS,
})

describe("transitionPairing", () => {
  test("starting reads both settings through the active generation", () => {
    expect(started.remote).toEqual({ status: "loading", generation: 1, attempt: 1, step: "reading", failures: 0 })
    expect(started.screen).toEqual({ status: "loading", generation: 1, attempt: 2, step: "reading", failures: 0 })
    expect(
      step(replay([{ type: "server.changed", available: true }]).state, {
        type: "main.changed",
        main: { status: "active", generation: 1 },
      }).effects,
    ).toEqual([
      { type: "read-remote", generation: 1, attempt: 1, timeoutMs: REMOTE_READ_TIMEOUT_MS },
      { type: "read-screen", generation: 1, attempt: 2, timeoutMs: SCREEN_TIMEOUT_MS },
    ])
  })

  test("main going inactive while the dialog turns remote access on shows unavailable, not an endless spinner", () => {
    const turning = replay([{ type: "dialog.opened" }, { type: "read.succeeded", attempt: 1, enabled: false }], started)

    expect(turning.effects).toContainEqual(setRemote(3, true, false))
    expect(viewDialog(turning.state.dialog)).toEqual({ kind: "loading", setup: true })

    const inactive = step(turning.state, { type: "main.changed", main: { status: "inactive" } })

    expect(inactive.effects).toEqual([
      { type: "abort", attempt: 3 },
      { type: "abort", attempt: 2 },
    ])
    expect(viewDialog(inactive.state.dialog)).toEqual({ kind: "unavailable" })
    expect(viewPairingPage(inactive.state)).toMatchObject({ unavailable: true, pairDisabled: true, mainActive: false })

    // Main coming back reads the setting again and sets up pairing.
    const back = replay(
      [
        { type: "main.changed", main: { status: "active", generation: 2 } },
        { type: "read.succeeded", attempt: 4, enabled: true },
      ],
      inactive.state,
    )

    expect(back.state.dialog).toEqual({ status: "tunnel", attempt: 6, step: "polling", retries: 0 })
  })

  test("a failed read tries again three times with backoff, as the query's default retries did", () => {
    const failed = step(started, { type: "read.failed", attempt: 1 })

    expect(failed.state.remote).toEqual({ status: "loading", generation: 1, attempt: 3, step: "waiting", failures: 1 })
    expect(failed.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "wait", for: "read", attempt: 3, delayMs: 1_000 },
    ])
    // The page keeps the row loading meanwhile, without the error.
    expect(viewPairingPage(failed.state)).toMatchObject({ remoteError: false, remoteDisabled: true })
    // A late answer from the failed read changes nothing.
    expect(step(failed.state, { type: "read.succeeded", attempt: 1, enabled: true }).state).toBe(failed.state)

    const again = step(failed.state, { type: "wait.ended", for: "read", attempt: 3 })

    expect(again.effects).toEqual([
      { type: "abort", attempt: 3 },
      { type: "read-remote", generation: 1, attempt: 4, timeoutMs: REMOTE_READ_TIMEOUT_MS },
    ])
    expect(step(again.state, { type: "read.succeeded", attempt: 4, enabled: true }).state.remote).toEqual({
      status: "ready",
      generation: 1,
      enabled: true,
    })

    const exhausted = failReads(started)

    expect(exhausted.effects.flatMap((effect) => (effect.type === "wait" ? [effect.delayMs] : []))).toEqual([
      1_000, 2_000, 4_000,
    ])
    expect(exhausted.effects.filter((effect) => effect.type === "read-remote")).toHaveLength(REMOTE_READ_RETRIES)
    expect(exhausted.state.remote).toEqual({ status: "failed", generation: 1, previous: undefined })
  })

  test("a tunnel wait that ends while main restarts and the setting is read again still polls", () => {
    const waiting = step(polling, { type: "tunnel.missing", attempt: 3 })

    expect(waiting.effects).toContainEqual({ type: "wait", for: "tunnel", attempt: 4, delayMs: TUNNEL_RETRY_DELAY_MS })

    // Main restarts: the dialog keeps its tunnel wait while the new generation reads the setting, and that read fails.
    const reading = step(waiting.state, { type: "main.changed", main: { status: "active", generation: 2 } }).state
    const retrying = step(reading, { type: "read.failed", attempt: 5 }).state

    expect(retrying.remote).toMatchObject({ status: "loading", step: "waiting", attempt: 7 })
    expect(retrying.dialog).toEqual({ status: "tunnel", attempt: 4, step: "waiting", retries: 1 })

    // The tunnel wait ends during the read, and during the read's own wait: neither swallows it.
    ;[reading, retrying].forEach((state) => {
      const polled = step(state, { type: "wait.ended", for: "tunnel", attempt: 4 })

      expect(polled.state.dialog).toEqual({ status: "tunnel", attempt: state.issued + 1, step: "polling", retries: 1 })
      expect(polled.effects).toContainEqual({
        type: "poll-tunnel",
        attempt: state.issued + 1,
        timeoutMs: TUNNEL_TIMEOUT_MS,
      })
      expect(polled.state.remote).toBe(state.remote)
    })

    // The read's wait ends on its own branch and leaves the tunnel wait alone.
    const reread = step(retrying, { type: "wait.ended", for: "read", attempt: 7 })

    expect(reread.state.dialog).toBe(retrying.dialog)
    expect(reread.effects).toContainEqual({
      type: "read-remote",
      generation: 2,
      attempt: 8,
      timeoutMs: REMOTE_READ_TIMEOUT_MS,
    })
    // A wait for one phase never ends another with the same attempt number.
    expect(step(retrying, { type: "wait.ended", for: "read", attempt: 4 }).state).toBe(retrying)
    expect(step(retrying, { type: "wait.ended", for: "tunnel", attempt: 7 }).state).toBe(retrying)
    expect(step(retrying, { type: "wait.ended", for: "screen", attempt: 4 }).state).toBe(retrying)
    expect(step(retrying, { type: "wait.ended", for: "screen", attempt: 7 }).state).toBe(retrying)
  })

  test("after reads give up, the switch still works: its change reads the setting first", () => {
    const failed = failReads(started).state

    expect(viewPairingPage(failed)).toMatchObject({ remoteError: true, remoteDisabled: false, remoteChecked: false })

    const toggled = step(failed, { type: "toggled", enabled: true })

    expect(toggled.effects).toEqual([setRemote(failed.issued + 1, true, false)])
    expect(viewPairingPage(toggled.state)).toMatchObject({ remoteError: false, remoteChecked: true })

    const on = step(toggled.state, { type: "change.succeeded", attempt: failed.issued + 1 }).state

    expect(on.remote).toEqual({ status: "ready", generation: 1, enabled: true })
  })

  test("main going inactive turns a failed dialog unavailable, so Try again cannot call a missing main", () => {
    const failed = failReads(step(started, { type: "dialog.opened" }).state).state

    expect(viewDialog(failed.dialog)).toEqual({ kind: "failed" })

    const inactive = step(failed, { type: "main.changed", main: { status: "inactive" } }).state

    expect(viewDialog(inactive.dialog)).toEqual({ kind: "unavailable" })
    expect(step(inactive, { type: "retry" })).toEqual({ state: inactive, effects: [] })
  })

  test("the local server going away ends the code refresh and shows unavailable", () => {
    const refreshing = step(ready, { type: "code.refresh" }).state
    const gone = step(refreshing, { type: "server.changed", available: false })

    expect(gone.effects).toEqual([{ type: "abort", attempt: 5 }])
    expect(viewDialog(gone.state.dialog)).toEqual({ kind: "unavailable" })
    expect(viewPairingPage(gone.state).unavailable).toBe(true)
  })

  test("a failure after the code loaded replaces the QR code instead of stacking under it", () => {
    expect(viewDialog(ready.dialog)).toMatchObject({ kind: "ready", url: `${TUNNEL}/auth/connect/abc` })

    const reading = step(ready, { type: "main.changed", main: { status: "active", generation: 2 } }).state

    // Retries keep the code on screen; only the read that gives up replaces it.
    expect(step(reading, { type: "read.failed", attempt: 5 }).state.dialog).toBe(ready.dialog)

    const failed = failReads(reading).state

    expect(viewDialog(failed.dialog)).toEqual({ kind: "failed" })
    expect(dialogUrl(failed.dialog)).toBeUndefined()
  })

  test("a failed switch change does not open the dialog into a failure: opening tries again", () => {
    const failed = replay(
      [
        { type: "read.succeeded", attempt: 1, enabled: false },
        { type: "toggled", enabled: true },
        { type: "change.failed", attempt: 3 },
      ],
      started,
    ).state

    expect(viewPairingPage(failed)).toMatchObject({ remoteError: true, remoteChecked: false, remoteDisabled: false })

    const opened = step(failed, { type: "dialog.opened" })

    expect(opened.effects).toEqual([{ type: "open-dialog" }, setRemote(4, true, false)])
    expect(viewDialog(opened.state.dialog)).toEqual({ kind: "loading", setup: true })

    const on = step(opened.state, { type: "change.succeeded", attempt: 4 }).state

    expect(viewPairingPage(on).remoteError).toBe(false)
    expect(on.dialog).toEqual({ status: "tunnel", attempt: 5, step: "polling", retries: 0 })
  })

  test("Try again after the tunnel never connected restarts the service and polls afresh", () => {
    const exhausted = Array.from({ length: TUNNEL_RETRIES * 2 + 1 }).reduce<PairingState>((state) => {
      const dialog = state.dialog

      if (dialog.status !== "tunnel") return state

      return step(
        state,
        dialog.step === "polling"
          ? { type: "tunnel.missing", attempt: dialog.attempt }
          : { type: "wait.ended", for: "tunnel", attempt: dialog.attempt },
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
      { type: "poll-tunnel", attempt: 3, timeoutMs: TUNNEL_TIMEOUT_MS },
    ])

    const off = step(opened.state, { type: "read.succeeded", attempt: 1, enabled: false })

    expect(off.effects).toEqual([{ type: "abort", attempt: 1 }, setRemote(3, true, false)])
    expect(step(off.state, { type: "dialog.opened" }).state).toBe(off.state)
  })

  test("main restarting is a suspension: the code stays on screen", () => {
    const pending = step(ready, { type: "main.changed", main: { status: "pending" } }).state

    expect(pending.dialog).toBe(ready.dialog)
    expect(viewPairingPage(pending).mainActive).toBe(false)

    const back = replay(
      [
        { type: "main.changed", main: { status: "active", generation: 2 } },
        { type: "read.succeeded", attempt: 5, enabled: true },
      ],
      pending,
    ).state

    expect(back.dialog).toBe(ready.dialog)
  })

  test("a refresh keeps the code on screen, and a failed one offers to try again", () => {
    const refreshing = step(ready, { type: "code.refresh" })

    expect(refreshing.effects).toEqual([{ type: "fetch-code", attempt: 5, timeoutMs: CODE_TIMEOUT_MS }])
    expect(viewDialog(refreshing.state.dialog)).toMatchObject({ kind: "ready", refreshing: true })
    expect(step(refreshing.state, { type: "code.refresh" }).state).toBe(refreshing.state)

    const failed = step(refreshing.state, { type: "code.failed", attempt: 5 }).state

    expect(viewDialog(failed.dialog)).toEqual({ kind: "code-error" })

    const again = step(failed, { type: "code.refresh" })

    expect(again.effects).toEqual([{ type: "fetch-code", attempt: 6, timeoutMs: CODE_TIMEOUT_MS }])
    expect(viewDialog(again.state.dialog)).toEqual({ kind: "loading", setup: false })

    const loaded = step(again.state, { type: "code.loaded", attempt: 6, code: "def", expiresIn: 60, now: 2_000 })

    expect(dialogUrl(loaded.state.dialog)).toBe(`${TUNNEL}/auth/connect/def`)
  })

  test("the clock replaces a code once it expires, even after the window slept past it", () => {
    expect(remainingSeconds(ready.dialog, 1_000)).toBe(60)
    expect(remainingSeconds(ready.dialog, 500)).toBe(60)
    expect(step(ready, { type: "tick", now: 60_999 }).state).toBe(ready)

    const expired = step(ready, { type: "tick", now: 600_000 })

    expect(remainingSeconds(ready.dialog, 600_000)).toBe(0)
    expect(expired.effects).toEqual([{ type: "fetch-code", attempt: 5, timeoutMs: CODE_TIMEOUT_MS }])
    expect(step(expired.state, { type: "tick", now: 601_000 }).state).toBe(expired.state)
  })

  test("answers for another attempt change nothing", () => {
    expect(step(started, { type: "read.succeeded", attempt: 9, enabled: true }).state).toBe(started)
    expect(step(polling, { type: "tunnel.found", attempt: 1, tunnel: TUNNEL }).state).toBe(polling)
    expect(step(polling, { type: "wait.ended", for: "tunnel", attempt: 3 }).state).toBe(polling)
    expect(step(ready, { type: "code.loaded", attempt: 4, code: "x", expiresIn: 60, now: 0 }).state).toBe(ready)
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
    expect(step(polling, { type: "dialog.closed" }).effects).toEqual([{ type: "abort", attempt: 3 }])
  })

  test("the switch cannot open pairing while it turns remote access off", () => {
    const off = replay(
      [
        { type: "read.succeeded", attempt: 1, enabled: true },
        { type: "toggled", enabled: false },
      ],
      started,
    )

    expect(off.effects).toContainEqual(setRemote(3, false, false))
    expect(viewPairingPage(off.state)).toMatchObject({ pairDisabled: true, remoteChecked: false, remoteDisabled: true })
    expect(step(off.state, { type: "toggled", enabled: true }).state).toBe(off.state)
  })

  test("disposing ends every request, closes the dialog and ignores later answers", () => {
    const refreshing = step(ready, { type: "code.refresh" }).state
    const reading = step(refreshing, { type: "main.changed", main: { status: "active", generation: 2 } }).state
    const disposed = step(reading, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "abort", attempt: 6 },
      { type: "abort", attempt: 7 },
      { type: "abort", attempt: 5 },
      { type: "close-dialog" },
    ])
    expect(step(disposed.state, { type: "code.loaded", attempt: 5, code: "x", expiresIn: 1, now: 0 }).state).toBe(
      disposed.state,
    )
    expect(step(disposed.state, { type: "screen.read.succeeded", attempt: 7, enabled: true }).state).toBe(
      disposed.state,
    )
    expect(step(disposed.state, { type: "dialog.opened" }).state).toBe(disposed.state)
  })
})

describe("the display sleep setting", () => {
  test("reads that give up offer Try again and keep the switch enabled", () => {
    const exhausted = failReads(started, "screen")

    expect(exhausted.effects.flatMap((effect) => (effect.type === "wait" ? [effect.delayMs] : []))).toEqual([
      1_000, 2_000, 4_000,
    ])
    expect(exhausted.effects.filter((effect) => effect.type === "read-screen")).toHaveLength(REMOTE_READ_RETRIES)
    expect(exhausted.state.screen).toEqual({ status: "failed", generation: 1, previous: undefined })
    // Remote access goes on reading on its own.
    expect(exhausted.state.remote).toBe(started.remote)
    // The query kept the switch disabled on its error, with "Try again" under it and no way to.
    expect(viewPairingPage(exhausted.state)).toMatchObject({
      screenError: true,
      screenDisabled: false,
      screenChecked: false,
    })

    // "Try again" reads the setting afresh, with its own retries.
    const retried = step(exhausted.state, { type: "screen.retry" })
    const read = exhausted.state.issued + 1

    expect(retried.effects).toEqual([
      { type: "read-screen", generation: 1, attempt: read, timeoutMs: SCREEN_TIMEOUT_MS },
    ])
    expect(retried.state.screen).toEqual({ status: "loading", generation: 1, attempt: read, step: "reading", failures: 0 })
    expect(viewPairingPage(retried.state)).toMatchObject({ screenError: false, screenDisabled: true })
    expect(step(retried.state, { type: "screen.retry" }).state).toBe(retried.state)
    expect(step(retried.state, { type: "screen.read.succeeded", attempt: read, enabled: true }).state.screen).toEqual({
      status: "ready",
      generation: 1,
      enabled: true,
    })

    const toggled = step(exhausted.state, { type: "screen.toggled", enabled: true })
    const attempt = exhausted.state.issued + 1

    expect(toggled.effects).toEqual([setScreen(1, attempt, true)])
    expect(viewPairingPage(toggled.state)).toMatchObject({
      screenError: false,
      screenDisabled: true,
      screenChecked: true,
    })
    // A second flip while the change runs waits for it.
    expect(step(toggled.state, { type: "screen.toggled", enabled: false }).state).toBe(toggled.state)

    const on = step(toggled.state, { type: "screen.change.succeeded", attempt })

    expect(on.state.screen).toEqual({ status: "ready", generation: 1, enabled: true })
    expect(on.effects).toEqual([{ type: "abort", attempt }])
  })

  test("a change that finishes after main restarts never writes into the new generation, and errors do not carry over", () => {
    const changing = replay(
      [
        { type: "screen.read.succeeded", attempt: 2, enabled: false },
        { type: "screen.toggled", enabled: true },
      ],
      started,
    )

    expect(changing.effects).toContainEqual(setScreen(1, 3, true))

    const restarted = step(changing.state, { type: "main.changed", main: { status: "active", generation: 2 } })

    expect(restarted.effects).toContainEqual({ type: "abort", attempt: 3 })
    expect(restarted.effects).toContainEqual({
      type: "read-screen",
      generation: 2,
      attempt: 5,
      timeoutMs: SCREEN_TIMEOUT_MS,
    })

    const read = step(restarted.state, { type: "screen.read.succeeded", attempt: 5, enabled: false }).state

    expect(read.screen).toEqual({ status: "ready", generation: 2, enabled: false })
    // The old generation's change answers late; the query wrote it under generation 2's key.
    expect(step(read, { type: "screen.change.succeeded", attempt: 3 }).state).toBe(read)
    expect(step(read, { type: "screen.change.failed", attempt: 3 }).state).toBe(read)

    // A failure on generation 1 never shows under whatever main is next.
    const failed = step(changing.state, { type: "screen.change.failed", attempt: 3 }).state

    expect(viewPairingPage(failed).screenError).toBe(true)
    ;([{ status: "pending" }, { status: "inactive" }, { status: "active", generation: 2 }] as const).forEach((main) => {
      expect(viewPairingPage(step(failed, { type: "main.changed", main }).state).screenError).toBe(false)
    })
  })

  test("a failed change shows the setting it left and allows another try", () => {
    const on = replay([{ type: "screen.read.succeeded", attempt: 2, enabled: true }], started).state

    // Flipping to the value it already has changes nothing.
    expect(step(on, { type: "screen.toggled", enabled: true }).state).toBe(on)

    const toggled = step(on, { type: "screen.toggled", enabled: false }).state

    expect(viewPairingPage(toggled)).toMatchObject({ screenChecked: false, screenDisabled: true, screenError: false })

    const failed = step(toggled, { type: "screen.change.failed", attempt: 3 }).state

    expect(viewPairingPage(failed)).toMatchObject({ screenChecked: true, screenDisabled: false, screenError: true })
    expect(step(failed, { type: "screen.toggled", enabled: false }).effects).toEqual([setScreen(1, 4, false)])
  })

  test("answers for another attempt change nothing, and disposing ends the running request", () => {
    const waiting = step(started, { type: "screen.read.failed", attempt: 2 })

    expect(waiting.effects).toEqual([
      { type: "abort", attempt: 2 },
      { type: "wait", for: "screen", attempt: 3, delayMs: 1_000 },
    ])
    // The remote read's wait and the tunnel's never end the display setting's wait with the same number.
    expect(step(waiting.state, { type: "wait.ended", for: "read", attempt: 3 }).state).toBe(waiting.state)
    expect(step(waiting.state, { type: "wait.ended", for: "tunnel", attempt: 3 }).state).toBe(waiting.state)
    expect(step(waiting.state, { type: "screen.read.succeeded", attempt: 2, enabled: true }).state).toBe(waiting.state)
    expect(step(started, { type: "screen.read.succeeded", attempt: 1, enabled: true }).state).toBe(started)
    expect(step(started, { type: "screen.change.succeeded", attempt: 2 }).state).toBe(started)
    expect(step(started, { type: "screen.toggled", enabled: true }).state).toBe(started)

    const reading = step(waiting.state, { type: "wait.ended", for: "screen", attempt: 3 })

    expect(reading.effects).toEqual([
      { type: "abort", attempt: 3 },
      { type: "read-screen", generation: 1, attempt: 4, timeoutMs: SCREEN_TIMEOUT_MS },
    ])

    const disposed = step(reading.state, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "abort", attempt: 4 },
    ])
    expect(step(disposed.state, { type: "screen.read.succeeded", attempt: 4, enabled: true }).state).toBe(
      disposed.state,
    )
  })

  test("a request that throws before it answers ends its phase", () => {
    expect(pairingEffectFailed(setScreen(1, 3, true))).toEqual({ type: "screen.change.failed", attempt: 3 })
    expect(
      pairingEffectFailed({ type: "read-screen", generation: 1, attempt: 2, timeoutMs: SCREEN_TIMEOUT_MS }),
    ).toEqual({ type: "screen.read.failed", attempt: 2 })
  })
})
