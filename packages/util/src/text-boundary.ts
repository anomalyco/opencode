export * as TextBoundary from "./text-boundary.js"

/**
 * Clip text to a budget without ending or starting on half a character. `head` and `tail` count UTF-16 code units,
 * like `.length`; `utf8Tail` counts bytes of UTF-8 output that has not been decoded yet. The result can be shorter
 * than the budget by the part of the character at the cut, and `head("😀", 1)` is empty. Boundaries are code points,
 * not graphemes, and malformed input is kept as it is everywhere except at the cut.
 */

/** The first `limit` code units of `text`, without a high surrogate whose pair the limit cut off. */
export function head(text: string, limit: number) {
  if (text.length <= limit) return text
  const code = text.charCodeAt(limit - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit)
}

/** The last `limit` code units of `text`, without a low surrogate whose pair the limit cut off. */
export function tail(text: string, limit: number) {
  if (text.length <= limit) return text
  const start = text.length - limit
  const code = text.charCodeAt(start)
  return text.slice(code >= 0xdc00 && code <= 0xdfff ? start + 1 : start)
}

/** The last `limit` bytes of `bytes`, decoded, after skipping up to 3 continuation bytes of a cut character. */
export function utf8Tail(bytes: Uint8Array, limit: number) {
  if (bytes.length <= limit) return decoder.decode(bytes)
  const start = bytes.length - limit
  const end = Math.min(bytes.length, start + 3)
  let index = start
  while (index < end && (bytes[index] & 0xc0) === 0x80) index++
  return decoder.decode(bytes.subarray(index))
}

// Like Buffer#toString, keep a leading byte order mark.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
