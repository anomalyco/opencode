import { describe, expect, test } from "bun:test"
import {
  createScannerState,
  SCANNER_COOLDOWN_MS,
  SCANNER_REDEEM_TIMEOUT_MS,
  selectScannerView,
  transitionScanner,
  type ScannerEffect,
  type ScannerEvent,
  type ScannerState,
} from "./scanner-machine"

function replay(events: ScannerEvent[], state = createScannerState()) {
  return events.reduce<{ state: ScannerState; effects: readonly ScannerEffect[] }>(
    (step, event) => transitionScanner(step.state, event),
    { state, effects: [] },
  )
}

const expired = { type: "redeem", message: "This pairing link expired" } as const

describe("pairing scanner machine", () => {
  test("a frame that fails to decode keeps the redemption error readable", () => {
    const failed = replay([
      { type: "camera.ready" },
      { type: "code.detected", data: "bad" },
      { type: "redeem.failed", attempt: 1, error: expired },
    ])

    const decoded = transitionScanner(failed.state, { type: "decode.failed" })

    expect(decoded.state).toBe(failed.state)
    expect(selectScannerView(decoded.state)).toEqual({ overlay: undefined, error: expired })
    expect(selectScannerView(replay([{ type: "camera.ready" }, { type: "decode.failed" }]).state).error).toEqual({
      type: "decode",
    })
  })

  test("a paired code stops scanning, so later frames cannot redeem again", () => {
    const paired = replay([
      { type: "camera.ready" },
      { type: "code.detected", data: "good" },
      { type: "redeem.succeeded", attempt: 1, link: "https://host/auth/connect/abc" },
    ])

    expect(paired.state).toEqual({ status: "done" })
    expect(paired.effects).toEqual([
      { type: "redeem.timer.stop" },
      { type: "cooldown.clear" },
      { type: "scanner.stop" },
      { type: "complete", link: "https://host/auth/connect/abc" },
    ])
    expect(transitionScanner(paired.state, { type: "code.detected", data: "good" }).effects).toEqual([])
    expect(transitionScanner(paired.state, { type: "decode.failed" }).state).toBe(paired.state)
  })

  test("codes are ignored before the camera starts and after it fails", () => {
    const starting = createScannerState()
    expect(transitionScanner(starting, { type: "code.detected", data: "a" }).state).toBe(starting)

    const failed = transitionScanner(starting, { type: "camera.failed" })
    expect(failed.effects).toEqual([{ type: "scanner.stop" }])
    expect(selectScannerView(failed.state)).toEqual({ overlay: undefined, error: { type: "camera" } })
    expect(transitionScanner(failed.state, { type: "code.detected", data: "a" }).state).toBe(failed.state)
  })

  test("a redemption that hangs times out, and a failed code cools down on its own", () => {
    const redeeming = replay([{ type: "camera.ready" }, { type: "code.detected", data: "a" }])
    expect(redeeming.effects).toEqual([{ type: "redeem", attempt: 1, data: "a", timeoutMs: SCANNER_REDEEM_TIMEOUT_MS }])
    expect(selectScannerView(redeeming.state).overlay).toBe("redeeming")
    // One redemption at a time.
    expect(transitionScanner(redeeming.state, { type: "code.detected", data: "b" }).state).toBe(redeeming.state)

    const timedOut = transitionScanner(redeeming.state, { type: "redeem.timed-out", attempt: 1 })
    expect(selectScannerView(timedOut.state)).toEqual({ overlay: undefined, error: { type: "timeout" } })
    expect(timedOut.effects).toEqual([{ type: "cooldown.start", code: "a", attempt: 1, delayMs: SCANNER_COOLDOWN_MS }])
    // The late answer of the abandoned redemption changes nothing.
    expect(transitionScanner(timedOut.state, { type: "redeem.succeeded", attempt: 1, link: "x" }).state).toBe(
      timedOut.state,
    )

    expect(transitionScanner(timedOut.state, { type: "code.detected", data: "a" }).state).toBe(timedOut.state)
    const other = transitionScanner(timedOut.state, { type: "code.detected", data: "b" })
    expect(other.effects).toEqual([{ type: "redeem", attempt: 2, data: "b", timeoutMs: SCANNER_REDEEM_TIMEOUT_MS }])

    const refailed = transitionScanner(other.state, { type: "redeem.failed", attempt: 2, error: { type: "invalid" } })
    const cooled = transitionScanner(refailed.state, { type: "cooldown.expired", code: "a", attempt: 1 })
    expect(transitionScanner(cooled.state, { type: "code.detected", data: "a" }).effects).toEqual([
      { type: "redeem", attempt: 3, data: "a", timeoutMs: SCANNER_REDEEM_TIMEOUT_MS },
    ])
    expect(transitionScanner(cooled.state, { type: "code.detected", data: "b" }).state).toBe(cooled.state)
  })

  test("a stale cooldown timer does not end a newer cooldown of the same code", () => {
    const first = replay([
      { type: "camera.ready" },
      { type: "code.detected", data: "a" },
      { type: "redeem.failed", attempt: 1, error: { type: "invalid" } },
      { type: "cooldown.expired", code: "a", attempt: 1 },
      { type: "code.detected", data: "a" },
      { type: "redeem.failed", attempt: 2, error: { type: "invalid" } },
    ])

    expect(transitionScanner(first.state, { type: "cooldown.expired", code: "a", attempt: 1 }).state).toBe(first.state)
  })

  test("unmounting clears the timers and ignores late results", () => {
    const redeeming = replay([{ type: "camera.ready" }, { type: "code.detected", data: "a" }])
    const disposed = transitionScanner(redeeming.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "redeem.timer.stop" }, { type: "cooldown.clear" }])
    expect(transitionScanner(disposed.state, { type: "redeem.succeeded", attempt: 1, link: "x" }).effects).toEqual([])
  })
})
