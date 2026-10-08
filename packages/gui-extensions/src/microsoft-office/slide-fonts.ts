import type { PositionedTextRun, PresentationHandle, SlideDisplayList, SlidePrimitive } from "@betteroffice/pptx"
import { loadFace, presentationFace, scriptFace } from "./fonts"
import type { DeckText, FallbackScript, FontStyle } from "./slide-text"

/** A face the deck asks for: a family it names, or the fallback for a script the Latin faces lack. */
type Want =
  | { readonly family: string; readonly script?: undefined }
  | { readonly script: FallbackScript; readonly family?: undefined }

/** A face registered with both the engine and the browser. */
type Face = { readonly want: Want; readonly style: FontStyle; readonly css: string }

/**
 * The faces one open deck draws with, added to `fonts`: the font set of the deck's own worker, which paints it. The
 * engine shapes each face under the family name the deck uses, and the browser holds the same bytes under a private
 * name that the laid-out frames are renamed to. Painting then matches shaping, and the deck's names (such as Inter or
 * Segoe UI) never replace a font the painter itself needs.
 */
export function slideFonts(deck: PresentationHandle, fonts: FontFaceSet) {
  const faces = new Map<number, Face>()
  const names = new Map<string, string>()
  const registered = new Set<string>()
  const loads = new Map<string, Promise<void>>()
  const settled = new Set<string>()

  /** Loads a face's bytes and browser face; the returned function registers both, so callers choose the order. */
  const prepare = async (want: Want, requested: FontStyle) => {
    const source = want.script
      ? scriptFace(want.script, requested.bold, requested.italic)
      : presentationFace(want.family, requested.bold, requested.italic)

    if (!source) return

    // A family without the requested style gets the face it has, which the browser then slants or emboldens.
    const style = { bold: source.weight === 700, italic: source.style === "italic" }
    // The worker holds this deck's faces alone, so the names only need to differ from each other.
    const css = names.get(wantKey(want)) ?? `slide-${names.size}`
    const key = faceKey(want, style)

    names.set(wantKey(want), css)

    if (registered.has(key)) return

    const buffer = await loadFace(source).catch(() => undefined)

    if (!buffer) return

    const browser = await new FontFace(css, buffer, {
      weight: style.bold ? "700" : "400",
      style: style.italic ? "italic" : "normal",
    })
      .load()
      .catch(() => undefined)

    if (!browser) return

    return () => {
      if (registered.has(key)) return

      registered.add(key)
      fonts.add(browser)

      const face = { family: want.script ? css : want.family, ...style, bytes: new Uint8Array(buffer) }

      faces.set(want.script ? deck.registerFallbackFont(face) : deck.registerFont(face), { want, style, css })
    }
  }

  /** Loads and registers one face once; later requests share the first. */
  const request = (want: Want, style: FontStyle) => {
    const key = faceKey(want, style)
    const existing = loads.get(key)

    if (existing) return existing

    const load = prepare(want, style).then((register) => {
      register?.()
      settled.add(key)
    })

    loads.set(key, load)

    return load
  }

  /** The faces a frame drew in a substitute style whose own face has not loaded or failed yet. */
  const missing = (primitives: readonly SlidePrimitive[]) =>
    textRuns(primitives).flatMap((run) => {
      const face = faces.get(run.fontId)
      const style = { bold: run.bold, italic: run.italic }

      if (!face || sameStyle(face.style, style) || settled.has(faceKey(face.want, style))) return []

      return [{ want: face.want, style }]
    })

  const rename = (primitive: SlidePrimitive): SlidePrimitive => {
    if (primitive.kind === "textBox")
      return {
        ...primitive,
        lines: primitive.lines.map((line) => ({
          ...line,
          runs: line.runs.map((run) => ({ ...run, fontFamily: faces.get(run.fontId)?.css ?? run.fontFamily })),
        })),
      }

    if (primitive.kind === "table" || primitive.kind === "chart")
      return { ...primitive, primitives: primitive.primitives.map(rename) }

    return primitive
  }

  return {
    /**
     * Registers the faces the deck's text names, in the order `text` ranks them: the engine draws every family it
     * cannot find with the first. Resolves once each face has loaded or failed.
     */
    load: async (text: DeckText) => {
      const regular = { bold: false, italic: false }
      // The engine lays no text out without a face, so a deck that names none gets PowerPoint's own default.
      const families = text.families.length > 0 ? text.families : [{ name: "Calibri", styles: [regular] }]

      const wants: { want: Want; style: FontStyle }[] = [
        ...families.flatMap((family) => family.styles.map((style) => ({ want: { family: family.name }, style }))),
        ...text.scripts.map((script) => ({ want: { script }, style: regular })),
      ]

      const registers = await Promise.all(wants.map((entry) => prepare(entry.want, entry.style)))

      registers.forEach((register) => register?.())
      wants.forEach((entry) => {
        const key = faceKey(entry.want, entry.style)

        loads.set(key, Promise.resolve())
        settled.add(key)
      })
    },

    /**
     * Lays a slide out. When its text asks for a style a registered face lacks, such as a bold the title style
     * inherits, that face loads and the slide lays out again. The frame names the browser's faces, ready to paint.
     */
    layout: async (index: number) => {
      const settle = async (rounds: number): Promise<SlideDisplayList> => {
        const frame = deck.layoutSlide(index)
        const wanted = rounds === 0 ? [] : missing(frame.primitives)

        if (wanted.length === 0) return { ...frame, primitives: frame.primitives.map(rename) }

        await Promise.all(wanted.map((entry) => request(entry.want, entry.style)))

        return settle(rounds - 1)
      }

      return settle(2)
    },
  }
}

function textRuns(primitives: readonly SlidePrimitive[]): PositionedTextRun[] {
  return primitives.flatMap((primitive) => {
    if (primitive.kind === "textBox") return primitive.lines.flatMap((line) => line.runs)

    if (primitive.kind === "table" || primitive.kind === "chart") return textRuns(primitive.primitives)

    return []
  })
}

function wantKey(want: Want) {
  return want.script ? `script:${want.script}` : `family:${want.family.toLowerCase()}`
}

function faceKey(want: Want, style: FontStyle) {
  return `${wantKey(want)}|${style.bold}|${style.italic}`
}

function sameStyle(left: FontStyle, right: FontStyle) {
  return left.bold === right.bold && left.italic === right.italic
}
