// How many rows on each side of a place are remembered to stand in for its row.
export const PLACE_NEIGHBOURS = 4

// How many sessions keep the place of a reader who left their end. A place is a few row keys and two numbers, well
// under a kilobyte, so this is far more than the 16 views and the 16 sets of row sizes that are kept: a reader finds
// their place in any session they are likely to come back to before the window is reloaded, for about 100 KB at most.
export const KEPT_PLACES = 128

/**
 * Where a reader who left the end of a session was when its timeline went away: what they come back to. Kept by row
 * key and by a position in a row's text, so it means the same after rows arrive above it, after the rows wrap again
 * at another width, and in a view that is built again with no row measured.
 */
export type Place = {
  /** The row at the top of the view, and how far into it the view began. */
  readonly key: string
  readonly offset: number
  /** The rows after and before that row, nearest first. They stand in for it when it is gone. */
  readonly after: readonly string[]
  readonly before: readonly string[]
  /**
   * What the reader was on: a letter, by its row and by how many letters of the row's text come before it. `top`:
   * where the top of the letter was on the screen. Unset when the view had not come to rest on text.
   */
  readonly letter?: { readonly key: string; readonly index: number; readonly top: number }
}

export type PlaceTarget =
  /**
   * The view begins `offset` into the row at index `row`. `letter`: what the reader was on is still in the list,
   * in the row at that index, and goes back where it was on the screen.
   */
  | {
      readonly type: "row"
      readonly row: number
      readonly offset: number
      readonly letter?: { readonly row: number; readonly index: number; readonly top: number }
    }
  /** The passage is gone, with every row that could stand in for it: the reader comes back to the end. */
  | { readonly type: "end" }

const END: PlaceTarget = Object.freeze({ type: "end" })

/**
 * Finds a place in the rows a session has now. Its own row first. When that row is gone, the nearest remembered row
 * after it, at its start. Then the row after the nearest remembered row before it. When there is none, because what
 * is left of the session ends before the place, the end.
 */
export function resolvePlace(place: Place, keys: readonly string[]): PlaceTarget {
  const nearest = (candidates: readonly string[]) => candidates.map((key) => keys.indexOf(key)).find((row) => row >= 0)
  const on = place.letter ? keys.indexOf(place.letter.key) : -1
  const letter = place.letter && on >= 0 ? { row: on, index: place.letter.index, top: place.letter.top } : undefined
  const row = keys.indexOf(place.key)

  if (row >= 0) return { type: "row", row, offset: place.offset, letter }
  const after = nearest(place.after)

  if (after !== undefined) return { type: "row", row: after, offset: 0, letter }
  const before = nearest(place.before)

  // The row the reader was on outlives the rows around the top of the view.
  if (letter) return { type: "row", row: letter.row, offset: 0, letter }

  if (before === undefined || before >= keys.length - 1) return END

  return { type: "row", row: before + 1, offset: 0 }
}

/** How many letters of a row's text come before a text position. Undefined for a position outside the row. */
export function letterIndex(row: Node, node: Text, offset: number) {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let before = 0

  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text === node) return before + Math.min(offset, node.length)
    before += text.textContent?.length ?? 0
  }
}

/** The text position that many letters into a row's text, or the row's last letter when its text is shorter. */
export function letterAt(row: Node, index: number) {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let before = 0
  let last: Text | undefined

  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!(text instanceof Text) || text.length === 0) continue
    last = text

    if (index < before + text.length) return { node: text, offset: index - before }
    before += text.length
  }

  return last && { node: last, offset: last.length - 1 }
}

// The places, by session. They are kept apart from the views and the row sizes, so they outlive both: the session
// screen is built again when the reader leaves the session route and comes back, and a view and its row sizes go when
// 16 other sessions have been opened. A session that is not here is one its reader followed, or has not opened.
const places = new Map<string, Place>()

/** Where the reader of a session was, when they had left its end. */
export function placeOf(session: string) {
  return places.get(session)
}

/** Keeps the place of a session's reader as its view goes away. No place: they followed its end. */
export function keepPlace(session: string, place: Place | undefined) {
  places.delete(session)

  if (!place) return
  places.set(session, place)

  if (places.size > KEPT_PLACES) places.delete(places.keys().next().value!)
}

/** Hands a session's place to the view that returns to it. Once: from then on the view itself is the place. */
export function takePlace(session: string) {
  const place = places.get(session)
  places.delete(session)

  return place
}
