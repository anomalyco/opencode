export * as ByteRange from "./range"

/** One byte range of a `size`-byte body, inclusive. */
export interface Range {
  readonly start: number
  readonly end: number
}

/**
 * Parses a single-range `Range` header against a body of `size` bytes. Undefined means serve the whole body: no
 * header, a multi-range or malformed header, or another unit.
 */
export function parse(header: string | undefined, size: number): Range | "unsatisfiable" | undefined {
  if (header === undefined) return undefined
  const match = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header.trim())
  if (match === null || (match[1] === "" && match[2] === "")) return undefined
  if (match[1] === "") {
    const suffix = Number(match[2])
    if (suffix === 0 || size === 0) return "unsatisfiable"
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === "" ? size - 1 : Number(match[2])
  if (start > end || start >= size) return "unsatisfiable"
  return { start, end: Math.min(end, size - 1) }
}
