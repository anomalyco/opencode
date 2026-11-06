import { describe, expect, test } from "bun:test"
import type { PositionedTextRun, SlideDisplayList, SlidePrimitive } from "@betteroffice/pptx"
import {
  faceKey,
  initialSlideFontsState,
  renameSlideFrame,
  selectDeckFontRequests,
  selectMissingSlideFonts,
  SLIDE_FONT_LOAD_TIMEOUT_MS,
  transitionSlideFonts,
  type SlideFontRequest,
  type SlideFontResolver,
  type SlideFontsEvent,
  type SlideFontsState,
  type SlideFontsTransition,
} from "./slide-fonts-machine"
import type { FontStyle } from "./slide-text"

const regular = { bold: false, italic: false }

const bold = { bold: true, italic: false }

const italic = { bold: false, italic: true }

const boldItalic = { bold: true, italic: true }

// Impact ships its regular face alone, so every style resolves to it; other families ship every style.
const resolve: SlideFontResolver<string> = (want, style) =>
  want.family === "Impact"
    ? { want, style: regular, source: "impact-regular" }
    : { want, style, source: `${want.family ?? want.script}-${style.bold}-${style.italic}` }

const calibri = (style: FontStyle = regular): SlideFontRequest => ({ want: { family: "Calibri" }, style })

const courier: SlideFontRequest = { want: { family: "Courier" }, style: regular }

// Folds the events in order and returns the last transition.
const replay = (events: readonly SlideFontsEvent[], state: SlideFontsState = initialSlideFontsState()) =>
  events.reduce<SlideFontsTransition>((last, event) => transitionSlideFonts(last.state, event), {
    state,
    effects: [],
  })

const run = (fontId: number, style: FontStyle): PositionedTextRun => ({
  text: "a",
  start: 0,
  end: 1,
  x: 0,
  width: 1,
  fontId,
  fontFamily: "Deck",
  fontSizePx: 12,
  ...style,
  underline: false,
  color: "#000",
  glyphs: [],
})

const textBox = (runs: PositionedTextRun[]): SlidePrimitive => ({
  kind: "textBox",
  objectId: 1,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  anchor: "top",
  paragraphs: [],
  lines: [{ x: 0, y: 0, width: 1, height: 1, baseline: 1, start: 0, end: 1, runs, caretStops: [] }],
})

// Loads and registers one face that is the only face of its batch, as the driver does.
const registered = (state: SlideFontsState, request: SlideFontRequest, fontId: number) => {
  const requested = transitionSlideFonts(state, { type: "batch.requested", requests: [request] })
  const load = requested.effects.find((effect) => effect.type === "load-face")

  if (load?.type !== "load-face") throw new Error("No load")
  const done = transitionSlideFonts(requested.state, { type: "face.loaded", attempt: load.attempt, key: load.key })

  return {
    state: transitionSlideFonts(done.state, { type: "face.registered", key: load.key, fontId }).state,
    effects: done.effects,
  }
}

