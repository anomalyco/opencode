import type { Method } from "./worker-rpc"

// What the Word preview's window and its document worker say to each other. The window keeps only the page column, the
// text layer's DOM and the painted bitmaps; the engine, its fonts, the layout and the painting live in the worker.

/** Where a link in the document leads. */
export type WordLink =
  /** A web or mail address the system browser opens. */
  | { readonly kind: "external"; readonly url: string }
  /** A bookmark in the same document, such as a table of contents entry's heading. */
  | { readonly kind: "internal"; readonly bookmark: string }

/**
 * One transparent piece of the text layer, in units that scale with the page: positions are fractions of the page and
 * lengths are ems of `size`, so the layer follows any page width without being rebuilt.
 */
export type WordSpan = {
  readonly text: string
  /** Left and top edges, as fractions of the page's width and height. */
  readonly left: number
  readonly top: number
  /** The font size, as a fraction of the page's width. */
  readonly size: number
  /** Stretches the layer font's natural width to the painted glyphs' width, about the left edge. */
  readonly transform: string
  readonly dir: "ltr" | "rtl"
  readonly link: WordLink | undefined
  readonly title: string | undefined
  /**
   * What separates it from the next span in copied text: a line break between paragraphs, table cells and regions, a
   * tab across a gap with no painted space, such as a tab stop or after a list number.
   */
  readonly after: "br" | "tab" | undefined
}

/** What the page column needs to lay a page out before its content is built. */
export type WordPageSize = { readonly width: number; readonly height: number; readonly background: string | undefined }

/** The layer's line height, in ems: the height a painted line's glyph box takes, descenders included. */
export const lineHeight = 1.2

/** The family the text layer measures and sets its text in; it stays transparent, so only its widths matter. */
export const layerFont = "sans-serif"

/** One step of the rest of the layout. */
export type WordLayoutStep =
  /** More of the document is left to lay out. */
  | { readonly done: false }
  /**
   * The whole document is laid out. `kept` tells, per page, whether the page is the one shown so far, so its row and
   * bitmap can stay; a page the full layout changed paints again.
   */
  | { readonly done: true; readonly pages: readonly WordPageSize[]; readonly kept: readonly boolean[] }

/** The document worker's methods. Every method but `open` needs a document `open` opened. */
export type WordMethods = {
  /** Opens the file's bytes and lays out its first pages; the reply lists them and whether more follow. */
  readonly open: Method<
    { readonly bytes: ArrayBuffer },
    { readonly pages: readonly WordPageSize[]; readonly loading: boolean }
  >
  /** Lays out a short step more of the document. */
  readonly layout: Method<undefined, WordLayoutStep>
  /** Paints a page at `scale` page pixels per CSS pixel times `ratio` device pixels per CSS pixel. */
  readonly paint: Method<
    { readonly index: number; readonly scale: number; readonly ratio: number },
    ImageBitmap | undefined
  >
  /** Builds a page's content ahead of its paint. */
  readonly build: Method<{ readonly index: number }, undefined>
  /** A page's text layer. */
  readonly text: Method<{ readonly index: number }, readonly WordSpan[]>
  /** Where a bookmark sits in the pages laid out so far: its page and the height on it, in page pixels. */
  readonly bookmark: Method<
    { readonly name: string },
    { readonly index: number; readonly y: number } | undefined
  >
}
