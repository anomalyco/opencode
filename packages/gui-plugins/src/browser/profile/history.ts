import type { DatabaseSync } from "node:sqlite"
import { MAX_PAGES, MAX_URL_LENGTH, webPage, type PageVisit } from "../history"
import { snapshotDatabase, type SnapshotScratch } from "./database"

/** Milliseconds between 1601-01-01 (Chromium's epoch) and 1970-01-01. */
const WINDOWS_EPOCH_MS = 11_644_473_600_000

/** Seconds between 1970-01-01 and 2001-01-01, the epoch of Safari's timestamps. */
const MAC_EPOCH_SECONDS = 978_307_200

/** No browser has counted more visits to a page; a larger count is damage. */
const MOST_VISITS = 10_000_000

/** The year 2100 in Unix milliseconds; a later visit is damage. */
const LATEST_VISIT = 4_102_444_800_000

type Row = { url: string; title: string; visits: number; typed: number; visited: number }

/** What a reader keeps of a history: with `keep`, only the pages of the hosts it keeps. */
type Kept = { readonly keep?: (host: string) => boolean; readonly now: number }

/**
 * Reads a Chromium profile's `History`: its `urls` table has one row per address, with its title, how often it was
 * visited and typed, and its last visit in microseconds since 1601. Rows Chromium hides from its own address bar
 * (subframes and redirect hops) stay behind.
 */
export function readChromiumHistory(database: string, scratch: SnapshotScratch, kept: Kept) {
  return snapshotDatabase(database, scratch, (db) => {
    const has = columns(db, "urls")

    if (!has("url")) return []

    return collect(
      db,
      `SELECT url,
        ${has("title") ? "title" : "NULL"} AS title,
        ${has("visit_count") ? "visit_count" : "1"} AS visits,
        ${has("typed_count") ? "typed_count" : "0"} AS typed,
        ${has("last_visit_time") ? `last_visit_time / 1000 - ${WINDOWS_EPOCH_MS}` : "0"} AS visited
      FROM urls WHERE ${has("hidden") ? "hidden = 0" : "1"}`,
      kept,
    )
  })
}

/**
 * Reads a Firefox-family profile's `places.sqlite`: `moz_places` has one row per address, with its title, its visit
 * count, whether it was ever typed, and its last visit in microseconds since 1970. Bookmarks never visited and hidden
 * places stay behind. Its `frecency` is not read: what it means changed between Firefox versions.
 */
export function readFirefoxHistory(database: string, scratch: SnapshotScratch, kept: Kept) {
  return snapshotDatabase(database, scratch, (db) => {
    const has = columns(db, "moz_places")

    if (!has("url")) return []

    return collect(
      db,
      `SELECT url,
        ${has("title") ? "title" : "NULL"} AS title,
        ${has("visit_count") ? "visit_count" : "1"} AS visits,
        ${has("typed") ? "typed" : "0"} AS typed,
        ${has("last_visit_date") ? "last_visit_date / 1000" : "0"} AS visited
      FROM moz_places WHERE ${has("hidden") ? "hidden = 0" : "1"}`,
      kept,
    )
  })
}

/**
 * Reads Safari's `History.db`: `history_items` has one row per address and `history_visits` one per visit, with the
 * title the page had then and its time in seconds since 2001. A page's title and time are its latest visit's. Safari
 * records no typed visits.
 */
export function readSafariHistory(database: string, scratch: SnapshotScratch, kept: Kept) {
  return snapshotDatabase(database, scratch, (db) => {
    const item = columns(db, "history_items")
    const visit = columns(db, "history_visits")

    if (!item("id") || !item("url") || !visit("history_item") || !visit("visit_time")) return []

    // SQLite takes a bare column beside `max()` from the row that holds the maximum: the latest visit's title.
    return collect(
      db,
      `SELECT i.url AS url,
        ${visit("title") ? "v.title" : "NULL"} AS title,
        ${item("visit_count") ? "i.visit_count" : "count(*)"} AS visits,
        0 AS typed,
        (max(v.visit_time) + ${MAC_EPOCH_SECONDS}) * 1000 AS visited
      FROM history_items i JOIN history_visits v ON v.history_item = i.id GROUP BY i.id`,
      kept,
    )
  })
}

/** Whether a table has a column, so a browser version that lacks or renamed one still imports what it has. */
function columns(db: DatabaseSync, table: string) {
  // SAFETY: `table_info` returns one row per column, whose `name` is text.
  const names = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name))

  return (name: string) => names.has(name)
}

/**
 * The pages of one browser's history, from a query that names a row's `url`, `title`, `visits`, `typed` and
 * `visited` (Unix milliseconds): web pages visited at least once, the most used and most recent first, until
 * `MAX_PAGES` are kept. A value of another type than the browser writes is damage: it reads as no title, no visit
 * or no time, and a count or time beyond any real one is cut, so no row fails the read.
 */
function collect(db: DatabaseSync, select: string, kept: Kept) {
  // What the order sorts stays in memory, never in a temporary file outside the copy's own directory.
  db.exec("PRAGMA temp_store = MEMORY")

  const query = db.prepare(`
    SELECT url, title, visits, typed, visited FROM (
      SELECT url,
        CASE WHEN typeof(title) = 'text' THEN title ELSE '' END AS title,
        CASE WHEN typeof(visits) = 'integer' THEN min(visits, ${MOST_VISITS}) ELSE 0 END AS visits,
        CASE WHEN typeof(typed) = 'integer' THEN max(0, min(typed, ${MOST_VISITS})) ELSE 0 END AS typed,
        CASE WHEN typeof(visited) IN ('integer', 'real') THEN CAST(max(0, min(visited, ${LATEST_VISIT})) AS INTEGER) ELSE 0 END AS visited
      FROM (${select})
      WHERE typeof(url) = 'text' AND length(url) <= ${MAX_URL_LENGTH} AND (url LIKE 'http://%' OR url LIKE 'https://%')
    )
    WHERE visits > 0
    ORDER BY (visits + typed) * CASE
      WHEN ? - visited <= 345600000 THEN 100
      WHEN ? - visited <= 1209600000 THEN 70
      WHEN ? - visited <= 2678400000 THEN 50
      WHEN ? - visited <= 7776000000 THEN 30
      ELSE 10 END DESC, visited DESC`)

  const pages: PageVisit[] = []

  // Read row by row, so a history of a million addresses stops at the pages kept.
  // SAFETY: the query above gives every row these five columns, each in the type `Row` says.
  for (const row of query.iterate(kept.now, kept.now, kept.now, kept.now) as IterableIterator<Row>) {
    const page = webPage(row.url)

    if (!page || (kept.keep && !kept.keep(page.host))) continue
    pages.push({ url: row.url, title: row.title, visits: row.visits, typed: Math.min(row.typed, row.visits), visited: row.visited })

    if (pages.length === MAX_PAGES) break
  }

  return pages
}
