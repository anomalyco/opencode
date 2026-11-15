import { describe, expect, test } from "bun:test"
import {
  createSoundPreviewState,
  SOUND_PREVIEW_DEBOUNCE_MS,
  SOUND_PREVIEW_LOAD_TIMEOUT_MS,
  transitionSoundPreview,
  type SoundPreviewEffect,
  type SoundPreviewEvent,
  type SoundPreviewState,
} from "./sound-preview-machine"

type Stop = string

function replay(events: readonly SoundPreviewEvent<Stop>[], from = createSoundPreviewState<Stop>()) {
  return events.reduce<{ state: SoundPreviewState<Stop>; effects: SoundPreviewEffect<Stop>[] }>(
    (result, event) => {
      const next = transitionSoundPreview(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

const loading = (id: string): SoundPreviewEvent<Stop>[] => [
  { type: "play.requested", id },
  { type: "debounce.elapsed", attempt: 1 },
]

describe("sound preview machine", () => {
  test.each([
    { name: "while waiting", events: [{ type: "play.requested", id: "alert-01" }], released: { type: "timer.stop" } },
    {
      name: "while playing",
      events: [...loading("alert-01"), { type: "load.succeeded", attempt: 1, active: "stop-a" }],
      released: { type: "audio.stop", active: "stop-a" },
    },
  ] as const)("a preview asked for after unmount $name does nothing", (input) => {
    const disposed = replay([...input.events, { type: "disposed" }])

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects.at(-1)).toEqual(input.released)
    expect(transitionSoundPreview(disposed.state, { type: "play.requested", id: "alert-01" })).toEqual({
      state: disposed.state,
      effects: [],
    })
  })

  test("a sound that loads after unmount is stopped as it arrives", () => {
    const disposed = replay([...loading("alert-01"), { type: "disposed" }])

    expect(transitionSoundPreview(disposed.state, { type: "load.succeeded", attempt: 1, active: "stop-a" })).toEqual({
      state: disposed.state,
      effects: [{ type: "audio.stop", active: "stop-a" }],
    })
  })

  test.each([{ type: "load.failed", attempt: 1 } as const, { type: "load.timed-out", attempt: 1 } as const])(
    "$type settles back to idle",
    (event) => {
      const result = replay([...loading("alert-01"), event])

      expect(result.effects).toEqual([
        { type: "timer.start", kind: "debounce", attempt: 1, delayMs: SOUND_PREVIEW_DEBOUNCE_MS },
        { type: "audio.load", attempt: 1, id: "alert-01" },
        { type: "timer.start", kind: "load", attempt: 1, delayMs: SOUND_PREVIEW_LOAD_TIMEOUT_MS },
        { type: "timer.stop" },
      ])
      expect(result.state).toEqual({ status: "idle", attempt: 1 })

      // A load that timed out and answers late plays nothing.
      expect(transitionSoundPreview(result.state, { type: "load.succeeded", attempt: 1, active: "stop-a" })).toEqual({
        state: result.state,
        effects: [{ type: "audio.stop", active: "stop-a" }],
      })
    },
  )

  test("a new preview stops the one playing and waits again", () => {
    const playing = replay([...loading("alert-01"), { type: "load.succeeded", attempt: 1, active: "stop-a" }])

    expect(transitionSoundPreview(playing.state, { type: "play.requested", id: "alert-02" }).effects).toEqual([
      { type: "audio.stop", active: "stop-a" },
      { type: "timer.start", kind: "debounce", attempt: 2, delayMs: SOUND_PREVIEW_DEBOUNCE_MS },
    ])
  })

  test("a load superseded by another preview is stopped without touching the new one", () => {
    const superseded = replay([...loading("alert-01"), { type: "play.requested", id: "alert-02" }])
    const late = transitionSoundPreview(superseded.state, { type: "load.succeeded", attempt: 1, active: "stop-a" })

    expect(late).toEqual({ state: superseded.state, effects: [{ type: "audio.stop", active: "stop-a" }] })
    expect(late.state).toEqual({ status: "debouncing", attempt: 2, id: "alert-02" })
  })

  test("only the last of several quick previews loads", () => {
    const result = replay([
      { type: "play.requested", id: "alert-01" },
      { type: "play.requested", id: "alert-02" },
      { type: "debounce.elapsed", attempt: 1 },
      { type: "debounce.elapsed", attempt: 2 },
    ])

    expect(result.effects.filter((effect) => effect.type === "audio.load")).toEqual([
      { type: "audio.load", attempt: 2, id: "alert-02" },
    ])
  })

  test("stopping an idle preview changes nothing", () => {
    const state = createSoundPreviewState<Stop>()

    expect(transitionSoundPreview(state, { type: "stop.requested" })).toEqual({ state, effects: [] })
  })
})
