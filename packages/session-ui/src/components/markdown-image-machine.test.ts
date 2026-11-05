import { expect, test } from "bun:test"
import {
  DISPOSED_MARKDOWN_IMAGES_STATE,
  IMAGE_READ_TIMEOUT_MS,
  INITIAL_MARKDOWN_IMAGES_STATE,
  NO_MARKDOWN_IMAGE_EFFECTS,
  selectMarkdownImageUrl,
  transitionMarkdownImages,
  type MarkdownImagesEvent,
  type MarkdownImagesState,
} from "./markdown-image-machine"

const synced = (...paths: string[]): MarkdownImagesEvent => ({ type: "paths.synced", paths: new Set(paths) })

const step = (state: MarkdownImagesState, event: MarkdownImagesEvent) => transitionMarkdownImages(state, event)

const read = (path: string, attempt: number) => ({ type: "read", path, attempt, timeoutMs: IMAGE_READ_TIMEOUT_MS })

test("retries a failed read after a backoff and loads, while streaming updates change nothing", () => {
  const loading = step(INITIAL_MARKDOWN_IMAGES_STATE, synced("chart.png"))
  expect(loading.effects).toEqual([read("chart.png", 1)])

  const waiting = step(loading.state, { type: "read.failed", path: "chart.png", attempt: 1 })
  expect(waiting.effects).toEqual([
    { type: "cancel", attempt: 1 },
    { type: "wait", path: "chart.png", attempt: 2, delayMs: 1000 },
  ])

  const streamed = step(waiting.state, synced("chart.png"))
  expect(streamed.state).toBe(waiting.state)
  expect(streamed.effects).toBe(NO_MARKDOWN_IMAGE_EFFECTS)

  const retried = step(waiting.state, { type: "retry.due", path: "chart.png", attempt: 2 })
  expect(retried.effects).toEqual([{ type: "cancel", attempt: 2 }, read("chart.png", 3)])

  const loaded = step(retried.state, {
    type: "read.succeeded",
    path: "chart.png",
    attempt: 3,
    url: "blob:1",
    revoke: true,
  })
  expect(loaded.effects).toEqual([{ type: "cancel", attempt: 3 }])
  expect(selectMarkdownImageUrl(loaded.state, "chart.png")).toBe("blob:1")
})

test("times out a hung read and gives up after the last retry", () => {
  const timeOut = (state: MarkdownImagesState, attempt: number) =>
    step(state, { type: "read.timed-out", path: "chart.png", attempt })
  const retry = (state: MarkdownImagesState, attempt: number) =>
    step(state, { type: "retry.due", path: "chart.png", attempt }).state
  const wait = (attempt: number, delayMs: number) => ({ type: "wait", path: "chart.png", attempt, delayMs })

  const first = timeOut(step(INITIAL_MARKDOWN_IMAGES_STATE, synced("chart.png")).state, 1)
  expect(first.effects).toEqual([{ type: "cancel", attempt: 1 }, wait(2, 1000)])
  const second = timeOut(retry(first.state, 2), 3)
  expect(second.effects).toEqual([{ type: "cancel", attempt: 3 }, wait(4, 2000)])
  const third = timeOut(retry(second.state, 4), 5)
  expect(third.effects).toEqual([{ type: "cancel", attempt: 5 }, wait(6, 4000)])

  const failed = timeOut(retry(third.state, 6), 7)
  expect(failed.effects).toEqual([{ type: "cancel", attempt: 7 }])
  expect(failed.state.status === "active" && failed.state.entries.get("chart.png")).toEqual({ status: "failed" })
})

test("settles an empty read as failed without a retry", () => {
  const loading = step(INITIAL_MARKDOWN_IMAGES_STATE, synced("notes.txt"))
  const failed = step(loading.state, { type: "read.empty", path: "notes.txt", attempt: 1 })

  expect(failed.effects).toEqual([{ type: "cancel", attempt: 1 }])
  expect(failed.state.status === "active" && failed.state.entries.get("notes.txt")).toEqual({ status: "failed" })
})

test("ignores late results and revokes their blob URLs", () => {
  const loading = step(INITIAL_MARKDOWN_IMAGES_STATE, synced("chart.png")).state
  const late = (state: MarkdownImagesState, revoke: boolean) =>
    step(state, { type: "read.succeeded", path: "chart.png", attempt: 1, url: "blob:stale", revoke })

  const timedOut = step(loading, { type: "read.timed-out", path: "chart.png", attempt: 1 }).state
  const removed = step(loading, synced()).state
  const disposed = step(loading, { type: "disposed" }).state

  ;[timedOut, removed, disposed].forEach((state) => {
    const result = late(state, true)
    expect(result.state).toBe(state)
    expect(result.effects).toEqual([{ type: "revoke-url", url: "blob:stale" }])
    expect(late(state, false).effects).toBe(NO_MARKDOWN_IMAGE_EFFECTS)
  })

  const stale = step(timedOut, { type: "read.failed", path: "chart.png", attempt: 1 })
  expect(stale.state).toBe(timedOut)
  expect(step(timedOut, { type: "retry.due", path: "chart.png", attempt: 1 }).state).toBe(timedOut)
})

test("cancels and revokes removed entries and everything on dispose", () => {
  const started = step(INITIAL_MARKDOWN_IMAGES_STATE, synced("a.png", "b.png", "c.png", "d.png")).state
  const events: MarkdownImagesEvent[] = [
    { type: "read.failed", path: "b.png", attempt: 2 },
    { type: "read.succeeded", path: "c.png", attempt: 3, url: "blob:c", revoke: true },
    { type: "read.succeeded", path: "d.png", attempt: 4, url: "data:d", revoke: false },
  ]
  const settled = events.reduce((state, event) => step(state, event).state, started)

  const removed = step(settled, synced("a.png"))
  expect(removed.effects).toEqual([
    { type: "cancel", attempt: 5 },
    { type: "revoke-url", url: "blob:c" },
  ])
  expect(removed.state.status === "active" && [...removed.state.entries.keys()]).toEqual(["a.png"])

  const disposed = step(settled, { type: "disposed" })
  expect(disposed.state).toBe(DISPOSED_MARKDOWN_IMAGES_STATE)
  expect(disposed.effects).toEqual([
    { type: "cancel", attempt: 1 },
    { type: "cancel", attempt: 5 },
    { type: "revoke-url", url: "blob:c" },
  ])
  expect(step(disposed.state, synced("a.png")).effects).toBe(NO_MARKDOWN_IMAGE_EFFECTS)
})
