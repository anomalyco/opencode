import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { BuiltinMainStorage, MainStoreFrom } from "@opencode/plugin/gui/builtin"
import { earlierVisits } from "./earlier"
import { MAX_PAGES, type PageVisit } from "./page"
import { createHistoryStore, type HistoryStore } from "./store"

const NOW = Date.parse("2026-11-20T12:00:00Z")

const DAY = 86_400_000

const page = (url: string, title: string, visits: number, days: number, typed = 0): PageVisit => ({
  url,
  title,
  visits,
  typed,
  visited: NOW - days * DAY,
})

const rune = "https://github.com/anomalyco/rune-desktop"

const opencode = "https://github.com/anomalyco/opencode"

const opentui = "https://github.com/sst/opentui"

const essence = "https://runescape.wiki/w/Rune_essence"

const pruned = "https://example.com/blog/pruned-trees"

const keynote = "https://www.youtube.com/watch?v=abc"

const dashboard = "http://localhost:3000/dashboard"

const seeded = [
  page(rune, "anomalyco/rune-desktop: Rune for the desktop", 40, 1, 2),
  page(opencode, "anomalyco/opencode: The open source coding agent", 120, 0, 5),
  page(opentui, "sst/opentui", 30, 3),
  page(essence, "Rune essence - The RuneScape Wiki", 3, 200),
  page(pruned, "Pruned trees", 500, 0),
  page("https://gitlab.com/group/project", "Project · GitLab", 4, 20),
  page("https://news.ycombinator.com/item?id=1", "Show HN: Anomaly detection in Rust", 60, 1),
  page(dashboard, "Dashboard", 10, 0),
  page(keynote, "GitHub Universe keynote - YouTube", 25, 2),
]

const opened: { directory: string; store: HistoryStore }[] = []

async function open(directory?: string) {
  const store = createHistoryStore({ directory: directory ?? (await mkdtemp(path.join(tmpdir(), "browser-history-"))) })
  opened.push({ directory: directory ?? "", store })

  return store
}

const addresses = (store: HistoryStore, text: string, limit = 8) => store.search(text, limit).map((found) => found.url)

beforeEach(() => {
  setSystemTime(new Date(NOW))
})

afterEach(async () => {
  setSystemTime()
  opened.forEach((item) => item.store.close())
  // Bun's node:sqlite shim can keep the write-ahead log open on Windows after close(); the leftover is only here.
  await Promise.all(opened.splice(0).map((item) => (item.directory ? rm(item.directory, { recursive: true, force: true }).catch(() => undefined) : undefined)))
})

describe("what the address field finds", () => {
  test.each([
    // A word that starts a path segment or a title word comes before one found only inside a longer word, however
    // often that page was visited; a host that begins so brings its front page.
    ["rune", [rune, "https://runescape.wiki/", essence, pruned]],
    ["anom rune", [rune]],
    ["rune anom", [rune]],
    // The typed text begins a host: its front page leads with the visits of all its pages, then pages by how often
    // and how recently they were visited, whether the address or only the title matches.
    ["gith", ["https://github.com/", opencode, rune, opentui, keynote]],
    ["GITH", ["https://github.com/", opencode, rune, opentui, keynote]],
    ["github.com/anomalyco/ru", [rune]],
    ["https://github.com/sst", [opentui]],
    ["desktop", [rune]],
    // Inside a word only: by visits and recency.
    ["hub", [opencode, rune, opentui, keynote]],
    // The front page keeps the scheme and the port of the pages visited.
    ["local", ["http://localhost:3000/", dashboard]],
    ["nothing-like-this", []],
    ["   ", []],
    ["https://", []],
  ])("%p finds %p", async (text, expected) => {
    const store = await open()
    store.add(seeded)

    expect(addresses(store, text)).toEqual(expected)
  })

  test("a limit keeps the best, and a typed visit counts more than a plain one", async () => {
    const store = await open()
    store.add([page("https://a.test/docs", "Docs", 3, 0), page("https://b.test/docs", "Docs", 3, 0, 3), page("https://c.test/docs", "Docs", 2, 0)])

    expect(addresses(store, "docs", 2)).toEqual(["https://b.test/docs", "https://a.test/docs"])

    // A full list still makes way for a better match that was visited less.
    store.add([page(pruned, "Pruned trees", 500, 0), page("https://example.com/blog/rune-notes", "Notes", 2, 0)])
    expect(addresses(store, "rune", 1)).toEqual(["https://example.com/blog/rune-notes"])
  })

  test("an old page gives way to one visited as often lately", async () => {
    const store = await open()
    store.add([page("https://old.test/guide", "Guide", 10, 300), page("https://new.test/guide", "Guide", 10, 2)])

    expect(addresses(store, "guide")).toEqual(["https://new.test/guide", "https://old.test/guide"])
  })
})

