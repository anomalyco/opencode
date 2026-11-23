import { bare } from "./page"

/**
 * How well a page matches a query.
 * - `MISS`: a word of the query is nowhere in the page's address or title.
 * - `INSIDE`: every word is there, at least one only inside a longer word.
 * - `START`: every word starts a word of the title or a part of the address: the host, a host label or a path
 *   segment.
 */
export const MISS = 0

export const INSIDE = 1

export const START = 2

/** Stands before every word in a page's search text and in a query's words; no address or title holds it. */
const MARK = "\u0001"

const MARK_CODE = 1

const UTF16 = new TextDecoder("utf-16le")

const DAY = 86_400_000

/** One word of a query, as it is looked for in a page's search text: anywhere, and at the start of a word. */
type Term = {
  readonly inside: string
  /** Undefined for a word that begins with punctuation, which starts no word. */
  readonly start: string | undefined
}

/**
 * What the person typed, as the history is searched for it: its words in lower case, each without a web scheme or a
 * leading `www.`. `prefix` is the text when it is one word, which an address may begin with.
 */
export type Query = {
  readonly words: readonly string[]
  readonly terms: readonly Term[]
  readonly prefix: string | undefined
}

/** The query a text asks for; undefined when it holds no word to search for, such as a bare `https://`. */
export function parseQuery(text: string): Query | undefined {
  const words = text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(bare)
    .filter((word) => word.length > 0)

  const single = words.length === 1 ? words[0] : undefined

  if (words.length === 0) return undefined

  return {
    words,
    terms: words.map((word) => {
      const marked = mark(word)

      return marked.startsWith(MARK) ? { inside: marked.slice(1), start: marked } : { inside: marked, start: undefined }
    }),
    prefix: single === undefined ? undefined : mark(single),
  }
}

/**
 * A page's address and title as a search compares them: the address without its scheme or `www.`, then the title, in
 * lower case, with a mark before every word. A word begins at a letter or digit that follows none, so each host
 * label and path segment is one, as is each part of `rune-desktop`. Finding a query's word then takes one pass over
 * the text, and whether it starts a word is whether the mark stands before it.
 */
export function searchText(url: string, title: string) {
  return mark(`${bare(url)}\n${title}`.replaceAll(MARK, "").toLowerCase())
}

/** How well a page's `searchText` matches: see `START`, `INSIDE` and `MISS`. */
export function matchQuality(query: Query, text: string) {
  // Runs for every page of the history on each keystroke: plain loops, and nothing allocated.
  let quality = START

  for (const term of query.terms) {
    const at = text.indexOf(term.inside)

    if (at < 0) return MISS

    // The word starts a word where the mark stands before it: at the place found, or at a later one.
    if (term.start === undefined || (text.charCodeAt(at - 1) !== MARK_CODE && text.indexOf(term.start, at + 1) < 0)) quality = INSIDE
  }

  return quality
}

/**
 * Whether a page's address begins with what was typed, so Enter may open it in place of the typed text. `text` is the
 * page's `searchText`.
 */
export function completes(query: Query, text: string) {
  return query.prefix !== undefined && text.startsWith(query.prefix)
}

// Written into 16-bit units and decoded once: a text built from pieces is searched far slower, and this runs for
// every page when the history opens. Every system the app runs on stores those units low byte first.
function mark(text: string) {
  const units = new Uint16Array(text.length * 2)
  let length = 0
  let word = false

  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    const letter = wordCharacter(code)

    if (letter && !word) units[length++] = MARK_CODE
    units[length++] = code
    word = letter
  }

  return UTF16.decode(units.subarray(0, length))
}

/** Whether a UTF-16 code unit is part of a word: a letter or a digit of any script. Punctuation and spaces are not. */
function wordCharacter(code: number) {
  if (code < 128) return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || (code >= 65 && code <= 90)

  // Half of a character outside the basic plane, such as an emoji or a rarer ideograph.
  if (code >= 0xd800 && code <= 0xdfff) return true

  return /[\p{L}\p{N}]/u.test(String.fromCharCode(code))
}

/**
 * How often and how recently a page was visited, as one number to order pages that match equally well: its
 * `frequency` times its `recency`.
 */
export function frecency(visits: number, typed: number, visited: number, now: number) {
  return frequency(visits, typed) * recency(visited, now)
}

/**
 * How often a page was visited. It grows with the logarithm of the visits, so the hundredth visit adds less than the
 * second, and a typed visit counts twice.
 */
export function frequency(visits: number, typed: number) {
  return Math.log2(1 + visits + typed)
}

/**
 * How recently a page was visited: 1 in the last 4 days, falling to 0.7 at 14 days, 0.5 at 31, 0.3 at 90 and 0.1 from
 * a year on.
 */
export function recency(visited: number, now: number) {
  const days = (now - visited) / DAY

  if (days <= 4) return 1

  if (days <= 14) return 0.7 + ((14 - days) * 0.3) / 10

  if (days <= 31) return 0.5 + ((31 - days) * 0.2) / 17

  if (days <= 90) return 0.3 + ((90 - days) * 0.2) / 59

  if (days <= 365) return 0.1 + ((365 - days) * 0.2) / 275

  return 0.1
}

/** Splits text around the query's words, case-insensitively, for drawing the matched parts. */
export function markMatches(text: string, query: Query | undefined) {
  if (!query) return [{ text, match: false }]
  const lower = text.toLowerCase()

  const ranges = query.words
    .flatMap((word) => {
      const found: [number, number][] = []

      for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) found.push([at, at + word.length])

      return found
    })
    .toSorted((a, b) => a[0] - b[0])

  // Two words can match overlapping text, which is drawn once.
  const merged: [number, number][] = []

  ranges.forEach((range) => {
    const last = merged.at(-1)

    if (!last || range[0] > last[1]) return void merged.push(range)
    last[1] = Math.max(last[1], range[1])
  })

  return [0, ...merged.flat(), text.length].flatMap((start, index, all) => {
    const end = all[index + 1]

    return end === undefined || end === start ? [] : [{ text: text.slice(start, end), match: index % 2 === 1 }]
  })
}
