import { describe, expect, test } from "bun:test"
import {
  INITIAL_TEXT_FIELD_COPY_STATE,
  selectTextFieldCopied,
  selectTextFieldCopyIcon,
  selectTextFieldCopyLabelKey,
  TEXT_FIELD_COPIED_MS,
  TEXT_FIELD_COPY_TIMEOUT_MS,
  transitionTextFieldCopy,
  type TextFieldCopyEvent,
  type TextFieldCopyState,
  type TextFieldCopyTransition,
} from "./text-field-machine"

function run(state: TextFieldCopyState, ...events: TextFieldCopyEvent[]) {
  return events.reduce<TextFieldCopyTransition>((result, event) => transitionTextFieldCopy(result.state, event), {
    state,
    effects: [],
  })
}

const request: TextFieldCopyEvent = { type: "copy.requested", value: "sk-123", enabled: true }

describe("transitionTextFieldCopy", () => {
  test("claims the copy before the write starts, so a second click waits for it", () => {
    const first = transitionTextFieldCopy(INITIAL_TEXT_FIELD_COPY_STATE, request)

    expect(first.state).toEqual({ status: "copying", attempt: 1, keepCopied: false })
    expect(first.effects).toEqual([
      { type: "clipboard.write", attempt: 1, value: "sk-123", timeoutMs: TEXT_FIELD_COPY_TIMEOUT_MS },
    ])

    const second = transitionTextFieldCopy(first.state, request)

    expect(second.state).toBe(first.state)
    expect(second.effects).toEqual([])
  })

  test("a repeat copy restarts the feedback window instead of ending it early", () => {
    const copied = run(INITIAL_TEXT_FIELD_COPY_STATE, request, { type: "copy.succeeded", attempt: 1 })

    expect(copied.effects).toEqual([
      { type: "timer.clear" },
      { type: "reset.schedule", attempt: 1, delayMs: TEXT_FIELD_COPIED_MS },
    ])

    const again = transitionTextFieldCopy(copied.state, request)

    expect(again.effects[0]).toEqual({ type: "timer.clear" })
    expect(selectTextFieldCopied(again.state)).toBe(true)
    // The first copy's reset timer fires late: the checkmark stays.
    expect(run(again.state, { type: "reset.elapsed", attempt: 1 }).state).toBe(again.state)

    const second = run(again.state, { type: "copy.succeeded", attempt: 2 })

    expect(second.effects).toContainEqual({ type: "reset.schedule", attempt: 2, delayMs: TEXT_FIELD_COPIED_MS })
    expect(run(second.state, { type: "reset.elapsed", attempt: 2 }).state).toEqual({ status: "idle", issued: 2 })
  })

  test.each(["copy.failed", "copy.timed-out"] as const)("%s returns to idle and ignores the late result", (type) => {
    const failed = run(INITIAL_TEXT_FIELD_COPY_STATE, request, { type, attempt: 1 })

    expect(failed.state).toEqual({ status: "idle", issued: 1 })
    expect(failed.effects).toEqual([{ type: "timer.clear" }])
    expect(run(failed.state, { type: "copy.succeeded", attempt: 1 }).state).toBe(failed.state)

    const repeat = run(INITIAL_TEXT_FIELD_COPY_STATE, request, { type: "copy.succeeded", attempt: 1 }, request, {
      type,
      attempt: 2,
    })

    expect(selectTextFieldCopied(repeat.state)).toBe(false)
  })

  test("a disabled field does not copy", () => {
    const result = transitionTextFieldCopy(INITIAL_TEXT_FIELD_COPY_STATE, { ...request, enabled: false })

    expect(result.state).toBe(INITIAL_TEXT_FIELD_COPY_STATE)
    expect(result.effects).toEqual([])
  })

  test("disposing clears the timer and ignores later results", () => {
    const copying = run(INITIAL_TEXT_FIELD_COPY_STATE, request, { type: "disposed" })

    expect(copying.state).toEqual({ status: "disposed" })
    expect(copying.effects).toEqual([{ type: "timer.clear" }])
    expect(run(copying.state, { type: "copy.succeeded", attempt: 1 }, request).state).toBe(copying.state)
    expect(run(INITIAL_TEXT_FIELD_COPY_STATE, { type: "disposed" }).effects).toEqual([])
  })

  test("labels and icons follow the copied state", () => {
    const copied = run(INITIAL_TEXT_FIELD_COPY_STATE, request, { type: "copy.succeeded", attempt: 1 }).state

    expect(selectTextFieldCopyLabelKey(copied, "link")).toBe("ui.textField.copied")
    expect(selectTextFieldCopyIcon(copied, "link")).toBe("check")
    expect(selectTextFieldCopyLabelKey(INITIAL_TEXT_FIELD_COPY_STATE, "link")).toBe("ui.textField.copyLink")
    expect(selectTextFieldCopyIcon(INITIAL_TEXT_FIELD_COPY_STATE, undefined)).toBe("copy")
  })
})
