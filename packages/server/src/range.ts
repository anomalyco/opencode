export * as ByteRange from "./range"

/** A single `bytes=` range of a `size`-byte body, inclusive. Undefined serves the whole body. */
export function parse(header: string | undefined, size: number) {
  const match = header === undefined ? null : /^bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header.trim())
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
