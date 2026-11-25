import type { PositionedTextRun, SlideDisplayList, SlidePrimitive } from "@betteroffice/pptx"
import type { DeckText, FallbackScript, FontStyle } from "./slide-text"

/** How long one face's bytes and browser face may take to load before the deck draws without it. */
export const SLIDE_FONT_LOAD_TIMEOUT_MS = 10_000

/** The most times one slide lays out while each layout finds faces to load. */
export const MAX_SLIDE_LAYOUT_PASSES = 8

/** A face the deck asks for: a family it names, or the fallback for a script the Latin faces lack. */
export type SlideFontWant =
  | { readonly family: string; readonly script?: undefined }
  | { readonly script: FallbackScript; readonly family?: undefined }

/** A face as the app ships it: `style` is the face's own, which may lack the style the deck asked for. */
export type SlideFontRequest = { readonly want: SlideFontWant; readonly style: FontStyle }

/** Resolves a wanted face and style to the face the app ships, or undefined when it ships none. */
export type SlideFontResolver<S> = (
  want: SlideFontWant,
  style: FontStyle,
) => (SlideFontRequest & { source: S }) | undefined

/** One face's lifecycle, keyed by `faceKey` of the face's own style. `css` is its private browser family. */
export type SlideFontEntry =
  | {
      readonly status: "loading"
      readonly attempt: number
      readonly want: SlideFontWant
      readonly style: FontStyle
      readonly css: string
    }
  /** Loaded, waiting for the faces ranked before it so the engine registers them in rank order. */
  | {
      readonly status: "staged"
      readonly attempt: number
      readonly want: SlideFontWant
      readonly style: FontStyle
      readonly css: string
    }
  | { readonly status: "registered"; readonly want: SlideFontWant; readonly style: FontStyle; readonly css: string }
  | { readonly status: "failed"; readonly want: SlideFontWant; readonly style: FontStyle }

/** The faces a `load` or a slide layout waits for, in rank order. */
export type SlideFontBatch = { readonly id: number; readonly keys: readonly string[] }

/**
 * The faces of one open deck. Each face load and each batch takes the next number from `issued`, so a load result
 * whose attempt the entry no longer holds is stale.
 */
export type SlideFontsState = {
  readonly issued: number
  /** `wantKey` to the private browser family its faces share. */
  readonly names: ReadonlyMap<string, string>
  readonly entries: ReadonlyMap<string, SlideFontEntry>
  /** The engine's font id to the face registered under it, which frames are renamed to. */
  readonly faces: ReadonlyMap<number, { readonly want: SlideFontWant; readonly style: FontStyle; readonly css: string }>
  readonly batches: readonly SlideFontBatch[]
}

export type SlideFontsEvent =
  | { readonly type: "batch.requested"; readonly requests: readonly SlideFontRequest[] }
  | { readonly type: "face.loaded"; readonly attempt: number; readonly key: string }
  | { readonly type: "face.failed"; readonly attempt: number; readonly key: string }
  | { readonly type: "face.timed-out"; readonly attempt: number; readonly key: string }
  /** The engine registered a face the machine handed it, under `fontId`. */
  | { readonly type: "face.registered"; readonly key: string; readonly fontId: number }

export type SlideFontsEffect =
  /** Loads the face's bytes and browser face, bounded by `timeoutMs`. */
  | {
      readonly type: "load-face"
      readonly attempt: number
      readonly key: string
      readonly style: FontStyle
      readonly css: string
      readonly timeoutMs: number
    }
  /** Ends the attempt's timeout. */
  | { readonly type: "clear-load"; readonly attempt: number }
  /** Adds the loaded face to the browser and the engine; the order of these effects is the rank order. */
  | {
      readonly type: "register-face"
      readonly attempt: number
      readonly key: string
      readonly want: SlideFontWant
      readonly style: FontStyle
      readonly css: string
    }
  /** Every face of the batch registered or failed; `registered` counts those it registered. */
  | { readonly type: "resolve-batch"; readonly id: number; readonly registered: number }

export type SlideFontsTransition = { readonly state: SlideFontsState; readonly effects: readonly SlideFontsEffect[] }

export function initialSlideFontsState(): SlideFontsState {
  return { issued: 0, names: new Map(), entries: new Map(), faces: new Map(), batches: [] }
}

const NONE: readonly SlideFontsEffect[] = []

export function transitionSlideFonts(state: SlideFontsState, event: SlideFontsEvent): SlideFontsTransition {
  if (event.type === "batch.requested") {
    const requests = unique(event.requests)
    const keys = requests.map((request) => faceKey(request.want, request.style))
    const fresh = requests.filter((request) => !state.entries.has(faceKey(request.want, request.style)))
    const names = new Map(state.names)
    const entries = new Map(state.entries)
    const batch = state.issued + 1

    // Later requests for a face join its load.
    const loads = fresh.map((request, index): SlideFontsEffect => {
      const key = faceKey(request.want, request.style)
      const attempt = batch + index + 1
      // The worker holds this deck's faces alone, so the names only need to differ from each other.
      const css = names.get(wantKey(request.want)) ?? `slide-${names.size}`

      names.set(wantKey(request.want), css)
      entries.set(key, { status: "loading", attempt, want: request.want, style: request.style, css })

      return { type: "load-face", attempt, key, style: request.style, css, timeoutMs: SLIDE_FONT_LOAD_TIMEOUT_MS }
    })

    const flushed = flush({
      ...state,
      issued: batch + fresh.length,
      names,
      entries,
      batches: [...state.batches, { id: batch, keys }],
    })

    return { state: flushed.state, effects: [...loads, ...flushed.effects] }
  }

  const entry = state.entries.get(event.key)

  if (event.type === "face.registered") {
    if (entry?.status !== "registered") return { state, effects: NONE }

    return {
      state: {
        ...state,
        faces: new Map(state.faces).set(event.fontId, { want: entry.want, style: entry.style, css: entry.css }),
      },
      effects: NONE,
    }
  }

  if (entry?.status !== "loading" || entry.attempt !== event.attempt) return { state, effects: NONE }

  const next: SlideFontEntry =
    event.type === "face.loaded"
      ? { ...entry, status: "staged" }
      : { status: "failed", want: entry.want, style: entry.style }

  const flushed = flush({ ...state, entries: new Map(state.entries).set(event.key, next) })

  return { state: flushed.state, effects: [{ type: "clear-load", attempt: event.attempt }, ...flushed.effects] }
}