test("the addresses of one page are one row, with the visits of all and the latest address and title", async () => {
  const store = await open()

  expect(
    store.add([
      page("http://www.example.org/docs/", "Old docs", 2, 30),
      page("https://example.org/docs", "Docs", 5, 1, 1),
      page("https://example.org/docs/", "", 1, 0),
      page("ftp://example.org/docs", "Not a web page", 9, 0),
      page("https://me:secret@example.org/private", "Credentials", 9, 0),
    ]),
  ).toBe(1)
  expect(store.size()).toBe(1)
  expect(store.search("docs", 8)).toEqual([{ url: "https://example.org/docs/", title: "Docs", score: Math.log2(1 + 8 + 1) }])

  // Importing the same profile again changes nothing.
  store.add([page("https://example.org/docs", "Docs", 5, 1, 1)])
  expect(store.search("docs", 8)[0]?.score).toBe(Math.log2(1 + 8 + 1))
})

test("a visit here counts on the page's row, and its title arrives later without counting", async () => {
  const store = await open()

  store.visit("https://example.org/docs", "")
  store.retitle("https://example.org/docs", "Docs")
  store.visit("http://www.example.org/docs/", "")
  store.visit("file:///home/me/notes.html", "Notes")
  store.visit("https://me:secret@example.org/private", "Private")

  expect(store.size()).toBe(1)
  expect(store.search("docs", 8)).toEqual([{ url: "http://www.example.org/docs/", title: "Docs", score: Math.log2(3) }])
})

test("the pages a window kept before the store existed come over once, web pages only", async () => {
  const store = await open()
  store.visit("https://kept.test/", "Visited here")

  store.adopt(() => [
    { url: "https://newest.test/", title: "Newest" },
    { url: "file:///home/me/notes.html", title: "Notes" },
    { url: "workspace://ses_1/index.html", title: "Preview" },
    { url: "https://kept.test/", title: "From the window" },
    { url: "https://oldest.test/", title: "Oldest" },
  ])

  expect(store.size()).toBe(3)
  // The list's order stands in for the visits' times, and a page the store already has keeps its own row.
  expect(store.search("test", 8).map((found) => found.title)).toEqual(["Visited here", "Newest", "Oldest"])

  store.remove("https://newest.test/")
  store.adopt(() => [{ url: "https://newest.test/", title: "Newest" }, { url: "https://later.test/", title: "Later" }])
  expect(addresses(store, "test")).toEqual(["https://kept.test/", "https://oldest.test/"])
})

test.each([
  ["opencode.global.dat\nplugin.browser.history"],
  // Where builds before the plugin rename kept the list.
  ["opencode.global.dat\nextension.browser.history"],
])("the windows' list is read from %p, where every window stores it, and stays theirs", (home) => {
  const listed = { visits: [{ url: "https://kept.test/", title: "Kept", icon: "data:image/png;base64,AAAA" }] }
  const removed: [string, boolean][] = []

  const storage = {
    // As main storage answers: the first older home that holds a value, else the initial one.
    store: (_key: string, options: { initial: typeof listed; from?: MainStoreFrom | readonly MainStoreFrom[] }) => ({
      value: [options.from ?? []].flat().some((from) => "state" in from && from.state.join("\n") === home) ? listed : options.initial,
    }),
    remove: (key: string, options?: { from?: MainStoreFrom | readonly MainStoreFrom[] }) => void removed.push([key, options?.from !== undefined]),
  }

  // SAFETY: `earlierVisits` calls only `store`, reading its value, and `remove`, which the object above implements.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  expect(earlierVisits(storage as unknown as BuiltinMainStorage)).toEqual(listed.visits)
  // Main's own copy goes; removing it names no older home, which would delete the windows' list with it.
  expect(removed).toEqual([["history.earlier", false]])
})

