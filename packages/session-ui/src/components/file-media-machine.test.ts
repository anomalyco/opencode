import { describe, expect, test } from "bun:test"
import {
  DISPOSED_FILE_MEDIA_EVENT,
  FILE_MEDIA_READ_TIMEOUT_MS,
  INITIAL_FILE_MEDIA_STATE,
  transitionFileMedia,
  viewFileMedia,
  type FileMediaEvent,
  type FileMediaState,
} from "./file-media-machine"

const diagram = { key: "image:diagram.png", kind: "image", path: "diagram.png" } as const
const other = { key: "image:other.png", kind: "image", path: "other.png" } as const
const png = { src: "data:image/png;base64,AAAA", mime: undefined }

function replay(events: FileMediaEvent[], state = INITIAL_FILE_MEDIA_STATE) {
  return events.reduce<FileMediaState>((current, event) => transitionFileMedia(current, event).state, state)
}

const loaded = replay([
  { type: "request.changed", target: diagram },
  { type: "read.succeeded", attempt: 1, media: png },
])

describe("transitionFileMedia", () => {
  test("starts a read with a bounded timeout", () => {
    const next = transitionFileMedia(INITIAL_FILE_MEDIA_STATE, { type: "request.changed", target: diagram })

    expect(next.effects).toEqual([
      { type: "read-file", attempt: 1, kind: "image", path: "diagram.png" },
      { type: "arm-timeout", attempt: 1, delayMs: FILE_MEDIA_READ_TIMEOUT_MS },
    ])
    expect(viewFileMedia(next.state, undefined, diagram.key).status).toBe("loading")
    expect(viewFileMedia(loaded, undefined, diagram.key)).toEqual({ status: "ready", src: png.src, mime: undefined })
  })

  for (const failure of [
    { type: "read.failed", attempt: 2 },
    { type: "read.timed-out", attempt: 2 },
  ] as const) {
    test(`a same-file refresh that ends in ${failure.type} keeps the shown media`, () => {
      const refreshing = transitionFileMedia(loaded, { type: "request.changed", target: diagram })

      expect(viewFileMedia(refreshing.state, undefined, diagram.key).src).toBe(png.src)

      const settled = transitionFileMedia(refreshing.state, failure)

      expect(viewFileMedia(settled.state, undefined, diagram.key)).toEqual({
        status: "ready",
        src: png.src,
        mime: undefined,
      })
      expect(settled.effects.some((effect) => effect.type === "notify-error")).toBe(false)
    })
  }

  test("a first read that fails or hangs shows the error and reports it once", () => {
    const loading = replay([{ type: "request.changed", target: diagram }])
    const failed = transitionFileMedia(loading, { type: "read.failed", attempt: 1 })
    const hung = transitionFileMedia(loading, { type: "read.timed-out", attempt: 1 })

    expect(failed.effects).toEqual([{ type: "clear-timeout" }, { type: "notify-error", kind: "image" }])
    expect(hung.effects).toEqual([{ type: "notify-error", kind: "image" }])
    expect(viewFileMedia(failed.state, undefined, diagram.key).status).toBe("error")
    expect(viewFileMedia(hung.state, undefined, diagram.key).status).toBe("error")
  })

  test("another file drops the previous media and ignores the old read", () => {
    const switched = transitionFileMedia(loaded, { type: "request.changed", target: other })

    expect(switched.state).toMatchObject({ status: "loading", attempt: 2, previous: undefined })
    expect(viewFileMedia(switched.state, undefined, other.key)).toEqual({
      status: "loading",
      src: undefined,
      mime: undefined,
    })
    // The render before the effect dispatches the new key must not show the old file either.
    expect(viewFileMedia(loaded, undefined, other.key).src).toBeUndefined()

    const late = transitionFileMedia(switched.state, { type: "read.succeeded", attempt: 1, media: png })

    expect(late.state).toBe(switched.state)
    expect(late.effects).toEqual([])
  })

  test("clearing the request or disposing stops the timer and ignores late reads", () => {
    const loading = replay([{ type: "request.changed", target: diagram }])
    const cleared = transitionFileMedia(loading, { type: "request.changed", target: undefined })
    const disposed = transitionFileMedia(loading, DISPOSED_FILE_MEDIA_EVENT)

    expect(cleared).toEqual({ state: { status: "idle", attempt: 1 }, effects: [{ type: "clear-timeout" }] })
    expect(disposed.effects).toEqual([{ type: "clear-timeout" }])

    for (const state of [cleared.state, disposed.state]) {
      expect(transitionFileMedia(state, { type: "read.succeeded", attempt: 1, media: png }).state).toBe(state)
      expect(transitionFileMedia(state, { type: "read.timed-out", attempt: 1 }).state).toBe(state)
    }

    expect(transitionFileMedia(disposed.state, { type: "request.changed", target: diagram }).state).toBe(
      disposed.state,
    )
  })

  test("media already in the props wins over any read", () => {
    expect(viewFileMedia(INITIAL_FILE_MEDIA_STATE, "data:image/png;base64,BBBB", undefined)).toEqual({
      status: "ready",
      src: "data:image/png;base64,BBBB",
      mime: undefined,
    })
    expect(viewFileMedia(INITIAL_FILE_MEDIA_STATE, undefined, undefined).status).toBe("idle")
  })
})
