import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { MAX_PAGES, MAX_URL_LENGTH } from "../history"
import { readChromiumHistory, readSafariHistory } from "./history"
import { madeUpFirefox } from "./made-up-firefox.fixture"
import { siteFilter } from "./sites"
import { readSourceHistory } from "./sources"

const NOW = Date.parse("2026-11-20T12:00:00Z")

const DAY = 86_400_000

// Chromium counts microseconds since 1601, Safari seconds since 2001.
const chromiumTime = (daysAgo: number) => (NOW - daysAgo * DAY + 11_644_473_600_000) * 1000

const safariTime = (daysAgo: number) => (NOW - daysAgo * DAY) / 1000 - 978_307_200

// The `urls` table as Chromium's history database version 70 creates it.
const CHROMIUM_URLS =
  "CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT,url LONGVARCHAR,title LONGVARCHAR,visit_count INTEGER DEFAULT 0 NOT NULL,typed_count INTEGER DEFAULT 0 NOT NULL,last_visit_time INTEGER NOT NULL,hidden INTEGER DEFAULT 0 NOT NULL)"

// Safari's two history tables, as macOS 15 creates them.
const SAFARI_TABLES = `
  CREATE TABLE history_items (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, domain_expansion TEXT NULL, visit_count INTEGER NOT NULL, daily_visit_counts BLOB NOT NULL, weekly_visit_counts BLOB NULL, autocomplete_triggers BLOB NULL, should_recompute_derived_visit_counts INTEGER NOT NULL, visit_count_score INTEGER NOT NULL);
  CREATE TABLE history_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, history_item INTEGER NOT NULL REFERENCES history_items(id) ON DELETE CASCADE, visit_time REAL NOT NULL, title TEXT NULL, load_successful BOOLEAN NOT NULL DEFAULT 1, http_non_get BOOLEAN NOT NULL DEFAULT 0, synthesized BOOLEAN NOT NULL DEFAULT 0, redirect_source INTEGER NULL UNIQUE REFERENCES history_visits(id) ON DELETE CASCADE, redirect_destination INTEGER NULL UNIQUE REFERENCES history_visits(id) ON DELETE CASCADE, origin INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, attributes INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0);
`

const saved = { ...process.env }

const made: string[] = []

async function database(name: string, fill: (db: DatabaseSync) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-history-read-"))
  made.push(directory)
  const file = path.join(directory, name)
  const db = new DatabaseSync(file)
  fill(db)
  db.close()

  // Copies go under the test's own directory, as the profile puts them under the app's data.
  return { file, scratch: { directory: path.join(directory, "copies"), live: new Set<string>(), log: () => undefined } }
}

beforeEach(() => {
  setSystemTime(new Date(NOW))
})

afterEach(async () => {
  setSystemTime()
  Object.keys(process.env)
    .filter((key) => !(key in saved))
    .forEach((key) => delete process.env[key])
  Object.assign(process.env, saved)
  await Promise.all(made.splice(0).map((directory) => rm(directory, { recursive: true, force: true }).catch(() => undefined)))
})

test("reads a Chromium history: visited web pages, most used and most recent first, and leaves no copy behind", async () => {
  const source = await database("History", (db) => {
    db.exec(CHROMIUM_URLS)
    const insert = db.prepare("INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?, ?)")
    insert.run("https://github.com/anomalyco/rune-desktop", "anomalyco/rune-desktop", 40, 2, chromiumTime(1), 0)
    insert.run("https://old.test/guide", "Guide", 40, 2, chromiumTime(300), 0)
    insert.run("http://localhost:3000/", "Local app", 1, 0, chromiumTime(0), 0)
    // What an import never brings: other schemes, credentials, an address too long, a hidden row, no visit.
    insert.run("chrome://settings/", "Settings", 9, 0, chromiumTime(0), 0)
    insert.run("file:///C:/Users/me/notes.html", "Notes", 9, 0, chromiumTime(0), 0)
    insert.run("https://me:secret@private.test/", "Private", 9, 0, chromiumTime(0), 0)
    insert.run(`https://long.test/${"a".repeat(MAX_URL_LENGTH)}`, "Long", 9, 0, chromiumTime(0), 0)
    insert.run("https://github.com/subframe", "A subframe", 9, 0, chromiumTime(0), 1)
    insert.run("https://unvisited.test/", "Never visited", 0, 0, chromiumTime(0), 0)
    // Damage: a title that is not text reads as no title, a count that is not a number as no visit.
    insert.run("https://damaged.test/title", Buffer.from("blob"), 2, 0, chromiumTime(5), 0)
    insert.run("https://damaged.test/count", "Count", "many", 0, chromiumTime(0), 0)
    insert.run(Buffer.from("https://damaged.test/url"), "Address", 3, 0, chromiumTime(0), 0)
  })

  expect(await readChromiumHistory(source.file, source.scratch, { now: NOW })).toEqual([
    { url: "https://github.com/anomalyco/rune-desktop", title: "anomalyco/rune-desktop", visits: 40, typed: 2, visited: NOW - DAY },
    { url: "https://old.test/guide", title: "Guide", visits: 40, typed: 2, visited: NOW - 300 * DAY },
    { url: "https://damaged.test/title", title: "", visits: 2, typed: 0, visited: NOW - 5 * DAY },
    { url: "http://localhost:3000/", title: "Local app", visits: 1, typed: 0, visited: NOW },
  ])
  expect((await readdir(source.scratch.directory)).filter((entry) => entry.startsWith("opencode-browser-import-"))).toEqual([])
})