/**
 * Registers the loaded faces of every batch with nothing left loading, in rank order, and resolves the batches whose
 * faces all registered or failed.
 */
function flush(state: SlideFontsState): SlideFontsTransition {
  const ready = state.batches.filter((batch) => batch.keys.every((key) => state.entries.get(key)?.status !== "loading"))

  if (ready.length === 0) return { state, effects: NONE }
  const entries = new Map(state.entries)

  const registers = [...new Set(ready.flatMap((batch) => batch.keys))].flatMap((key): SlideFontsEffect[] => {
    const entry = entries.get(key)

    if (entry?.status !== "staged") return []
    // The engine registers synchronously, so the entry counts as registered from here; its font id follows.
    entries.set(key, { status: "registered", want: entry.want, style: entry.style, css: entry.css })

    return [
      { type: "register-face", attempt: entry.attempt, key, want: entry.want, style: entry.style, css: entry.css },
    ]
  })

  const resolves = ready.map(
    (batch): SlideFontsEffect => ({
      type: "resolve-batch",
      id: batch.id,
      registered: batch.keys.filter((key) => entries.get(key)?.status === "registered").length,
    }),
  )

  return {
    state: { ...state, entries, batches: state.batches.filter((batch) => !ready.includes(batch)) },
    effects: [...registers, ...resolves],
  }
}

/** The batch id the next `batch.requested` takes, so a caller can wait for it before dispatching. */
export function nextSlideFontBatch(state: SlideFontsState) {
  return state.issued + 1
}

/**
 * The faces the deck's text asks for, in the order `text` ranks them: the engine draws every family it cannot find
 * with the first. One request per face the app ships, whatever style it was asked for in.
 */
export function selectDeckFontRequests<S>(text: DeckText, resolve: SlideFontResolver<S>) {
  const regular = { bold: false, italic: false }
  // The engine lays no text out without a face, so a deck that names none gets PowerPoint's own default.
  const families = text.families.length > 0 ? text.families : [{ name: "Calibri", styles: [regular] }]

  return unique([
    ...families.flatMap((family) => family.styles.map((style) => resolve({ family: family.name }, style))),
    ...text.scripts.map((script) => resolve({ script }, regular)),
  ])
}

/**
 * The faces a frame drew in a substitute style whose own face has neither registered nor failed. A family that
 * ships no face in that style resolves to the face that drew it, which needs nothing more.
 */
export function selectMissingSlideFonts<S>(
  state: SlideFontsState,
  primitives: readonly SlidePrimitive[],
  resolve: SlideFontResolver<S>,
) {
  return unique(
    textRuns(primitives).map((run) => {
      const face = state.faces.get(run.fontId)

      if (!face || (face.style.bold === run.bold && face.style.italic === run.italic)) return

      const resolved = resolve(face.want, { bold: run.bold, italic: run.italic })
      const status = resolved && state.entries.get(faceKey(resolved.want, resolved.style))?.status

      return status === "registered" || status === "failed" ? undefined : resolved
    }),
  )
}

/** The frame with each run's family renamed to the browser's private name for the face that drew it. */
export function renameSlideFrame(state: SlideFontsState, frame: SlideDisplayList): SlideDisplayList {
  const rename = (primitive: SlidePrimitive): SlidePrimitive => {
    if (primitive.kind === "textBox")
      return {
        ...primitive,
        lines: primitive.lines.map((line) => ({
          ...line,
          runs: line.runs.map((run) => ({ ...run, fontFamily: state.faces.get(run.fontId)?.css ?? run.fontFamily })),
        })),
      }

    if (primitive.kind === "table" || primitive.kind === "chart")
      return { ...primitive, primitives: primitive.primitives.map(rename) }

    return primitive
  }

  return { ...frame, primitives: frame.primitives.map(rename) }
}

export function faceKey(want: SlideFontWant, style: FontStyle) {
  return `${wantKey(want)}|${style.bold}|${style.italic}`
}

function wantKey(want: SlideFontWant) {
  return want.script ? `script:${want.script}` : `family:${want.family.toLowerCase()}`
}

function unique<T extends SlideFontRequest>(faces: readonly (T | undefined)[]) {
  const seen = new Set<string>()

  return faces.filter((face): face is T => {
    if (!face) return false
    const key = faceKey(face.want, face.style)

    if (seen.has(key)) return false
    seen.add(key)

    return true
  })
}

function textRuns(primitives: readonly SlidePrimitive[]): PositionedTextRun[] {
  return primitives.flatMap((primitive) => {
    if (primitive.kind === "textBox") return primitive.lines.flatMap((line) => line.runs)

    if (primitive.kind === "table" || primitive.kind === "chart") return textRuns(primitive.primitives)

    return []
  })
}
