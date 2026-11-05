import { describe, expect, test } from "bun:test"
import {
  EMPTY_WORKER_EFFECTS,
  HIGHLIGHT_STREAM_LIMIT,
  INITIAL_MARKDOWN_WORKER_STATE,
  transitionMarkdownWorker,
  WORKER_HANG_TIMEOUT_MS,
  WORKER_RETRY_DELAY_MS,
  type MarkdownWorkerEffect,
  type MarkdownWorkerEvent,
  type MarkdownWorkerMachineState,
} from "./markdown-worker-machine"
import type { MarkdownWorkerResponse } from "./markdown-worker-protocol"
import type { Block } from "./markdown-stream"

type Run = { state: MarkdownWorkerMachineState; effects: MarkdownWorkerEffect[] }

function replay(events: MarkdownWorkerEvent[], state = INITIAL_MARKDOWN_WORKER_STATE): Run {
  return events.reduce<Run>(
    (run, event) => {
      const next = transitionMarkdownWorker(run.state, event)

      return { state: next.state, effects: [...run.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const parse = (text = "text"): MarkdownWorkerEvent => ({ type: "parse.requested", text })

const project = (key: string, text = "text", live = true): MarkdownWorkerEvent => ({
  type: "project.requested",
  key,
  text,
  live,
})

const highlight = (key: string, text = "const x", complete = false): MarkdownWorkerEvent => ({
  type: "highlight.requested",
  key,
  text,
  language: "ts",
  complete,
})

const reply = (response: MarkdownWorkerResponse, attempt = 1): MarkdownWorkerEvent => ({
  type: "worker.message",
  attempt,
  response,
})

const highlighted = (id: number, key: string, reset = true): MarkdownWorkerResponse => ({
  type: "highlight",
  id,
  key,
  language: "ts",
  reset,
  stable: [["const", ""]],
  unstable: [[" x", ""]],
})

const projected = (id: number, key: string, from: number, blocks: Block[]): MarkdownWorkerResponse => ({
  type: "project",
  id,
  key,
  from,
  blocks,
})

const block = (raw: string): Block => ({ raw, src: raw, mode: "full" })

const posted = (effects: MarkdownWorkerEffect[]) =>
  effects.flatMap((effect) => (effect.type === "post" && effect.message.type !== "dispose" ? [effect.message.id] : []))

const disposals = (effects: MarkdownWorkerEffect[]) =>
  effects.flatMap((effect) => (effect.type === "post" && effect.message.type === "dispose" ? [effect.message.key] : []))

const rejected = (effects: MarkdownWorkerEffect[], kind?: string) =>
  effects.flatMap((effect) => (effect.type === "reject" && (!kind || effect.reason.kind === kind) ? effect.ids : []))

const ready = (state: MarkdownWorkerMachineState) => {
  if (state.status !== "ready") throw new Error(`expected ready, got ${state.status}`)

  return state
}

describe("worker failure and retry", () => {
  test("a crash rejects every request once, cools down, then a new worker serves the next request", () => {
    const crashed = replay([
      parse(),
      project("p"),
      highlight("h"),
      { type: "worker.crashed", attempt: 1, message: "boom" },
    ])

    expect(crashed.state.status).toBe("failed")
    expect(crashed.effects.filter((effect) => effect.type === "spawn-worker")).toEqual([
      { type: "spawn-worker", attempt: 1 },
    ])
    expect(crashed.effects.filter((effect) => effect.type === "close-worker")).toEqual([
      { type: "close-worker", attempt: 1 },
    ])
    expect(rejected(crashed.effects, "error")).toEqual([1, 2, 3])
    expect(crashed.effects.at(-1)).toEqual({ type: "schedule-retry", attempt: 1, delay: WORKER_RETRY_DELAY_MS })

    // The old worker stayed disabled for the page: this burst and every later request failed forever.
    const cooling = replay([highlight("h"), project("p")], crashed.state)
    expect(rejected(cooling.effects, "unavailable")).toEqual([4, 5])
    expect(cooling.effects.some((effect) => effect.type === "spawn-worker")).toBe(false)

    const retried = replay([{ type: "retry.ready", attempt: 1 }, highlight("h")], cooling.state)
    expect(retried.effects.slice(0, 2)).toEqual([
      { type: "spawn-worker", attempt: 2 },
      {
        type: "post",
        attempt: 2,
        message: { type: "highlight", id: 6, key: "h", text: "const x", language: "ts", complete: false },
      },
    ])
    expect(ready(retried.state).attempts).toBe(2)
  })

  test("a worker that cannot start rejects as unavailable, settles once, and retries after the cooldown", () => {
    const failed = replay([parse(), { type: "worker.spawn-failed", attempt: 1, message: "blocked" }])

    expect(failed.state.status).toBe("failed")
    expect(rejected(failed.effects, "unavailable")).toEqual([1])

    const duplicate = transitionMarkdownWorker(failed.state, { type: "worker.crashed", attempt: 1, message: "late" })
    expect(duplicate.state).toBe(failed.state)
    expect(duplicate.effects).toBe(EMPTY_WORKER_EFFECTS)
    const late = transitionMarkdownWorker(failed.state, reply({ type: "parse", id: 1, html: "<p>" }))
    expect(late.state).toBe(failed.state)
    expect(late.effects).toBe(EMPTY_WORKER_EFFECTS)

    const retried = replay([{ type: "retry.ready", attempt: 1 }, parse()], failed.state)
    expect(retried.effects[0]).toEqual({ type: "spawn-worker", attempt: 2 })
  })

  test("consecutive failures back off, and a reply resets the backoff", () => {
    const first = replay([parse(), { type: "worker.crashed", attempt: 1, message: "boom" }])

    const second = replay(
      [{ type: "retry.ready", attempt: 1 }, parse(), { type: "worker.crashed", attempt: 2, message: "boom" }],
      first.state,
    )

    expect(second.effects.at(-1)).toEqual({ type: "schedule-retry", attempt: 2, delay: WORKER_RETRY_DELAY_MS * 2 })

    const recovered = replay(
      [
        { type: "retry.ready", attempt: 2 },
        parse(),
        reply({ type: "parse", id: 3, html: "<p>" }, 3),
        parse(),
        { type: "worker.crashed", attempt: 3, message: "boom" },
      ],
      second.state,
    )

    expect(recovered.effects.at(-1)).toEqual({ type: "schedule-retry", attempt: 3, delay: WORKER_RETRY_DELAY_MS })
  })

  test("events from a replaced worker leave the live one untouched", () => {
    const live = ready(
      replay([
        highlight("h"),
        { type: "worker.crashed", attempt: 1, message: "boom" },
        { type: "retry.ready", attempt: 1 },
        highlight("h"),
      ]).state,
    )

    const stale: MarkdownWorkerEvent[] = [
      reply(highlighted(2, "h"), 1),
      { type: "worker.crashed", attempt: 1, message: "late" },
      { type: "worker.spawn-failed", attempt: 1, message: "late" },
      { type: "watchdog.fired", attempt: 1 },
      { type: "retry.ready", attempt: 1 },
    ]

    stale.forEach((event) => {
      const next = transitionMarkdownWorker(live, event)
      expect(next.state).toBe(live)
      expect(next.effects).toBe(EMPTY_WORKER_EFFECTS)
    })
  })
})

describe("highlight streams", () => {
  test("a batch of more than 200 code blocks rejects none of them", () => {
    const keys = Array.from({ length: 250 }, (_, index) => `block:${index}`)
    const requested = replay(keys.map((key) => highlight(key, "const x", true)))

    // The old 200-key LRU disposed block 0 when block 200 was requested, so its highlight fell back to plain text.
    expect(rejected(requested.effects)).toEqual([])
    expect(posted(requested.effects)).toHaveLength(250)

    const settled = replay(
      keys.map((key, index) => reply(highlighted(index + 1, key))),
      requested.state,
    )

    expect(settled.effects.filter((effect) => effect.type === "resolve-highlight")).toHaveLength(250)
    expect(ready(settled.state).highlightStreams.size).toBe(0)
  })

  test("past the limit, the oldest idle stream is evicted and a block with a request in flight is kept", () => {
    const keys = Array.from({ length: HIGHLIGHT_STREAM_LIMIT }, (_, index) => `block:${index}`)
    const idle = replay(keys.flatMap((key, index) => [highlight(key), reply(highlighted(index + 1, key))]))
    const before = ready(idle.state).highlightStreams.get("block:1")!.generation

    // Block 0 is streaming again; a 201st stream then settles.
    const next = replay(
      [highlight("block:0", "const xy"), highlight("fresh"), reply(highlighted(202, "fresh"))],
      idle.state,
    )

    expect(rejected(next.effects)).toEqual([])
    expect(disposals(next.effects)).toEqual(["block:1"])
    const streams = ready(next.state).highlightStreams
    expect(streams.has("block:0")).toBe(true)
    expect(streams.has("block:1")).toBe(false)
    expect(streams.size).toBe(HIGHLIGHT_STREAM_LIMIT)

    // The evicted block restarts with a generation it never rendered, so its DOM resets instead of appending.
    const restarted = replay([highlight("block:1", "const xyz"), reply(highlighted(203, "block:1"))], next.state)
    const value = restarted.effects.find((effect) => effect.type === "resolve-highlight")
    expect(value?.type === "resolve-highlight" && value.value.generation).toBeGreaterThan(before)
  })

  test("a highlight error forgets the stream on both sides before the queued snapshot is posted", () => {
    const run = replay([
      highlight("h", "a"),
      reply(highlighted(1, "h")),
      highlight("h", "ab"),
      highlight("h", "abc"),
      reply({ type: "error", id: 2, key: "h", message: "lexer" }),
    ])

    expect(rejected(run.effects, "error")).toEqual([2])
    expect(run.effects.slice(-2).map((effect) => effect.type === "post" && effect.message.type)).toEqual([
      "dispose",
      "highlight",
    ])
    expect(ready(run.state).highlightStreams.has("h")).toBe(false)
    expect(ready(run.state).generationFloor).toBe(1)
  })
})

describe("projections", () => {
  test("an error reply clears the projection base and resets the worker before the queued request", () => {
    const run = replay([
      project("p", "a"),
      reply(projected(1, "p", 0, [block("a")])),
      project("p", "ab"),
      project("p", "abc"),
      reply({ type: "error", id: 2, key: "p", message: "boom" }),
    ])

    expect(rejected(run.effects, "error")).toEqual([2])
    expect(ready(run.state).projections.has("p")).toBe(false)
    expect(run.effects.slice(-2)).toEqual([
      { type: "post", attempt: 1, message: { type: "dispose", key: "p" } },
      { type: "post", attempt: 1, message: { type: "project", id: 3, key: "p", text: "abc", live: true } },
    ])
  })

  test("a diff from past the blocks this thread holds is rejected, and the next full reply recovers", () => {
    const run = replay([
      project("p", "a"),
      reply(projected(1, "p", 0, [block("a")])),
      project("p", "a b c"),
      // The worker diffed against two blocks this thread never applied; the old code silently dropped them.
      reply(projected(2, "p", 3, [block("d")])),
    ])

    expect(rejected(run.effects, "error")).toEqual([2])
    expect(disposals(run.effects)).toEqual(["p"])
    expect(ready(run.state).projections.has("p")).toBe(false)

    const recovered = replay(
      [project("p", "a b c d"), reply(projected(3, "p", 0, [block("a"), block("b c d")]))],
      run.state,
    )

    expect(recovered.effects.find((effect) => effect.type === "resolve-project")).toEqual({
      type: "resolve-project",
      id: 3,
      projection: { text: "a b c d", blocks: [block("a"), block("b c d")] },
    })
  })

  test("a late refusal for a disposed projection leaves a highlight lane with the same key alone", () => {
    const run = replay([
      project("shared"),
      highlight("shared"),
      highlight("shared", "const xy"),
      { type: "project.disposed", key: "shared" },
    ])

    const lane = ready(run.state).highlightLanes.get("shared")

    ;[
      reply({ type: "error", id: 1, key: "shared", message: "late" }),
      reply({ type: "superseded", id: 1, key: "shared" }),
    ].forEach((event) => {
      const next = transitionMarkdownWorker(run.state, event)
      expect(next.state).toBe(run.state)
      expect(next.effects).toBe(EMPTY_WORKER_EFFECTS)
    })
    expect(lane).toEqual({ active: 2, queued: 3 })
  })
})

describe("coalescing lanes", () => {
  test.each(["project", "highlight"] as const)(
    "%s posts one request and keeps only the newest queued snapshot per key",
    (kind) => {
      const request = kind === "project" ? project : highlight
      const run = replay([request("code", "1"), request("code", "2"), request("code", "3")])

      expect(posted(run.effects)).toEqual([1])
      expect(rejected(run.effects, "superseded")).toEqual([2])
      expect(ready(run.state)[kind === "project" ? "projectLanes" : "highlightLanes"].get("code")).toEqual({
        active: 1,
        queued: 3,
      })

      const response = kind === "project" ? projected(1, "code", 0, [block("1")]) : highlighted(1, "code")

      expect(posted(transitionMarkdownWorker(run.state, reply(response)).effects.slice())).toEqual([3])
    },
  )

  test("ignores a disposed request's reply after the key is reused", () => {
    const run = replay([
      highlight("code", "1"),
      { type: "highlight.disposed", key: "code" },
      highlight("code", "2"),
      highlight("code", "3"),
      reply(highlighted(1, "code")),
    ])

    expect(posted(run.effects)).toEqual([1, 2])
    expect(ready(run.state).highlightLanes.get("code")).toEqual({ active: 2, queued: 3 })
    expect(posted(transitionMarkdownWorker(run.state, reply(highlighted(2, "code"))).effects.slice())).toEqual([3])
  })

  test("disposing a key rejects its requests and tells the worker once", () => {
    const run = replay([highlight("code", "1"), highlight("code", "2"), { type: "highlight.disposed", key: "code" }])

    expect(rejected(run.effects, "disposed")).toEqual([1, 2])
    expect(disposals(run.effects)).toEqual(["code"])
    expect(ready(run.state).highlightLanes.size).toBe(0)
    expect(ready(run.state).requests.size).toBe(0)

    const again = transitionMarkdownWorker(run.state, { type: "highlight.disposed", key: "code" })
    expect(again.state).toBe(run.state)
    expect(again.effects).toBe(EMPTY_WORKER_EFFECTS)
  })
})

describe("parse", () => {
  test("an aborted parse rejects once and ignores the worker's later reply", () => {
    const run = replay([parse(), { type: "parse.aborted", id: 1 }])

    expect(rejected(run.effects, "disposed")).toEqual([1])
    ;[reply({ type: "parse", id: 1, html: "<p>" }), reply({ type: "error", id: 1, message: "late" })].forEach(
      (event) => {
        const next = transitionMarkdownWorker(run.state, event)
        expect(next.state).toBe(run.state)
        expect(next.effects).toBe(EMPTY_WORKER_EFFECTS)
      },
    )
  })
})

describe("hang watchdog", () => {
  test("arms one timer for the first request, not for every delta", () => {
    const run = replay([project("p", "a"), highlight("h"), project("p", "ab"), parse()])

    expect(run.effects.filter((effect) => effect.type === "arm-watchdog")).toEqual([
      { type: "arm-watchdog", attempt: 1, delay: WORKER_HANG_TIMEOUT_MS },
    ])
    expect(ready(run.state).watched).toBe(1)
  })

  test("disarms when nothing is in flight", () => {
    const run = replay([parse(), reply({ type: "parse", id: 1, html: "" }), { type: "watchdog.fired", attempt: 1 }])

    expect(ready(run.state).watched).toBeUndefined()
    expect(run.effects.filter((effect) => effect.type === "arm-watchdog")).toHaveLength(1)
    expect(posted(replay([parse()], run.state).effects)).toEqual([2])
    expect(replay([parse()], run.state).effects.some((effect) => effect.type === "arm-watchdog")).toBe(true)
  })

  test("re-arms once when the oldest request has moved on", () => {
    const run = replay([
      parse(),
      parse(),
      reply({ type: "parse", id: 1, html: "" }),
      { type: "watchdog.fired", attempt: 1 },
    ])

    expect(ready(run.state).watched).toBe(2)
    expect(run.effects.filter((effect) => effect.type === "arm-watchdog")).toHaveLength(2)
  })

  test("fails a worker whose oldest request made no progress across a window", () => {
    // The old code waited forever here, so the block never became ready.
    const run = replay([parse(), highlight("h"), { type: "watchdog.fired", attempt: 1 }])

    expect(run.state.status).toBe("failed")
    expect(run.effects.slice(-3)).toEqual([
      { type: "close-worker", attempt: 1 },
      { type: "reject", ids: [1, 2], reason: { kind: "error", message: "Markdown worker timed out" } },
      { type: "schedule-retry", attempt: 1, delay: WORKER_RETRY_DELAY_MS },
    ])
  })
})