test("reads a Chromium history that lacks the optional columns, and nothing from one without addresses", async () => {
  const bare = await database("History", (db) => {
    db.exec("CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, last_visit_time INTEGER)")
    db.prepare("INSERT INTO urls (url, last_visit_time) VALUES (?, ?)").run("https://example.com/", chromiumTime(2))
  })

  expect(await readChromiumHistory(bare.file, bare.scratch, { now: NOW })).toEqual([
    { url: "https://example.com/", title: "", visits: 1, typed: 0, visited: NOW - 2 * DAY },
  ])

  const renamed = await database("History", (db) => db.exec("CREATE TABLE urls (id INTEGER PRIMARY KEY, address TEXT)"))
  expect(await readChromiumHistory(renamed.file, renamed.scratch, { now: NOW })).toEqual([])
})

test(
  "an import brings at most 50,000 pages, the most used and most recent",
  async () => {
    const source = await database("History", (db) => {
      db.exec(CHROMIUM_URLS)
      // Ten more than the limit, each visited once a minute apart; the first is the oldest.
      db.exec(`
        WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ${MAX_PAGES + 10})
        INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden)
        SELECT 'https://site.test/page/' || n, 'Page ' || n, 1, 0, ${chromiumTime(40)} + n * 60000000, 0 FROM numbers`)
      db.prepare("INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?, ?)").run(
        "https://often.test/",
        "Often",
        500,
        0,
        chromiumTime(300),
        0,
      )
    })

    const pages = await readChromiumHistory(source.file, source.scratch, { now: NOW })

    expect(pages).toHaveLength(MAX_PAGES)
    expect(pages[0]?.url).toBe("https://often.test/")
    // The eleven oldest single visits stay behind.
    expect(pages.some((page) => page.url === "https://site.test/page/11")).toBe(false)
    expect(pages.some((page) => page.url === "https://site.test/page/12")).toBe(true)
  },
  // Writes and reads 50,000 rows.
  30_000,
)

test("reads a Safari history: each page with its latest visit's title and time", async () => {
  const source = await database("History.db", (db) => {
    db.exec(SAFARI_TABLES)
    const item = db.prepare("INSERT INTO history_items (id, url, visit_count, daily_visit_counts, should_recompute_derived_visit_counts, visit_count_score) VALUES (?, ?, ?, x'', 0, 0)")
    const visit = db.prepare("INSERT INTO history_visits (history_item, visit_time, title) VALUES (?, ?, ?)")
    item.run(1, "https://github.com/anomalyco/rune-desktop", 3)
    visit.run(1, safariTime(9), "Loading…")
    visit.run(1, safariTime(1), "anomalyco/rune-desktop")
    visit.run(1, safariTime(4), null)
    item.run(2, "https://www.apple.com/", 1)
    visit.run(2, safariTime(20), "Apple")
    item.run(3, "file:///Users/me/notes.html", 4)
    visit.run(3, safariTime(0), "Notes")
    // An address with no visit left is not history.
    item.run(4, "https://unvisited.test/", 2)
  })

  expect(await readSafariHistory(source.file, source.scratch, { now: NOW })).toEqual([
    { url: "https://github.com/anomalyco/rune-desktop", title: "anomalyco/rune-desktop", visits: 3, typed: 0, visited: NOW - DAY },
    { url: "https://www.apple.com/", title: "Apple", visits: 1, typed: 0, visited: NOW - 20 * DAY },
  ])
})

test("a profile's history comes from Firefox's own table, and with chosen sites only theirs", async () => {
  const profile = await madeUpFirefox()
  made.push(profile.home)
  Object.assign(process.env, profile.env)
  const scratch = { directory: path.join(profile.home, "copies"), live: new Set<string>(), log: () => undefined }

  const all = await readSourceHistory("firefox", "Profiles/work.default", scratch)

  if ("failure" in all) throw new Error(`The made-up profile did not read: ${all.failure}`)
  // The bookmark never visited and the hidden redirect hop stay behind; a page without a title has none.
  expect(all.map((page) => [page.url, page.title, page.visits, page.typed])).toEqual([
    ["https://github.com/anomalyco/rune-desktop", "anomalyco/rune-desktop", 12, 1],
    ["https://www.bank.test/accounts", "", 2, 0],
    ["https://github.com/", "GitHub", 3, 0],
  ])
  expect(Math.abs((all[0]?.visited ?? 0) - (NOW - DAY))).toBeLessThan(1_000)

  const chosen = await readSourceHistory("firefox", "Profiles/work.default", scratch, siteFilter(["bank.test"]))
  expect("failure" in chosen ? chosen : chosen.map((page) => page.url)).toEqual(["https://www.bank.test/accounts"])

  // Safari's history is on macOS only, and a browser that is not installed has none: both answer quietly.
  expect(await readSourceHistory("safari", "default", scratch)).toEqual({ failure: "read" })
  expect(await readSourceHistory("firefox", "Profiles/missing", scratch)).toEqual({ failure: "read" })
})
