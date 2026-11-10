import { expect, test } from "bun:test"
import {
  importedCookies,
  initialJobsState,
  lastFinished,
  runningJob,
  transitionJobs,
  type Job,
  type JobsEffect,
  type JobsEvent,
} from "./jobs-machine"

const edge: Job = { type: "import-browser", source: "edge", profile: "Default" }

const imported = {
  type: "imported" as const,
  result: { type: "imported" as const, imported: 3, skipped: 0, protected: 1, failed: 0 },
}

function replay(events: readonly JobsEvent[]) {
  return events.reduce(
    (result, event) => {
      const next = transitionJobs(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: initialJobsState, effects: new Array<JobsEffect>() },
  )
}

test("runs one job at a time and reports the outcome with the job that ran", () => {
  const result = replay([
    { type: "started", job: edge },
    // A second click while the import runs starts nothing.
    { type: "started", job: { type: "clear" } },
    { type: "finished", attempt: 1, outcome: imported },
  ])

  expect(result.effects).toEqual([
    { type: "run", attempt: 1, job: edge, timeoutMs: 300_000 },
    { type: "abort", attempt: 1 },
    { type: "notify", finished: { job: edge, outcome: imported } },
  ])
  expect(lastFinished(result.state)).toEqual({ job: edge, outcome: imported })
  expect(runningJob(result.state)).toBeUndefined()
  expect(importedCookies(imported)).toBe(3)
  expect(importedCookies({ type: "imported", result: { type: "failed", reason: "locked" } })).toBe(0)
})

test("a timed-out job ends in an error, and its late reply changes nothing", () => {
  const store: Job = { type: "install-store", url: "https://chromewebstore.google.com/detail/x" }

  const result = replay([
    { type: "started", job: store },
    { type: "timed-out", attempt: 1 },
    { type: "finished", attempt: 1, outcome: imported },
    { type: "started", job: { type: "clear" } },
    { type: "failed", attempt: 1 },
  ])

  // The profile may have changed in main anyway, so the surface hears about the job either way.
  expect(result.effects.slice(1, 3)).toEqual([
    { type: "abort", attempt: 1 },
    { type: "notify", finished: { job: store, outcome: { type: "error" } } },
  ])
  expect(runningJob(result.state)).toEqual({ type: "clear" })
})

test("dismissing clears the last outcome only while nothing runs", () => {
  const done = replay([
    { type: "started", job: edge },
    { type: "finished", attempt: 1, outcome: imported },
    { type: "dismissed" },
  ])

  expect(lastFinished(done.state)).toBeUndefined()

  const busy = replay([{ type: "started", job: edge }, { type: "dismissed" }])

  expect(runningJob(busy.state)).toEqual(edge)
})

test("leaving the surface aborts the running job, and nothing runs after", () => {
  const result = replay([
    { type: "started", job: { type: "clear" } },
    { type: "disposed" },
    { type: "finished", attempt: 1, outcome: { type: "cleared" } },
    { type: "started", job: { type: "clear" } },
  ])

  expect(result.effects).toEqual([
    { type: "run", attempt: 1, job: { type: "clear" }, timeoutMs: 60_000 },
    { type: "abort", attempt: 1 },
  ])
  expect(result.state).toEqual({ status: "disposed" })
})
