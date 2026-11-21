import { expect, test } from "bun:test"
import {
  FILE_ICON_REQUESTED,
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

test("a failed chunk switches every mounted icon to the fallback glyph", () => {
  // The failure used to leave mounted icons pointing at a symbol that never arrived, blank until a remount.
  const loading = run(INITIAL_FILE_ICON_SYMBOL_STATE, FILE_ICON_REQUESTED)
  expect(loading.effects).toEqual([{ type: "load" }])
  expect(shown(loading.state)).toBe("Typescript")

  const failed = run(loading.state, { type: "load.failed" })
  expect(failed.effects).toEqual([{ type: "cancel-timeout" }])
  expect(shown(failed.state)).toBe("Document")
  expect(run(failed.state, FILE_ICON_REQUESTED).effects).toEqual([])
})

test("a stalled chunk times out to the fallback and still upgrades if it arrives late", () => {
  // A hung import or a missing loader used to keep the name requested forever with nothing on screen.
  const timedOut = run(INITIAL_FILE_ICON_SYMBOL_STATE, FILE_ICON_REQUESTED, { type: "load.timed-out" })
  expect(timedOut.effects).toEqual([{ type: "cancel-timeout" }])
  expect(shown(timedOut.state)).toBe("Document")

  const late = run(timedOut.state, { type: "load.succeeded", svg: "<svg/>" })
  expect(late.state).toBe(READY_FILE_ICON_SYMBOL_STATE)
  expect(late.effects).toEqual([{ type: "insert-symbol", svg: "<svg/>" }])
  expect(shown(late.state)).toBe("Typescript")
})

test("a loaded symbol inserts once and ignores later results", () => {
  const ready = run(INITIAL_FILE_ICON_SYMBOL_STATE, FILE_ICON_REQUESTED, { type: "load.succeeded", svg: "<svg/>" })
  expect(ready.effects).toEqual([{ type: "cancel-timeout" }, { type: "insert-symbol", svg: "<svg/>" }])

  for (const event of [FILE_ICON_REQUESTED, { type: "load.timed-out" }, { type: "load.failed" }] as const)
    expect(transitionFileIconSymbol(ready.state, event)).toEqual({ state: ready.state, effects: [] })
})
