export * as TextBoundary from "./text-boundary.js"

/**
 * Safe places to cut text, so a preview or a split never ends or starts in the middle of a character.
 *
 * `head` and `tail` work on JavaScript strings and count UTF-16 code units, the unit of `.length` and `.slice`.
 * `utf8Head` and `utf8Tail` work on UTF-8 bytes, for output captured or paged as bytes before it is decoded.
 *
 * Each takes the offset where the caller wants to cut and returns a nearby offset that is safe:
 *
 * - `head` rounds down, for keeping the start: `text.slice(0, head(text, limit))` is never longer than `limit`.
 * - `tail` rounds up, for keeping the end: `text.slice(tail(text, text.length - limit))` is never longer than `limit`.
 *
 * Offsets outside the text are clamped to it, so `tail(text, text.length - limit)` needs no check for short text.
 * Any cut is lossless: `text.slice(0, cut) + text.slice(cut)` is always `text`. The rounding only decides which side
 * gets a character that straddles the cut.
 *
 * Rounding down can leave no text at all: `head("😀", 1)` is 0, so a 1-unit preview of an emoji is empty. A loop that
 * splits text into pieces must still move forward: end each piece at `head(text, start + size)`, or at
 * `tail(text, start + size)` when that equals `start`, so the piece holds the one character wider than `size`. Ending
 * every piece at `tail` also works, with pieces that can run over `size` by the rest of one character.
 *
 * Offsets are integers. Boundaries fall between code points, not graphemes: a cut can still separate an accent from its
 * letter, or one emoji in a sequence from the next. Input need not be well formed. Lone surrogates and invalid UTF-8
 * stay where they are, except right at the cut, where `head` drops a lone high surrogate or incomplete UTF-8 sequence it
 * would end on and `tail` skips a lone low surrogate or up to 3 continuation bytes it would start on.
 */

/** The end of the longest start of `text` up to `index` code units that does not end on half a surrogate pair. */
export function head(text: string, index: number) {
  const cut = clamp(index, text.length)
  return cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1)) ? cut - 1 : cut
}

/** The start of the longest end of `text` from `index` that does not start on half a surrogate pair. */
export function tail(text: string, index: number) {
  const cut = clamp(index, text.length)
  return cut < text.length && isLowSurrogate(text.charCodeAt(cut)) ? cut + 1 : cut
}

/**
 * The end of the longest start of `bytes` up to `index` that does not end inside a UTF-8 sequence. Looks only at the
 * bytes before the cut, so it also trims a capture that was already truncated at `bytes.length` mid-character.
 */
export function utf8Head(bytes: Uint8Array, index: number) {
  const cut = clamp(index, bytes.length)
  // A sequence is at most 4 bytes, so its lead byte is at most 3 bytes before the last byte kept.
  for (let start = cut - 1; start >= Math.max(0, cut - 4); start--) {
    if (isContinuation(bytes[start])) continue
    return start + sequenceLength(bytes[start]) > cut ? start : cut
  }
  return cut
}

/** The start of the longest end of `bytes` from `index` that does not start inside a UTF-8 sequence. */
export function utf8Tail(bytes: Uint8Array, index: number) {
  const cut = clamp(index, bytes.length)
  // Moves past at most 3 continuation bytes; more than that is not UTF-8 and is kept.
  const limit = Math.min(bytes.length, cut + 3)
  for (let start = cut; start < limit; start++) if (!isContinuation(bytes[start])) return start
  return limit < bytes.length && isContinuation(bytes[limit]) ? cut : limit
}

function clamp(index: number, length: number) {
  return Math.min(Math.max(index, 0), length)
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff
}

function isContinuation(byte: number) {
  return (byte & 0xc0) === 0x80
}

// Bytes that cannot start a sequence count as one byte, so a cut after them stays.
function sequenceLength(lead: number) {
  if (lead >= 0xf8) return 1
  if (lead >= 0xf0) return 4
  if (lead >= 0xe0) return 3
  if (lead >= 0xc0) return 2
  return 1
}
