import { expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { fileURLWithin } from "../policy"
import { fileRequestCancelled, initialFileGuard, transitionFileGuard, type FileGuardEvent } from "./file-guard-machine"

const replay = (events: readonly FileGuardEvent[]) =>
  events.reduce<{ state: typeof initialFileGuard; on: boolean[] }>(
    (result, event) => {
      const state = transitionFileGuard(result.state, event)

      return { state, on: [...result.on, state.on] }
    },
    { state: initialFileGuard, on: [] },
  )

const file = "file:///C:/repo/index.html"

const web = "https://example.com/"

test.each([
  {
    name: "web pages never turn the guard on, so extensions see their requests",
    events: [
      { type: "navigation.started", contents: 1, url: web },
      { type: "frame.committed", contents: 1, url: web, process: 10 },
      { type: "loading.stopped", contents: 1, frames: [10] },
    ],
    on: [false, false, false],
  },
  {
    // On before Chromium creates the navigation's loaders, and on while the file: document lives.
    name: "a file: navigation turns it on when it starts, and leaving the file: page turns it off",
    events: [
      { type: "navigation.started", contents: 1, url: file },
      { type: "frame.committed", contents: 1, url: file, process: 10 },
      { type: "loading.stopped", contents: 1, frames: [10] },
      { type: "navigation.started", contents: 1, url: web },
      { type: "frame.committed", contents: 1, url: web, process: 11 },
      { type: "loading.stopped", contents: 1, frames: [11] },
    ],
    on: [true, true, true, true, true, false],
  },
  {
    // A web frame in the page must not end the guard while the file: navigation is still in flight.
    name: "another frame committing does not end a file: navigation that has not loaded",
    events: [
      { type: "navigation.started", contents: 1, url: file },
      { type: "frame.committed", contents: 1, url: web, process: 11 },
    ],
    on: [true, true],
  },
  {
    // A blob: or about:blank popup opened by the file: page shares its process and outlives the opener.
    name: "a popup in the file: page's process keeps it on after the opener closes",
    events: [
      { type: "navigation.started", contents: 1, url: file },
      { type: "frame.committed", contents: 1, url: file, process: 10 },
      { type: "loading.stopped", contents: 1, frames: [10] },
      { type: "frame.committed", contents: 2, url: "blob:null/4f1c", process: 10 },
      { type: "loading.stopped", contents: 2, frames: [10] },
      { type: "destroyed", contents: 1 },
      { type: "destroyed", contents: 2 },
    ],
    on: [true, true, true, true, true, true, false],
  },
  {
    name: "a file: navigation that never commits keeps it on until the page stops loading",
    events: [
      { type: "navigation.started", contents: 1, url: " FILE:///C:/repo/x.zip" },
      { type: "loading.stopped", contents: 1, frames: [10] },
    ],
    on: [true, false],
  },
  {
    name: "closing a page in the middle of a file: navigation turns it off",
    events: [
      { type: "navigation.started", contents: 1, url: file },
      { type: "destroyed", contents: 1 },
    ],
    on: [true, false],
  },
] satisfies { name: string; events: FileGuardEvent[]; on: boolean[] }[])("$name", (row) => {
  expect(replay(row.events).on).toEqual(row.on)
})

/**
 * When a `file:` document can still load something, worked out again from the whole event history rather than kept
 * up step by step: a live page has a `file:` navigation that started after it last stopped loading, or a live page's
 * frames (those it reported when it last stopped loading, and those that committed since) include a renderer process
 * that ever committed a `file:` document.
 */
function mustBeOn(history: readonly FileGuardEvent[]) {
  const isFile = (url: string) => /^\s*file:/i.test(url)

  const tainted = new Set(
    history.flatMap((event) => (event.type === "frame.committed" && isFile(event.url) ? [event.process] : [])),
  )

  return [...new Set(history.map((event) => event.contents))].some((page) => {
    const own = history.filter((event) => event.contents === page)
    const alive = own.slice(own.findLastIndex((event) => event.type === "destroyed") + 1)
    const stopAt = alive.findLastIndex((event) => event.type === "loading.stopped")
    const stop = alive[stopAt]
    const since = alive.slice(stopAt + 1)

    const frames = [
      ...(stop?.type === "loading.stopped" ? stop.frames : []),
      ...since.flatMap((event) => (event.type === "frame.committed" ? [event.process] : [])),
    ]

    return (
      since.some((event) => event.type === "navigation.started" && isFile(event.url)) ||
      frames.some((process) => tainted.has(process))
    )
  })
}

// The guard is a security boundary: no order of events may turn it off while a file: document can load something.
test("no order of events turns the guard off while a file: document can still load something", () => {
  // A small deterministic generator, so a failure replays with its seed.
  const random = (seed: number) => {
    const state = { value: seed }

    return (count: number) => {
      state.value = (state.value * 1_103_515_245 + 12_345) % 2_147_483_648

      return state.value % count
    }
  }

  const urls = [file, web, " FILE:///C:/repo/x.zip", "blob:null/4f1c", "about:blank", "data:text/html,x"]
  const processes = [10, 11, 12, 13]

  Array.from({ length: 400 }, (_, seed) => seed).forEach((seed) => {
    const pick = random(seed + 1)

    const event = (): FileGuardEvent => {
      const contents = 1 + pick(3)
      const kind = pick(4)

      if (kind === 0) return { type: "navigation.started", contents, url: urls[pick(urls.length)] ?? web }

      if (kind === 1)
        return { type: "frame.committed", contents, url: urls[pick(urls.length)] ?? web, process: processes[pick(4)] ?? 10 }

      if (kind === 2)
        return { type: "loading.stopped", contents, frames: processes.filter(() => pick(3) === 0) }

      return { type: "destroyed", contents }
    }

    const history = Array.from({ length: 24 }, event)

    history.reduce((state, next, index) => {
      const after = transitionFileGuard(state, next)
      const expected = mustBeOn(history.slice(0, index + 1))

      if (after.on !== expected) throw new Error(`seed ${seed}, step ${index}: on is ${after.on}, must be ${expected}`)

      return after
    }, initialFileGuard)
  })
})

test("a check that throws cancels the request instead of leaving it waiting", () => {
  expect(fileRequestCancelled(() => true)).toBe(false)
  expect(fileRequestCancelled(() => false)).toBe(true)

  expect(
    fileRequestCancelled(() => {
      throw new URIError("URI malformed")
    }),
  ).toBe(true)
})

// The profile's guard checks each file: request against the page's workspace roots with `fileURLWithin`.
const verdict = (root: string, file: string) =>
  fileRequestCancelled(() => fileURLWithin(pathToFileURL(file).href, [root])) ? "cancelled" : "allowed"

test.each(["a b", "a#b", "a?b", "naïve-ü", "日本語"])("a workspace named %p: inside loads, outside never", (name) => {
  const root = path.resolve("workspaces", name)

  expect(verdict(root, path.join(root, "index.html"))).toBe("allowed")
  expect(verdict(root, path.resolve("workspaces", "other", "index.html"))).toBe("cancelled")
})

test("a workspace or request with a stray % is never allowed outside, and always answered", () => {
  const root = path.resolve("workspaces", "100%-done")

  expect(verdict(root, path.resolve("workspaces", "other", "index.html"))).toBe("cancelled")
  expect(
    fileRequestCancelled(() => fileURLWithin(`${pathToFileURL(root).href}/%zz`, [path.resolve("workspaces")])),
  ).toBe(true)
})

// Needs `policy.ts` to stop decoding raw roots as URLs (assigned to its owner); then this passes and loses `failing`.
test.failing("a workspace with a % in its name loads its own files", () => {
  const root = path.resolve("workspaces", "100%-done")

  expect(verdict(root, path.join(root, "index.html"))).toBe("allowed")
})

test("an event that changes nothing returns the same state", () => {
  const started = transitionFileGuard(initialFileGuard, { type: "navigation.started", contents: 1, url: file })

  expect(transitionFileGuard(started, { type: "navigation.started", contents: 1, url: file })).toBe(started)
  expect(transitionFileGuard(initialFileGuard, { type: "destroyed", contents: 3 })).toBe(initialFileGuard)
  const loaded = transitionFileGuard(started, { type: "loading.stopped", contents: 1, frames: [10] })
  expect(transitionFileGuard(loaded, { type: "loading.stopped", contents: 1, frames: [10] })).toBe(loaded)
})
