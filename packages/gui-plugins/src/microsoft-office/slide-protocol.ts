import type { Method } from "./worker-rpc"

/** The longest side a decoded picture keeps: enough for a full-width slide on a high-density screen. */
export const maxImageSide = 2560

/** What the window shows of one slide besides its bitmap. */
export type SlideSummary = {
  /** In CSS pixels. */
  readonly width: number
  readonly height: number
  readonly hidden: boolean
  readonly notes: string | undefined
}

/** An SVG picture the worker cannot decode, which the window rasterizes at `size`, or at its own size when absent. */
export type VectorRequest = {
  readonly asset: string
  readonly blob: Blob
  readonly size: { readonly width: number; readonly height: number } | undefined
}

/** A rasterized SVG picture, or none when the window could not decode it either. */
export type VectorBitmap = { readonly asset: string; readonly bitmap: ImageBitmap | undefined }

export type SlidePainted =
  | {
      readonly kind: "painted"
      /** The slide at the requested density, or less when that would exceed the bitmap caps. */
      readonly bitmap: ImageBitmap
      /** SVG pictures the slide drew without, or too coarse: paint again once the worker has them. */
      readonly vectors: readonly VectorRequest[]
    }
  /** The slide does not lay out, or does not paint even without shadows. */
  | { readonly kind: "failed" }
  /** The caller aborted the paint while it ran. */
  | { readonly kind: "cancelled" }

/** The PowerPoint worker's methods. */
export type SlideMethods = {
  /** Opens the deck once per worker, its fonts included. Rejects when the engine cannot read it. */
  readonly open: Method<{ readonly bytes: ArrayBuffer }, readonly SlideSummary[]>
  /** Paints one slide at `density` device pixels per CSS pixel. */
  readonly paint: Method<{ readonly index: number; readonly density: number }, SlidePainted>
  /** Hands over SVG pictures rasterized for `VectorRequest`s. */
  readonly vectors: Method<readonly VectorBitmap[], void>
}
