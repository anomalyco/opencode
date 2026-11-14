import type { PresentationHandle, SlideDisplayList } from "@betteroffice/pptx"
import type { BundledFontFace } from "@betteroffice/fonts"
import { loadFace, presentationFace, scriptFace } from "./fonts"
import {
  faceKey,
  initialSlideFontsState,
  MAX_SLIDE_LAYOUT_PASSES,
  nextSlideFontBatch,
  renameSlideFrame,
  selectDeckFontRequests,
  selectMissingSlideFonts,
  transitionSlideFonts,
  type SlideFontRequest,
  type SlideFontResolver,
  type SlideFontsEffect,
  type SlideFontsEvent,
} from "./slide-fonts-machine"
import type { DeckText } from "./slide-text"

/**
 * The faces one open deck draws with, added to `fonts`: the font set of the deck's own worker, which paints it. The
 * engine shapes each face under the family name the deck uses, and the browser holds the same bytes under a private
 * name that the laid-out frames are renamed to. Painting then matches shaping, and the deck's names (such as Inter or
 * Segoe UI) never replace a font the painter itself needs.
 */
export function slideFonts(deck: PresentationHandle, fonts: FontFaceSet) {
  let machine = initialSlideFontsState()
  // What the driver holds beside the machine: each face's bundled source, each running load's timeout and loaded
  // faces, and each waiting batch's resolver.
  const sources = new Map<string, BundledFontFace>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const loaded = new Map<number, { buffer: ArrayBuffer; browser: FontFace }>()
  const batches = new Map<number, (registered: number) => void>()

  const dispatch = (event: SlideFontsEvent) => {
    const next = transitionSlideFonts(machine, event)

    machine = next.state
    next.effects.forEach(run)
  }

  const run = (effect: SlideFontsEffect) => {
    if (effect.type === "load-face") {
      const attempt = effect.attempt
      const key = effect.key
      const source = sources.get(key)

      timers.set(
        attempt,
        setTimeout(() => dispatch({ type: "face.timed-out", attempt, key }), effect.timeoutMs),
      )
      void Promise.try(async () => {
        if (!source) throw new Error(`No source for ${key}`)
        const buffer = await loadFace(source)

        const browser = await new FontFace(effect.css, buffer, {
          weight: effect.style.bold ? "700" : "400",
          style: effect.style.italic ? "italic" : "normal",
        }).load()

        return { buffer, browser }
      }).then(
        (face) => {
          // A load that timed out stays out.
          if (!timers.has(attempt)) return
          loaded.set(attempt, face)
          dispatch({ type: "face.loaded", attempt, key })
        },
        () => dispatch({ type: "face.failed", attempt, key }),
      )

      return
    }

    if (effect.type === "clear-load") {
      clearTimeout(timers.get(effect.attempt))
      timers.delete(effect.attempt)

      return
    }

    if (effect.type === "register-face") {
      const face = loaded.get(effect.attempt)
      loaded.delete(effect.attempt)

      if (!face) return
      fonts.add(face.browser)

      const want = effect.want

      const registration = {
        family: want.script ? effect.css : want.family,
        ...effect.style,
        bytes: new Uint8Array(face.buffer),
      }

      dispatch({
        type: "face.registered",
        key: effect.key,
        fontId: want.script ? deck.registerFallbackFont(registration) : deck.registerFont(registration),
      })

      return
    }

    batches.get(effect.id)?.(effect.registered)
    batches.delete(effect.id)
  }

  /** Loads and registers the faces, joining loads that run; resolves with how many it registered. */
  const request = (faces: readonly (SlideFontRequest & { source: BundledFontFace })[]) =>
    new Promise<number>((resolve) => {
      faces.forEach((face) => sources.set(faceKey(face.want, face.style), face.source))
      // A batch with nothing to load resolves inside the dispatch, so its resolver is in place first.
      batches.set(nextSlideFontBatch(machine), resolve)
      dispatch({ type: "batch.requested", requests: faces })
    })

  return {
    /**
     * Registers the faces the deck's text names, in the order `text` ranks them: the engine draws every family it
     * cannot find with the first. Resolves once each face has loaded or failed.
     */
    load: async (text: DeckText) => {
      await request(selectDeckFontRequests(text, resolveFont))
    },

    /**
     * Lays a slide out. When its text asks for a style a registered face lacks, such as a bold the title style
     * inherits, that face loads and the slide lays out again, for as long as each layout registers new faces. The
     * frame names the browser's faces, ready to paint.
     */
    layout: async (index: number) => {
      const settle = async (passes: number): Promise<SlideDisplayList> => {
        const frame = deck.layoutSlide(index)
        const wanted = passes > 1 ? selectMissingSlideFonts(machine, frame.primitives, resolveFont) : []

        if (wanted.length === 0 || (await request(wanted)) === 0) return renameSlideFrame(machine, frame)

        return settle(passes - 1)
      }

      return settle(MAX_SLIDE_LAYOUT_PASSES)
    },
  }
}

/** The face the app ships for a wanted face and style. A family without the style gets the face it has. */
const resolveFont: SlideFontResolver<BundledFontFace> = (want, requested) => {
  const source = want.script
    ? scriptFace(want.script, requested.bold, requested.italic)
    : presentationFace(want.family, requested.bold, requested.italic)

  if (!source) return

  return { want, style: { bold: source.weight === 700, italic: source.style === "italic" }, source }
}
