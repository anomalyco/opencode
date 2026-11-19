import { Effect } from "effect"
import type { MediaProtocol } from "../../route/media-protocol.js"

export interface Size {
  readonly width: number
  readonly height: number
}

/** The shared `aspect` and `resolution` fields of an image request. */
export interface Shape {
  readonly aspect?: string
  readonly resolution?: string
}

/** What a provider accepts for free width and height. */
export interface Limits {
  readonly multiple: number
  readonly minEdge?: number
  readonly maxEdge?: number
  readonly minPixels?: number
  readonly maxPixels?: number
  /** Long edge over short edge. */
  readonly maxRatio?: number
}

export const isRequested = (shape: Shape) => shape.aspect !== undefined || shape.resolution !== undefined

/** `1K` is 1, `2K` is 2, `0.5K` is 0.5; anything else is not a tier. */
export const tier = (resolution: string) => {
  const match = /^(\d+(?:\.\d+)?)k$/i.exec(resolution)
  if (match === null) return undefined
  const value = Number(match[1])
  return value > 0 && Number.isFinite(value) ? value : undefined
}

/** Free width and height: the tier sets the pixel count (`1K` is about 1024²), the aspect sets the proportions. */
export const fit = (shape: Shape, limits: Limits): Size => {
  const maxRatio = limits.maxRatio ?? Infinity
  const ratio = Math.min(maxRatio, Math.max(1 / maxRatio, aspectRatio(shape)))
  const area = targetPixels(shape)
  const width = Math.sqrt(area * ratio)
  const height = Math.sqrt(area / ratio)
  const up = Math.max((limits.minEdge ?? 0) / Math.min(width, height), Math.sqrt((limits.minPixels ?? 0) / area))
  const scaled = Math.max(1, up)
  const down = Math.min(
    (limits.maxEdge ?? Infinity) / (Math.max(width, height) * scaled),
    Math.sqrt((limits.maxPixels ?? Infinity) / area) / scaled,
  )
  // Round away from a limit the size reached, including one it lands on exactly, so it never crosses it.
  const round = down <= 1 ? Math.floor : up >= 1 ? Math.ceil : Math.round
  const snap = (edge: number) =>
    Math.max(
      limits.multiple,
      round(Number(((edge * scaled * Math.min(1, down)) / limits.multiple).toFixed(6))) * limits.multiple,
    )
  const size = { width: snap(width), height: snap(height) }
  if (!Number.isFinite(maxRatio) || withinRatio(size, maxRatio)) return size
  return repairRatio(size, width, height, limits, maxRatio) ?? size
}

const withinRatio = (size: Size, maxRatio: number) =>
  Math.max(size.width, size.height) <= Math.min(size.width, size.height) * maxRatio

/** Whether a snapped size still honors every limit, including the ratio the snap can push over. */
const validSize = (size: Size, limits: Limits, maxRatio: number) => {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return false
  if (size.width < limits.multiple || size.height < limits.multiple) return false
  if (size.width % limits.multiple !== 0 || size.height % limits.multiple !== 0) return false
  const long = Math.max(size.width, size.height)
  const short = Math.min(size.width, size.height)
  if (limits.minEdge !== undefined && short < limits.minEdge) return false
  if (limits.maxEdge !== undefined && long > limits.maxEdge) return false
  if (limits.minPixels !== undefined && size.width * size.height < limits.minPixels) return false
  if (limits.maxPixels !== undefined && size.width * size.height > limits.maxPixels) return false
  return withinRatio(size, maxRatio)
}

/**
 * Snapping each edge independently can push the shorter edge below the ratio the requested aspect reached.
 * Search the nearest multiples on both axes for a size that keeps the ratio without crossing another limit.
 */
const repairRatio = (size: Size, width: number, height: number, limits: Limits, maxRatio: number) => {
  const offsets = [-2, -1, 0, 1, 2].map((offset) => offset * limits.multiple)
  const distance = (candidate: Size) => Math.abs(candidate.width - width) + Math.abs(candidate.height - height)
  return offsets
    .flatMap((dx) => offsets.map((dy) => ({ width: size.width + dx, height: size.height + dy })))
    .filter((candidate) => validSize(candidate, limits, maxRatio))
    .reduce<Size | undefined>(
      (best, candidate) => (best === undefined || distance(candidate) < distance(best) ? candidate : best),
      undefined,
    )
}

/** The listed size closest to the shape: nearest aspect ratio first, then nearest pixel count. */
export const nearest = (shape: Shape, sizes: ReadonlyArray<Size>): Size => {
  const ratio = Math.log(aspectRatio(shape))
  const area = Math.log(targetPixels(shape))
  const distance = (size: Size) => [
    Math.abs(Math.log(size.width / size.height) - ratio),
    Math.abs(Math.log(size.width * size.height) - area),
  ]
  return sizes.reduce((best, size) => {
    const [sizeRatio, sizeArea] = distance(size)
    const [bestRatio, bestArea] = distance(best)
    if (Math.abs(sizeRatio - bestRatio) > 1e-9) return sizeRatio < bestRatio ? size : best
    return sizeArea < bestArea ? size : best
  })
}

/** Free width and height that must honor the shape; a size that misses it fails. */
export const exact = (route: MediaProtocol.Identity, shape: Shape, limits: Limits) => {
  if (!isRequested(shape)) return Effect.succeed(undefined)
  const size = fit(shape, limits)
  const requested = missed(shape, size)
  if (requested === undefined) return Effect.succeed(size)
  return Effect.fail(
    route.unsupported(
      shape.resolution === undefined ? "media.aspect" : "media.resolution",
      `${route.name} can't render ${requested}; the closest size it takes is ${describe(size)}. Change aspect or resolution, or set the size in providerOptions`,
    ),
  )
}

/** A size more than 2% off the requested aspect or more than √2 per edge off the requested tier. */
const missed = (shape: Shape, size: Size) => {
  const aspectMissed =
    shape.aspect !== undefined && Math.abs(Math.log(size.width / size.height / aspectRatio(shape))) > 0.02
  const requestedTier = shape.resolution === undefined ? undefined : tier(shape.resolution)
  const resolutionMissed =
    shape.resolution !== undefined &&
    (requestedTier === undefined ||
      Math.abs(Math.log2(Math.sqrt(size.width * size.height) / (requestedTier * 1024))) > 0.5)
  if (!aspectMissed && !resolutionMissed) return undefined
  return [shape.aspect, shape.resolution].filter((value) => value !== undefined).join(" at ")
}

const aspectRatio = (shape: Shape) => {
  const [width, height] = (shape.aspect ?? "1:1").split(":").map(Number)
  return width / height
}

const targetPixels = (shape: Shape) => ((tier(shape.resolution ?? "1K") ?? 1) * 1024) ** 2

const describe = (size: Size) => {
  const divisor = gcd(size.width, size.height)
  const width = size.width / divisor
  const height = size.height / divisor
  const ratio = width <= 32 && height <= 32 ? `${width}:${height}` : `${(size.width / size.height).toFixed(2)}:1`
  return `${size.width}x${size.height} (${ratio})`
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

export * as ImageSizing from "./image-sizing.js"
