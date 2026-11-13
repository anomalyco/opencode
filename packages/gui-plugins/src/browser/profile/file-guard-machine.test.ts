import { expect, test } from "bun:test"
import { initialFileGuard, transitionFileGuard, type FileGuardEvent } from "./file-guard-machine"

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

test("an event that changes nothing returns the same state", () => {
  const started = transitionFileGuard(initialFileGuard, { type: "navigation.started", contents: 1, url: file })

  expect(transitionFileGuard(started, { type: "navigation.started", contents: 1, url: file })).toBe(started)
  expect(transitionFileGuard(initialFileGuard, { type: "destroyed", contents: 3 })).toBe(initialFileGuard)
})