describe("transitionSlideFonts", () => {
  test("registers a batch's faces in rank order, whichever loads first", () => {
    const requested = transitionSlideFonts(initialSlideFontsState(), {
      type: "batch.requested",
      requests: [calibri(), courier],
    })

    expect(requested.effects).toEqual([
      {
        type: "load-face",
        attempt: 2,
        key: "family:calibri|false|false",
        style: regular,
        css: "slide-0",
        timeoutMs: SLIDE_FONT_LOAD_TIMEOUT_MS,
      },
      {
        type: "load-face",
        attempt: 3,
        key: "family:courier|false|false",
        style: regular,
        css: "slide-1",
        timeoutMs: SLIDE_FONT_LOAD_TIMEOUT_MS,
      },
    ])

    const second = transitionSlideFonts(requested.state, {
      type: "face.loaded",
      attempt: 3,
      key: "family:courier|false|false",
    })

    expect(second.effects).toEqual([{ type: "clear-load", attempt: 3 }])

    const first = transitionSlideFonts(second.state, {
      type: "face.loaded",
      attempt: 2,
      key: "family:calibri|false|false",
    })

    expect(first.effects.map((effect) => (effect.type === "register-face" ? effect.key : effect.type))).toEqual([
      "clear-load",
      "family:calibri|false|false",
      "family:courier|false|false",
      "resolve-batch",
    ])
    expect(first.effects.at(-1)).toEqual({ type: "resolve-batch", id: 1, registered: 2 })
  })

  test("a family that ships one face loads it once and lays out no slide again for it", () => {
    const requests = selectDeckFontRequests(
      { families: [{ name: "Impact", styles: [regular, bold] }], scripts: [], hidden: [] },
      resolve,
    )

    expect(requests.map((request) => faceKey(request.want, request.style))).toEqual(["family:impact|false|false"])

    const state = registered(initialSlideFontsState(), requests[0], 7).state

    // A bold Impact run drew with Impact's regular face, which is all Impact has.
    expect(selectMissingSlideFonts(state, [textBox([run(7, bold)])], resolve)).toEqual([])
  })

  test("each layout that registers a face lays out again, past two rounds; a face that fails ends it", () => {
    const base = registered(initialSlideFontsState(), calibri(), 1).state

    // Each layout uncovers the next style.
    const rounds = [bold, italic, boldItalic].reduce((state, style, index) => {
      const wanted = selectMissingSlideFonts(state, [textBox([run(1, style)])], resolve)

      expect(wanted.map((face) => face.style)).toEqual([style])

      const next = registered(state, wanted[0], index + 2)

      expect(next.effects.at(-1)).toMatchObject({ type: "resolve-batch", registered: 1 })

      return next.state
    }, base)

    // A face that fails to load registers nothing, so the slide is not laid out again for it.
    const failing = transitionSlideFonts(rounds, {
      type: "batch.requested",
      requests: [{ want: { family: "Arial" }, style: regular }],
    })

    const load = failing.effects[0]

    if (load?.type !== "load-face") throw new Error("No load")

    for (const end of ["face.failed", "face.timed-out"] as const) {
      const failed = transitionSlideFonts(failing.state, { type: end, attempt: load.attempt, key: load.key })

      expect(failed.effects.at(-1)).toMatchObject({ type: "resolve-batch", registered: 0 })
      expect(failed.state.entries.get(load.key)?.status).toBe("failed")
    }
  })

  test("a face that failed is not asked for again", () => {
    const requested = transitionSlideFonts(registered(initialSlideFontsState(), calibri(), 1).state, {
      type: "batch.requested",
      requests: [calibri(bold)],
    })

    const failed = transitionSlideFonts(requested.state, {
      type: "face.failed",
      attempt: 4,
      key: "family:calibri|true|false",
    })

    expect(selectMissingSlideFonts(failed.state, [textBox([run(1, bold)])], resolve)).toEqual([])
  })

  test("two slides asking for one face share its load and both lay out again", () => {
    const first = transitionSlideFonts(registered(initialSlideFontsState(), calibri(), 1).state, {
      type: "batch.requested",
      requests: [calibri(bold)],
    })

    const second = transitionSlideFonts(first.state, { type: "batch.requested", requests: [calibri(bold)] })

    expect(second.effects).toEqual([])

    const loaded = transitionSlideFonts(second.state, {
      type: "face.loaded",
      attempt: 4,
      key: "family:calibri|true|false",
    })

    expect(loaded.effects.filter((effect) => effect.type === "register-face")).toHaveLength(1)
    expect(loaded.effects.filter((effect) => effect.type === "resolve-batch")).toEqual([
      { type: "resolve-batch", id: 3, registered: 1 },
      { type: "resolve-batch", id: 5, registered: 1 },
    ])
  })

  test("a load that timed out stays out when it finishes later", () => {
    const requested = transitionSlideFonts(initialSlideFontsState(), { type: "batch.requested", requests: [calibri()] })
    const key = "family:calibri|false|false"
    const timedOut = transitionSlideFonts(requested.state, { type: "face.timed-out", attempt: 2, key })

    expect(timedOut.effects).toEqual([
      { type: "clear-load", attempt: 2 },
      { type: "resolve-batch", id: 1, registered: 0 },
    ])
    expect(transitionSlideFonts(timedOut.state, { type: "face.loaded", attempt: 2, key }).state).toBe(timedOut.state)
  })

  test("a batch with nothing to load resolves at once", () => {
    expect(replay([{ type: "batch.requested", requests: [] }]).effects).toEqual([
      { type: "resolve-batch", id: 1, registered: 0 },
    ])
  })

  test("frames name the browser's private faces, in tables and charts too", () => {
    const state = registered(initialSlideFontsState(), calibri(), 4).state

    const frame: SlideDisplayList = {
      contractVersion: 1,
      width: 1,
      height: 1,
      primitives: [
        textBox([run(4, regular)]),
        {
          kind: "table",
          objectId: 2,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          name: "t",
          label: "t",
          primitives: [textBox([run(4, regular)])],
        },
        {
          kind: "chart",
          objectId: 3,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          name: "c",
          label: "c",
          primitives: [textBox([run(9, regular)])],
        },
      ],
    }

    const families = (primitives: readonly SlidePrimitive[]): string[] =>
      primitives.flatMap((primitive) => {
        if (primitive.kind === "textBox")
          return primitive.lines.flatMap((line) => line.runs.map((item) => item.fontFamily))

        if (primitive.kind === "table" || primitive.kind === "chart") return families(primitive.primitives)

        return []
      })

    expect(families(renameSlideFrame(state, frame).primitives)).toEqual(["slide-0", "slide-0", "Deck"])
  })
})