test("the history is on disk: another start finds the same pages", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-history-"))
  const first = await open(directory)
  first.add(seeded)
  first.adopt(() => [])
  const before = first.search("gith", 8)
  first.close()
  opened.pop()

  const second = await open(directory)
  expect(second.search("gith", 8)).toEqual(before)
  // The window's earlier pages were taken over by the first start.
  second.adopt(() => [{ url: "https://late.test/", title: "Late" }])
  expect(second.search("late", 8)).toEqual([])
})

test("removing a page forgets it, and clearing forgets every page and leaves none in the file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-history-"))
  const store = await open(directory)
  store.add([...seeded, page("https://zebra-marker.test/stripes", "Zebra marker stripes", 4, 0)])

  const stored = async () => {
    const files = await Promise.all(["history.sqlite", "history.sqlite-wal"].map((name) => readFile(path.join(directory, name)).catch(() => Buffer.alloc(0))))

    return Buffer.concat(files).toString("latin1")
  }

  expect(await stored()).toContain("zebra-marker")

  store.remove("http://www.github.com/anomalyco/rune-desktop/")
  expect(addresses(store, "rune")).toEqual(["https://runescape.wiki/", essence, pruned])

  store.clear()
  expect(store.size()).toBe(0)
  expect(store.search("zebra", 8)).toEqual([])
  const after = await stored()
  expect(after).not.toContain("zebra-marker")
  expect(after).not.toContain("Zebra marker")
})

test(
  "keeps at most 50,000 pages: the ones visited least and longest ago go",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "browser-history-"))
    const store = await open(directory)
    const extra = 5

    const many = Array.from({ length: MAX_PAGES + extra }, (_, position) =>
      page(`https://site-${position}.test/page`, `Page ${position}`, 1, position / 1000),
    )

    // An old page visited often outlasts newer pages visited once.
    expect(store.add([...many, page("https://often.test/", "Often", 400, 300)])).toBe(MAX_PAGES + extra + 1)
    expect(store.size()).toBe(MAX_PAGES)
    expect(addresses(store, "often.test")).toEqual(["https://often.test/"])
    expect(addresses(store, "site-0.test")).toEqual(["https://site-0.test/", "https://site-0.test/page"])
    expect(addresses(store, `site-${MAX_PAGES + extra - 1}.test`)).toEqual([])
    expect(addresses(store, `site-${MAX_PAGES - 2}.test`)).toEqual([`https://site-${MAX_PAGES - 2}.test/`, `https://site-${MAX_PAGES - 2}.test/page`])

    // A visit to a full history makes room and is kept.
    store.visit("https://fresh.test/", "Fresh")
    expect(store.size()).toBeLessThanOrEqual(MAX_PAGES)
    expect(addresses(store, "fresh")).toEqual(["https://fresh.test/"])
    store.add(Array.from({ length: 600 }, (_, position) => page(`https://refill-${position}.test/`, "Refill", 2, 0)))
    expect(store.size()).toBe(MAX_PAGES)
    store.close()
    opened.pop()

    // After a start, a visit only writes its row: the full history is not read to make room until the address field
    // is about to search it.
    const again = await open(directory)
    again.visit("https://startup.test/", "Startup")
    expect(again.size()).toBe(MAX_PAGES + 1)
    again.prepare()
    expect(again.size()).toBeLessThanOrEqual(MAX_PAGES)
    expect(addresses(again, "startup")).toEqual(["https://startup.test/"])
  },
  // Writes 50,000 rows.
  30_000,
)
