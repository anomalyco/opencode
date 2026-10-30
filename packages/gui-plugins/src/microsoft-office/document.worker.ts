import { Schema } from "effect"
import {
  buildResidentRegionLayoutRequest,
  getLayoutKernelInputs,
  workerLayoutComputation,
} from "@betteroffice/docx/editor"
import { createRustMeasureSource } from "@betteroffice/docx/layout"
import {
  applyFrameDelta,
  decodeFrameDelta,
  encodeDisplayListFrameExtras,
  GlyphCache,
  rasterizeDisplayPageToBackBuffer,
  type DisplayPage,
  type RetainedFrame,
} from "@betteroffice/docx/layout/render"
import { createYrsPositionProjection, createYrsSession, type YrsPositionProjection } from "@betteroffice/docx/yrs"
import { wordFonts } from "./fonts"
import { createBitmapImageResolver } from "./word-images"
import { layerFont, type WordMethods, type WordPageSize, type WordSpan } from "./word-protocol"
import { pageText, positionTarget, type TextMeasure } from "./word-text"
import { serveWorker, Transfer } from "./worker-rpc"

// One worker holds one open Word document: its engine session, fonts, layout, built pages and painting. The window
// terminates the worker when the document closes, which is the only way the engine's memory is given back.

const FontRequirements = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      key: Schema.String,
      family: Schema.String,
      bold: Schema.Boolean,
      italic: Schema.Boolean,
      scripts: Schema.optional(
        Schema.Array(Schema.Literals(["cjk-sc", "cjk-tc", "cjk-jp", "cjk-kr", "arabic", "hebrew"])),
      ),
    }),
  ),
)

const decodeFontRequirements = Schema.decodeUnknownSync(FontRequirements)

/** A prefix layout's reply marks itself provisional when the document goes on past it. */
const decodeLayoutReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ provisional: Schema.optional(Schema.Boolean) })),
)

/** Pages laid out and built before the first paint; later pages are built as they near the viewport. */
const firstPages = 3

/** How long one layout step may hold back a paint that waits behind it, in milliseconds. */
const stepBudget = 24

/**
 * How many pages either side of the page painted last stay built. A built page holds about 5 MB in the engine and
 * builds again in about 100 ms. This keeps every page near the viewport, which paints a viewport ahead in both
 * directions, and lets a reader scroll back a few screens without waiting, while a long read holds at most 21 pages.
 */
const keptAround = 10

type Opened = Awaited<ReturnType<typeof open>>

/** A value built on first use. */
type Lazy<T> = { value: T | undefined }

/** The document this worker opened, once it has. */
const opened: Lazy<Opened> = { value: undefined }

serveWorker<WordMethods>({
  open: async (input) => {
    if (opened.value) throw new Error("The worker already holds a document")

    const loaded = await open(new Uint8Array(input.bytes))

    opened.value = loaded

    return { pages: loaded.pages().map(pageSize), loading: loaded.loading() }
  },
  layout: () => required().step(),
  paint: async (input, signal) => {
    const bitmap = await required().paint(input.index, input.scale, input.ratio, signal)

    return bitmap ? new Transfer(bitmap, [bitmap]) : undefined
  },
  build: (input) => {
    required().built(input.index)

    return undefined
  },
  text: (input) => required().text(input.index),
  bookmark: (input) => required().target(input.name),
})

function required() {
  if (!opened.value) throw new Error("The worker holds no document")

  return opened.value
}

