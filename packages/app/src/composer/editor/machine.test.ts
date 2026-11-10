import { expect, test } from "bun:test"
import {
  INITIAL_EDITOR_SYNC_STATE,
  INPUT_PARSED,
  INPUT_PARSED_BLANK,
  storeChanged,
  transitionEditorSync,
  type EditorSyncEvent,
  type EditorSyncTransition,
} from "./machine"

function run(events: EditorSyncEvent[]) {
  return events.reduce<EditorSyncTransition>((step, event) => transitionEditorSync(step.state, event), {
    state: INITIAL_EDITOR_SYNC_STATE,
    render: false,
  })
}

test("typing `!` renders the shell-mode clear that arrives in the same flush as the keystroke", () => {
  // The DOM shows `!` while the store holds the cleared prompt.
  expect(run([INPUT_PARSED, storeChanged(false, false)]).render).toBe(true)
})

test("an input the store never echoed does not swallow the next external update", () => {
  const typed = run([INPUT_PARSED])
  expect(typed.render).toBe(false)
  expect(transitionEditorSync(typed.state, storeChanged(false, false)).render).toBe(true)
})

test("the echo of a keystroke and an attachment edit leave the DOM alone", () => {
  const echoed = run([INPUT_PARSED, storeChanged(true, false)])
  expect(echoed).toEqual({ state: INITIAL_EDITOR_SYNC_STATE, render: false })
  expect(transitionEditorSync(echoed.state, storeChanged(true, false))).toBe(echoed)
})

test("a blank echo keeps the user's line breaks once, and a later blank update renders", () => {
  const blank = run([INPUT_PARSED_BLANK])
  expect(blank.state.status).toBe("local-blank")

  const echoed = transitionEditorSync(blank.state, storeChanged(false, true))
  expect(echoed).toEqual({ state: INITIAL_EDITOR_SYNC_STATE, render: false })
  expect(transitionEditorSync(echoed.state, storeChanged(false, true)).render).toBe(true)
})

test("typing text after a blank input returns to rendering every difference", () => {
  expect(run([INPUT_PARSED_BLANK, INPUT_PARSED, storeChanged(false, true)]).render).toBe(true)
})
