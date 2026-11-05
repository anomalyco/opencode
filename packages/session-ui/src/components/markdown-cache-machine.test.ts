import { describe, expect, test } from "bun:test"
import {
  INITIAL_MARKDOWN_CACHE_STATE,
  transitionMarkdownCache,
  type MarkdownCacheEffect,
  type MarkdownCacheEvent,
  type MarkdownCacheState,
} from "./markdown-cache-machine"

const entry = (src: string) => ({ raw: src, src, hash: `hash-${src}`, html: `<p>${src}</p>` })

function replay(events: MarkdownCacheEvent[], state = INITIAL_MARKDOWN_CACHE_STATE) {
  return events.reduce(
    (current, event) => {
      const next = transitionMarkdownCache(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] as MarkdownCacheEffect[] },
  )
}

function jobs(state: MarkdownCacheState, key: string) {
  return state.status === "running" ? state.keys.get(key) : undefined
}

describe("transitionMarkdownCache", () => {
  test("a cache touch on the key keeps its running parse joinable", () => {
    // `v1` is cached; consumer 1 asks for `v2`, then a readiness check touches `v1` before `v2` settles.
    const started = replay([
      { type: "cache.touched", key: "k", src: "v1" },
      { type: "render.requested", key: "k", raw: "v2", src: "v2" },
      { type: "cache.touched", key: "k", src: "v1" },
    ])

    expect(started.effects).toEqual([{ type: "start-parse", jobId: 1, raw: "v2", src: "v2" }])
    expect(jobs(started.state, "k")?.jobs.map((job) => job.jobId)).toEqual([1])

    const joined = transitionMarkdownCache(started.state, { type: "render.requested", key: "k", raw: "v2", src: "v2" })

    expect(joined.effects).toEqual([])
    expect(jobs(joined.state, "k")).toEqual({
      targetSrc: "v2",
      jobs: [{ jobId: 1, raw: "v2", src: "v2", consumers: [1, 2] }],
    })

    const settled = transitionMarkdownCache(joined.state, { type: "parse.succeeded", jobId: 1, entry: entry("v2") })

    expect(settled.effects).toEqual([
      { type: "store", key: "k", entry: entry("v2") },
      { type: "resolve-consumers", consumerIds: [1, 2], entry: entry("v2") },
    ])
    expect(settled.state).toEqual({ status: "idle", issuedJobs: 1, issuedConsumers: 2 })
  })

  test("a reclaimed key settles the abandoned parse without overwriting the cache", () => {
    const state = replay([
      { type: "render.requested", key: "k", raw: "abandoned", src: "abandoned" },
      { type: "cache.touched", key: "k", src: "v1" },
    ]).state

    expect(
      transitionMarkdownCache(state, { type: "parse.succeeded", jobId: 1, entry: entry("abandoned") }).effects,
    ).toEqual([{ type: "resolve-consumers", consumerIds: [1], entry: entry("abandoned") }])
  })

  test("an older parse of the same key settles its consumers while the newest one fills the cache", () => {
    const state = replay([
      { type: "render.requested", key: "k", raw: "a", src: "a" },
      { type: "render.requested", key: "k", raw: "ab", src: "ab" },
    ]).state

    const older = transitionMarkdownCache(state, { type: "parse.succeeded", jobId: 1, entry: entry("a") })

    expect(older.effects).toEqual([{ type: "resolve-consumers", consumerIds: [1], entry: entry("a") }])

    const newer = transitionMarkdownCache(older.state, { type: "parse.succeeded", jobId: 2, entry: entry("ab") })

    expect(newer.effects[0]).toEqual({ type: "store", key: "k", entry: entry("ab") })
    expect(newer.state.status).toBe("idle")
  })

  test("only the last consumer's abort cancels the shared parse", () => {
    const shared = replay([
      { type: "render.requested", key: "k", raw: "v", src: "v" },
      { type: "render.requested", key: "k", raw: "v", src: "v" },
    ]).state

    const first = transitionMarkdownCache(shared, { type: "consumer.aborted", consumerId: 1 })

    expect(first.effects).toEqual([{ type: "reject-consumers", consumerIds: [1], reason: { kind: "disposed" } }])
    expect(jobs(first.state, "k")?.jobs[0]?.consumers).toEqual([2])
    expect(transitionMarkdownCache(first.state, { type: "consumer.aborted", consumerId: 1 }).state).toBe(first.state)

    const last = transitionMarkdownCache(first.state, { type: "consumer.aborted", consumerId: 2 })

    expect(last.effects).toEqual([
      { type: "abort-parse", jobId: 1 },
      { type: "reject-consumers", consumerIds: [2], reason: { kind: "disposed" } },
    ])
    expect(last.state).toEqual({ status: "idle", issuedJobs: 1, issuedConsumers: 2 })

    const late = transitionMarkdownCache(last.state, { type: "parse.succeeded", jobId: 1, entry: entry("v") })

    expect(late.state).toBe(last.state)
    expect(late.effects).toEqual([])
  })

  test("a failed parse rejects every consumer and lets the key start again", () => {
    const shared = replay([
      { type: "render.requested", key: "k", raw: "v", src: "v" },
      { type: "render.requested", key: "k", raw: "v", src: "v" },
    ]).state
    const error = new Error("worker failed")
    const failed = transitionMarkdownCache(shared, { type: "parse.failed", jobId: 1, error })

    expect(failed.effects).toEqual([
      { type: "reject-consumers", consumerIds: [1, 2], reason: { kind: "error", error } },
    ])
    expect(
      transitionMarkdownCache(failed.state, { type: "render.requested", key: "k", raw: "v", src: "v" }).effects,
    ).toEqual([{ type: "start-parse", jobId: 2, raw: "v", src: "v" }])
  })

  test("an entry without a hash resolves its consumers but is not cached", () => {
    const state = replay([{ type: "render.requested", key: "k", raw: "v", src: "v" }]).state
    const settled = transitionMarkdownCache(state, {
      type: "parse.succeeded",
      jobId: 1,
      entry: { raw: "v", src: "v", hash: "", html: "" },
    })

    expect(settled.effects.map((effect) => effect.type)).toEqual(["resolve-consumers"])
  })

  test("events that match nothing return the same state", () => {
    const idle = INITIAL_MARKDOWN_CACHE_STATE

    expect(transitionMarkdownCache(idle, { type: "cache.touched", key: "k", src: "v" }).state).toBe(idle)
    expect(transitionMarkdownCache(idle, { type: "consumer.aborted", consumerId: 1 }).state).toBe(idle)

    const running = replay([{ type: "render.requested", key: "k", raw: "v", src: "v" }]).state

    expect(transitionMarkdownCache(running, { type: "cache.touched", key: "other", src: "v" }).state).toBe(running)
    expect(transitionMarkdownCache(running, { type: "cache.touched", key: "k", src: "v" }).state).toBe(running)
    expect(transitionMarkdownCache(running, { type: "parse.failed", jobId: 9, error: undefined }).state).toBe(running)
  })
})