/** Opens the document and lays out its first pages; the rest lay out a `step` at a time. */
async function open(bytes: Uint8Array) {
  const session = await createYrsSession()
  const document = session.openDocx(bytes, true, { mediaTokens: true }).document
  const settings = document.package.settings

  const measure = createRustMeasureSource({
    engine: {
      registerFont: (font) => session.registerFont(font),
      registerSubstituteFont: (id, family) => session.registerSubstituteFont(id, family),
      clearFonts: () => session.clearFonts(),
    },
    bundled: wordFonts(),
  })

  measure.setCompat(settings?.compatibilityFlags)

  const request = buildResidentRegionLayoutRequest(document, 0, {
    themeColors: Object.fromEntries(
      Object.entries(document.package.theme?.colorScheme ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    defaultTabStopTwips: settings?.defaultTabStop ?? null,
    numericIds: {},
    mediaTokens: true,
  })

  const requirements = decodeFontRequirements(session.layoutFontRequirementsJson(JSON.stringify(request))).map(
    (requirement) => ({ ...requirement, scripts: requirement.scripts && [...requirement.scripts] }),
  )

  await measure.prepareFontRequirements(requirements)

  const measurement = measure.measurementConfigForRequirements(requirements)

  if (!measurement) throw new Error("The document's fonts could not be prepared")

  const input = JSON.stringify({ ...request, measurement })

  // Word shows resolved comments without the active highlight.
  const resolvedCommentIds = (document.package.document.comments ?? [])
    .filter((comment) => (comment.done || comment.status === "resolved") && comment.parentId === undefined)
    .map((comment) => comment.id)

  // The session keeps the layout it last ran and builds display frames from it: only the display extras go in, and a
  // binary frame comes back with the window's pages built and every other page a placeholder carrying its geometry.
  const display = (previous: RetainedFrame | null, reply: string) => {
    const layout = workerLayoutComputation(reply).layout

    session.setDisplayWindow(0, firstPages)

    const extras = encodeDisplayListFrameExtras({
      measured: [],
      options: undefined,
      layout,
      fontChains: measurement.fontChains,
      headersFooters: getLayoutKernelInputs(layout)?.headersFooters,
      resolvedCommentIds,
    })

    return applyFrameDelta(previous, decodeFrameDelta(session.buildDisplayListFrame(extras, previous?.frameEpoch ?? 0)))
  }

  // Only as much of the body as fills the first pages; a long document goes on past it.
  const prefix = session.layoutDocumentWithRegionsPrefixRetainedJson(input, firstPages)
  const retained = { frame: display(null, prefix) }

  if (retained.frame.displayList.pages.length === 0) throw new Error("The document produced no pages")

  // The region layout that finishes the document: begun on the first step, `cost` the running average milliseconds a
  // body block takes.
  const layout = { loading: decodeLayoutReply(prefix).provisional ?? false, begun: false, cost: 3 }

  // Builds a page's content when it is needed and not built, the first time or again after `release`.
  const built = (index: number) => {
    const page = retained.frame.displayList.pages[index]

    if (!page?.unbuilt) return page

    retained.frame = applyFrameDelta(
      retained.frame,
      decodeFrameDelta(session.buildDisplayPagesFrame([index], retained.frame.frameEpoch)),
    )

    return retained.frame.displayList.pages[index]
  }

  // Gives back the built pages far from the page about to paint, so a long read keeps only the pages around the
  // viewport. A released page keeps its geometry and document positions, which bookmarks search, and builds again
  // when it is needed.
  const release = (painted: number) => {
    // The engine releases pages of the whole document's layout only, and few pages show before it.
    if (layout.loading) return

    const far = retained.frame.displayList.pages.flatMap((page, index) =>
      !page.unbuilt && Math.abs(painted - index) > keptAround ? [index] : [],
    )

    if (far.length === 0) return

    const frame = session.releaseDisplayPagesFrame(far, retained.frame.frameEpoch)

    // A superseded release changes nothing; the next one tries again.
    if (frame) retained.frame = applyFrameDelta(retained.frame, decodeFrameDelta(frame))
  }

  // The whole document's layout replaces the prefix's frame.
  const complete = (reply: string) => {
    const before = retained.frame.displayList.pages

    retained.frame = display(retained.frame, reply)
    layout.loading = false

    const pages = retained.frame.displayList.pages

    return {
      done: true as const,
      pages: pages.map(pageSize),
      kept: pages.map((page, index) => {
        const was = before[index]

        return was === page || (!!was?.unbuilt && !!page.unbuilt)
      }),
    }
  }

  const glyphCache = new GlyphCache({ provider: (font, glyph) => session.outlineGlyphJson(font, glyph) })
  const images = createBitmapImageResolver((token) => session.mediaSource(token))
  const surface = new OffscreenCanvas(1, 1)
  const textMeasure = layerMeasure()
  const texts = new WeakMap<DisplayPage, readonly WordSpan[]>()
  // Built on the first followed bookmark: most documents are read without one.
  const projection: Lazy<YrsPositionProjection | null> = { value: undefined }

  return {
    pages: () => retained.frame.displayList.pages,
    loading: () => layout.loading,
    built,
    /**
     * Lays out about `stepBudget` milliseconds more of the body. Blocks vary widely, and sizing a step by the last one
     * alone overshoots after a run of cheap blocks.
     */
    step: () => {
      if (!layout.loading) {
        const pages = retained.frame.displayList.pages

        return { done: true as const, pages: pages.map(pageSize), kept: pages.map(() => true) }
      }

      if (!layout.begun) {
        layout.begun = true

        const begun = session.beginRegionLayout(input)

        return begun.layoutJson === undefined ? { done: false as const } : complete(begun.layoutJson)
      }

      const blocks = Math.min(8192, Math.max(1, Math.round(stepBudget / layout.cost)))
      const started = performance.now()
      const progress = session.resumeRegionLayout(blocks)

      layout.cost = layout.cost * 0.7 + ((performance.now() - started) / blocks) * 0.3

      return progress.layoutJson === undefined ? { done: false as const } : complete(progress.layoutJson)
    },
    paint: async (index: number, scale: number, ratio: number, signal: AbortSignal) => {
      // A page that scrolled away before its paint began, or while it rasterized, needs no bitmap.
      if (signal.aborted) return undefined

      // Released first, so the page builds in the memory they free.
      release(index)

      const page = built(index)

      if (!page) return undefined

      // The window drew image elements, which shrink smoothly at the default quality; a bitmap needs medium quality to
      // look the same. Sizing the surface first keeps the setting: the painter resizes it, which resets the context,
      // only when its size differs.
      const context = surface.getContext("2d")
      const width = Math.ceil(page.width * ratio * scale)
      const height = Math.ceil(page.height * ratio * scale)

      if (surface.width !== width) surface.width = width

      if (surface.height !== height) surface.height = height

      if (context) context.imageSmoothingQuality = "medium"

      await rasterizeDisplayPageToBackBuffer(surface, page, { glyphCache, resolveImage: images.resolve }, ratio, scale)
      images.trim()

      if (signal.aborted) return undefined

      return surface.transferToImageBitmap()
    },
    text: (index: number) => {
      const page = built(index)

      if (!page || !textMeasure) return []

      const cached = texts.get(page)

      if (cached) return cached

      const spans = pageText(page, textMeasure)

      texts.set(page, spans)

      return spans
    },
    target: (name: string) => {
      projection.value ??= createYrsPositionProjection(session, "body")

      const position = projection.value?.bookmarkPosition(name) ?? undefined

      if (position !== undefined) return positionTarget(retained.frame.displayList.pages, position, built)

      // Word's reserved bookmark for the start of the document.
      return name === "_top" ? { index: 0, y: 0 } : undefined
    },
  }
}

function pageSize(page: DisplayPage): WordPageSize {
  return { width: page.width, height: page.height, background: page.background }
}

/** Measures the text layer's font with a detached canvas; undefined where the worker offers no 2D context. */
function layerMeasure(): TextMeasure | undefined {
  const context = new OffscreenCanvas(1, 1).getContext("2d")

  if (!context) return undefined

  // Measured large and scaled down, so rounding stays well below a pixel at any zoom.
  const size = 100

  context.font = `${size}px ${layerFont}`

  const metrics = context.measureText("Hg")

  return {
    width: (text) => context.measureText(text).width / size,
    ascent: metrics.fontBoundingBoxAscent / size,
    descent: metrics.fontBoundingBoxDescent / size,
  }
}
