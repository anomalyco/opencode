import { describe, expect, test } from "bun:test"
import {
  createPacedTextState,
  DISPOSED_PACED_TEXT_EVENT,
  TEXT_RENDER_IMMEDIATE,
  transitionPacedText,
  type PacedTextEvent,
  type PacedTextState,
} from "./paced-text-machine"

function replay(events: PacedTextEvent[], state: PacedTextState) {
  return events.reduce(transitionPacedText, state)
}

const burst = "word ".repeat(400)

describe("transitionPacedText", () => {
  test("shows ordinary deltas at once and keeps the state when nothing changed", () => {
    const state = createPacedTextState("Hello")

    expect(transitionPacedText(state, { type: "sync", text: "Hello", live: true })).toBe(state)
    expect(transitionPacedText(state, { type: "sync", text: "Hello world", live: true })).toEqual({
      status: "synced",
      shown: "Hello world",
      attempts: 0,
    })
    expect(transitionPacedText(state, { type: "tick", attempt: 0 })).toBe(state)
  })

  test("paces a large live burst in snapped slices and keeps the step through new deltas", () => {
    const pacing = transitionPacedText(createPacedTextState(""), { type: "sync", text: burst, live: true })

    expect(pacing).toEqual({ status: "pacing", shown: "", target: burst, attempt: 1 })

    const grown = transitionPacedText(pacing, { type: "sync", text: burst + "more ", live: true })

    expect(grown).toEqual({ status: "pacing", shown: "", target: burst + "more ", attempt: 1 })
    expect(transitionPacedText(grown, { type: "sync", text: burst + "more ", live: true })).toBe(grown)

    const sliced = transitionPacedText(grown, { type: "tick", attempt: 1 })

    expect(sliced.status).toBe("pacing")

    if (sliced.status !== "pacing") return
    expect(sliced.attempt).toBe(2)
    expect(sliced.shown.length).toBeLessThanOrEqual(256 + 8)
    expect(sliced.shown.endsWith(" ")).toBe(true)
    expect(transitionPacedText(sliced, { type: "tick", attempt: 1 })).toBe(sliced)

    const caught = replay(
      Array.from({ length: 20 }, (_, index) => ({ type: "tick", attempt: index + 2 }) as const),
      sliced,
    )

    expect(caught).toEqual({ status: "synced", shown: burst + "more ", attempts: expect.any(Number) })
  })

  test.each([
    ["the stream ends", { type: "sync", text: "Intro " + burst, live: false }],
    ["the text is replaced", { type: "sync", text: "Other " + burst, live: true }],
    ["the text shrinks back to what is shown", { type: "sync", text: "Intro ", live: true }],
    [
      "the backlog falls within the immediate size",
      { type: "sync", text: "Intro " + "x".repeat(TEXT_RENDER_IMMEDIATE), live: true },
    ],
  ] as const)("shows the text at once when %s", (_, event) => {
    const pacing = transitionPacedText(createPacedTextState("Intro "), {
      type: "sync",
      text: "Intro " + burst,
      live: true,
    })

    const synced = transitionPacedText(pacing, event)

    expect(synced).toEqual({ status: "synced", shown: event.text, attempts: 1 })
    // The step armed for the burst finds nothing to reveal.
    expect(transitionPacedText(synced, { type: "tick", attempt: 1 })).toBe(synced)
  })

  test("a step from an earlier burst cannot advance a later one", () => {
    const later = replay(
      [
        { type: "sync", text: burst, live: true },
        { type: "sync", text: burst, live: false },
        { type: "sync", text: burst + burst, live: true },
      ],
      createPacedTextState(""),
    )

    expect(later).toMatchObject({ status: "pacing", attempt: 2 })
    expect(transitionPacedText(later, { type: "tick", attempt: 1 })).toBe(later)
  })

  test("ignores everything after dispose", () => {
    const pacing = transitionPacedText(createPacedTextState(""), { type: "sync", text: burst, live: true })
    const disposed = transitionPacedText(pacing, DISPOSED_PACED_TEXT_EVENT)

    expect(disposed).toEqual({ status: "disposed" })
    expect(transitionPacedText(disposed, { type: "tick", attempt: 1 })).toBe(disposed)
    expect(transitionPacedText(disposed, { type: "sync", text: "x", live: true })).toBe(disposed)
  })
})
