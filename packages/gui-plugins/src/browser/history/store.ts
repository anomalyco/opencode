import { mkdirSync } from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { MAX_PAGES, pageKey, pageTitle, type PageVisit } from "./page"
import { createPageIndex, findPages, type PageIndex } from "./search"

export type HistoryStore = ReturnType<typeof createHistoryStore>

type Row = { id: number; url: string; title: string; visits: number; typed: number; visited: number }

/** Every page as a search compares it, once the first search or a full store needed it. */
type Loaded = { index?: PageIndex }

/** How many pages a full store drops at once, so that a visit seldom has to make room. */
const ROOM = 500

const FILE = "history.sqlite"

/**
 * Deletes a history store's file, with its write-ahead log: what clearing comes to for a store that cannot be opened
 * or cleared, as one whose file is damaged. The store must be closed. Rejects while any of the files stays.
 */
export async function removeHistoryStore(directory: string) {
  // Windows refuses to delete a file a scanner holds open for a moment, so each is tried once more.
  await Promise.all(
    ["", "-wal", "-shm", "-journal"].map((suffix) => rm(path.join(directory, `${FILE}${suffix}`), { force: true, maxRetries: 1, retryDelay: 200 })),
  )
}

/**
 * The browsing history on this computer: one row per page (see `pageKey`) in a SQLite file of the app's own data. It
 * holds the pages visited here and the pages imported from other browsers, at most `MAX_PAGES`; past that the ones
 * visited least and longest ago go. The first search reads every page into memory, in the form a search compares, and
 * the store keeps that index in step from then on; a visit before it only writes its row, so a page that loads as the
 * app starts costs no read of the history. Nothing here leaves the main process but the few pages a search returns to
 * a window.
 */
