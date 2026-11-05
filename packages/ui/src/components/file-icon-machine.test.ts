import { expect, test } from "bun:test"
import {
  FILE_ICON_RELEASED,
  FILE_ICON_RETAINED,
  INITIAL_FILE_ICON_SYMBOL_STATE,
  READY_FILE_ICON_SYMBOL_STATE,
  selectFileIconSymbol,
  transitionFileIconSymbol,
  type FileIconSymbolEvent,
  type FileIconSymbolState,
  type FileIconSymbolTransition,
} from "./file-icon-machine"

function run(state: FileIconSymbolState, ...events: FileIconSymbolEvent[]) {
  return events.reduce<FileIconSymbolTransition>((result, event) => transitionFileIconSymbol(result.state, event), {
    state,
    effects: [],
  })
}

const shown = (state: FileIconSymbolState) => selectFileIconSymbol(state, "Typescript", "Document")

test("a failed chunk shows the fallback at once and one retry upgrades every mounted icon", () => {
  // The failure used to leave every mounted icon pointing at a symbol that never arrived, blank until a remount.
  const loading = run(INITIAL_FILE_ICON_SYMBOL_STATE, FILE_ICON_RETAINED, FILE_ICON_RETAINED)
  expect(loading.state).toEqual({ status: "loading", attempt: 1, consumers: 2, retried: false })
  expect(shown(loading.state)).toBe("Typescript")

  const failed = run(loading.state, { type: "load.failed", attempt: 1 })
  expect(failed.effects).toEqual([{ type: "schedule-retry", attempt: 1 }])
  expect(shown(failed.state)).toBe("Document")

  const retrying = run(failed.state, { type: "retry.due", attempt: 1 })
  expect(retrying.effects).toEqual([{ type: "load", attempt: 2 }])
  expect(shown(retrying.state)).toBe("Document")

  const ready = run(retrying.state, { type: "load.succeeded", attempt: 2, svg: "<svg/>" })
  expect(ready.state).toBe(READY_FILE_ICON_SYMBOL_STATE)
  expect(ready.effects).toEqual([{ type: "cancel-timers" }, { type: "insert-symbol", svg: "<svg/>" }])
  expect(shown(ready.state)).toBe("Typescript")
})

test("a stalled chunk times out, retries once and then stays on the fallback", () => {
  // A missing loader or a hung import used to keep the name requested forever, with no fallback and no retry.
  const exhausted = run(
    INITIAL_FILE_ICON_SYMBOL_STATE,
    FILE_ICON_RETAINED,
    { type: "load.timed-out", attempt: 1 },
    { type: "retry.due", attempt: 1 },
    { type: "load.timed-out", attempt: 2 },
  )
  expect(exhausted.state).toEqual({ status: "failed", attempt: 2, consumers: 1, retry: "idle" })
  expect(exhausted.effects).toEqual([{ type: "cancel-timers" }])

  const more = run(exhausted.state, FILE_ICON_RETAINED, FILE_ICON_RETAINED)
  expect(more.state).toMatchObject({ status: "failed", consumers: 3, retry: "idle" })
  expect(more.effects).toEqual([])
  expect(shown(more.state)).toBe("Document")
})

test("unmounting the last icon cancels the pending retry, and a later mount loads again", () => {
  const failed = run(INITIAL_FILE_ICON_SYMBOL_STATE, FILE_ICON_RETAINED, { type: "load.failed", attempt: 1 }).state

  const released = run(failed, FILE_ICON_RELEASED)
  expect(released.state).toEqual({ status: "failed", attempt: 1, consumers: 0, retry: "idle" })
  expect(released.effects).toEqual([{ type: "cancel-timers" }])
  expect(run(released.state, { type: "retry.due", attempt: 1 }).state).toBe(released.state)

  const remounted = run(released.state, FILE_ICON_RETAINED)
  expect(remounted.state).toEqual({ status: "loading", attempt: 2, consumers: 1, retried: true })
  expect(remounted.effects).toEqual([{ type: "load", attempt: 2 }])
})

test("a load that fails after every icon unmounted schedules no retry", () => {
  const failed = run(INITIAL_FILE_ICON_SYMBOL_STATE, FILE_ICON_RETAINED, FILE_ICON_RELEASED, {
    type: "load.failed",
    attempt: 1,
  })
  expect(failed.state).toEqual({ status: "failed", attempt: 1, consumers: 0, retry: "idle" })
  expect(failed.effects).toEqual([{ type: "cancel-timers" }])
})

test("stale results are ignored and a loaded symbol stays loaded", () => {
  const retrying = run(
    INITIAL_FILE_ICON_SYMBOL_STATE,
    FILE_ICON_RETAINED,
    { type: "load.failed", attempt: 1 },
    { type: "retry.due", attempt: 1 },
  ).state

  expect(run(retrying, { type: "load.succeeded", attempt: 1, svg: "<svg/>" }).state).toBe(retrying)
  expect(run(retrying, { type: "load.timed-out", attempt: 1 }).state).toBe(retrying)
  expect(run(retrying, { type: "retry.due", attempt: 1 }).state).toBe(retrying)

  const ready = transitionFileIconSymbol(READY_FILE_ICON_SYMBOL_STATE, FILE_ICON_RETAINED)
  expect(ready.state).toBe(READY_FILE_ICON_SYMBOL_STATE)
  expect(transitionFileIconSymbol(READY_FILE_ICON_SYMBOL_STATE, FILE_ICON_RELEASED)).toBe(ready)
})