export function createHistoryStore(input: { readonly directory: string }) {
  mkdirSync(input.directory, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(path.join(input.directory, FILE))

  // `secure_delete` overwrites what a delete frees, so a cleared history is not left in the file's unused pages.
  const schema = `
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      visits INTEGER NOT NULL,
      typed INTEGER NOT NULL,
      visited INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  `

  // A file that is not a database fails at its first statement, which has no form that does not throw. The file is
  // let go before the failure goes on, so that it can be deleted.
  try {
    db.exec(schema)
  } catch (cause) {
    db.close()
    throw cause
  }

  const columns = "id, url, title, visits, typed, visited"
  const byID = db.prepare(`SELECT ${columns} FROM pages WHERE id = ?`)
  const byKey = db.prepare(`SELECT ${columns} FROM pages WHERE key = ?`)
  const drop = db.prepare("DELETE FROM pages WHERE id = ?")

  // A visit here: the page's count goes up, and the address and title are the ones just seen.
  const visited = db.prepare(`
    INSERT INTO pages (key, url, title, visits, typed, visited) VALUES (?, ?, ?, 1, 0, ?)
    ON CONFLICT (key) DO UPDATE SET
      url = excluded.url,
      title = CASE WHEN excluded.title = '' THEN title ELSE excluded.title END,
      visits = visits + 1,
      visited = excluded.visited
    RETURNING ${columns}`)

  // A page of another browser: counts are the larger of the two, so importing a profile again adds nothing, and the
  // address and title are those of the later visit.
  const merged = db.prepare(`
    INSERT INTO pages (key, url, title, visits, typed, visited) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET
      url = CASE WHEN excluded.visited >= visited THEN excluded.url ELSE url END,
      title = CASE WHEN excluded.title != '' AND (excluded.visited >= visited OR title = '') THEN excluded.title ELSE title END,
      visits = max(visits, excluded.visits),
      typed = max(typed, excluded.typed),
      visited = max(visited, excluded.visited)
    RETURNING ${columns}`)

  // A page the window kept before this store existed: only where the store has no row for it.
  const adopted = db.prepare(`
    INSERT INTO pages (key, url, title, visits, typed, visited) VALUES (?, ?, ?, 1, 0, ?)
    ON CONFLICT (key) DO NOTHING
    RETURNING ${columns}`)

  const titled = db.prepare("UPDATE pages SET title = ? WHERE id = ?")
  const counted = db.prepare("SELECT count(*) AS pages FROM pages")
  const loaded: Loaded = {}

  // SAFETY: the statements above name the columns of `pages`, which this module alone creates and writes, in `Row`'s
  // types; a statement that returns no row returns undefined.
  const row = (value: ReturnType<typeof byID.get>) => value as Row | undefined

  const index = () => {
    if (loaded.index) return loaded.index
    const created = createPageIndex()
    // SAFETY: as `row`, for every row of the table.
    const stored = db.prepare(`SELECT ${columns} FROM pages`).all() as Row[]

    stored.forEach((page) => created.set(page.id, page))
    loaded.index = created

    return created
  }

  // SQLite has no transaction that ends by itself: a write that throws must be rolled back, or the next one fails.
  const transaction = <T>(run: () => T) => {
    db.exec("BEGIN")

    try {
      const result = run()
      db.exec("COMMIT")

      return result
    } catch (cause) {
      db.exec("ROLLBACK")
      throw cause
    }
  }

  // Drops the pages visited least and longest ago, so that `room` fewer than the limit remain. Which pages those
  // are is the index's to say.
  const prune = (room: number) => {
    const pages = index()
    const least = pages.least(MAX_PAGES - room, Date.now())

    if (least.length === 0) return
    transaction(() => least.forEach((id) => drop.run(id)))
    least.forEach(pages.remove)
  }

  const keep = (value: ReturnType<typeof byID.get>) => {
    const page = row(value)

    if (page) loaded.index?.set(page.id, page)
  }

  // SAFETY: `count(*)` is one row with one integer.
  const size = () => loaded.index?.size() ?? (counted.get() as { pages: number }).pages

  return {
    /** How many pages the history holds. */
    size,
    /**
     * Reads the history into memory, which the first search otherwise does: a tenth of a second for a full history.
     * Visits before it wrote their rows without reading the history, so they made no room, and this does.
     */
    prepare() {
      if (!loaded.index && index().size() > MAX_PAGES) prune(ROOM)
    },
    /** The `limit` pages that match what the person typed, best first; see `findPages`. */
    search(text: string, limit: number) {
      if (!loaded.index && index().size() > MAX_PAGES) prune(ROOM)

      return findPages(index(), text, limit, Date.now(), { shown: (id) => row(byID.get(id)), front: (host) => row(byKey.get(host)) })
    },
    /** Records a visit to a page here. An address the history never keeps is ignored. */
    visit(url: string, title: string) {
      const key = pageKey(url)

      if (!key) return
      keep(visited.get(key, url, pageTitle(title), Date.now()))

      // A full store makes room, once a search has read it; until then a visit only writes its row.
      if (loaded.index && loaded.index.size() > MAX_PAGES) prune(ROOM)
    },
    /** Gives a page its title once the page has reported it; not a visit. */
    retitle(url: string, title: string) {
      const key = pageKey(url)
      const page = key ? row(byKey.get(key)) : undefined
      const next = pageTitle(title)

      if (!page || !next || next === page.title) return
      titled.run(next, page.id)
      loaded.index?.set(page.id, { ...page, title: next })
    },
    /**
     * Adds another browser's pages, each merged into the row of the page it names. Returns how many pages came: the
     * distinct pages among those the history keeps.
     */
    add(pages: readonly PageVisit[]) {
      const now = Date.now()
      const distinct = new Map<string, PageVisit>()

      pages.forEach((page) => {
        const key = pageKey(page.url)

        if (!key || page.visits < 1) return
        const known = distinct.get(key)
        const next = { ...page, title: pageTitle(page.title), visited: Math.min(page.visited, now) }

        // Two addresses of one page, such as its http and https forms, are one row with the visits of both.
        distinct.set(
          key,
          known
            ? {
                url: next.visited >= known.visited ? next.url : known.url,
                title: (next.visited >= known.visited ? next.title : known.title) || known.title || next.title,
                visits: known.visits + next.visits,
                typed: known.typed + next.typed,
                visited: Math.max(known.visited, next.visited),
              }
            : next,
        )
      })

      transaction(() =>
        distinct.forEach((page, key) => keep(merged.get(key, page.url, page.title, page.visits, page.typed, page.visited))),
      )

      if (size() > MAX_PAGES) prune(0)

      return distinct.size
    },
    /**
     * Takes over the pages the windows kept before this store existed, newest first, once: `read` is asked for them
     * only the first time, so a page the person removed since does not come back.
     */
    adopt(read: () => readonly { readonly url: string; readonly title: string }[]) {
      if (db.prepare("SELECT 1 FROM meta WHERE key = 'adopted'").get()) return
      const now = Date.now()

      transaction(() => {
        read().forEach((visit, position) => {
          const key = pageKey(visit.url)

          // The list has no times: its order stands in for them.
          if (key) keep(adopted.get(key, visit.url, pageTitle(visit.title), now - position))
        })
        db.prepare("INSERT INTO meta (key, value) VALUES ('adopted', '1')").run()
      })

      if (size() > MAX_PAGES) prune(0)
    },
    /** Forgets one page. */
    remove(url: string) {
      const key = pageKey(url)
      const page = key ? row(byKey.get(key)) : undefined

      if (!page) return
      drop.run(page.id)
      loaded.index?.remove(page.id)
    },
    /** Forgets every page, and leaves none of them in the file. */
    clear() {
      db.exec("DELETE FROM pages")
      loaded.index?.clear()
      // The rows are overwritten in the file; the write-ahead log still holds them until it is folded in and emptied.
      db.exec("VACUUM")
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    },
    close() {
      db.close()
    },
  }
}
