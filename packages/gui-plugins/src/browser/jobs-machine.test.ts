import { expect, test } from "bun:test"
import {
  importedCookies,
  importLoss,
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

test("a partial import counts only failed or protected rows and ignores skipped expired or partitioned leftovers", () => {
  const result = imported.result
  expect(importLoss({ ...result, protected: 0 })).toBeUndefined()
  expect(importLoss({ ...result, protected: 0, skipped: 318 })).toBeUndefined()
  expect(importLoss(result)).toEqual({ reason: "protected", count: 1 })
  expect(importLoss({ ...result, skipped: 318 })).toEqual({ reason: "protected", count: 1 })
  expect(importLoss({ ...result, protected: 0, failed: 1 })).toEqual({ reason: "other", count: 1 })
  expect(importLoss({ ...result, skipped: 2, failed: 3 })).toEqual({ reason: "other", count: 4 })
})

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
    // A second click while the import runs starts nothing, and asks nothing.
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
    { type: "started", job: edge },
    { type: "failed", attempt: 1 },
  ])

  // The profile may have changed in main anyway, so the surface hears about the job either way.
  expect(result.effects.slice(1, 3)).toEqual([
    { type: "abort", attempt: 1 },
    { type: "notify", finished: { job: store, outcome: { type: "error" } } },
  ])
  expect(runningJob(result.state)).toEqual(edge)
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
    { type: "started", job: edge },
    { type: "disposed" },
    { type: "finished", attempt: 1, outcome: imported },
    { type: "started", job: edge },
  ])

  expect(result.effects).toEqual([
    { type: "run", attempt: 1, job: edge, timeoutMs: 300_000 },
    { type: "abort", attempt: 1 },
  ])
  expect(result.state).toEqual({ status: "disposed" })
})

// Clearing the browsing data cannot be undone, so the person is asked first. The pane's driver answers "no" for
// Cancel, Escape, a click outside and a question that closed with its surface, so each of those is `confirmed: false`.
const clear: Job = { type: "clear" }

const cleared = { type: "cleared" as const, history: true }

const ran: JobsEffect = { type: "run", attempt: 1, job: clear, timeoutMs: 60_000 }

const asked: JobsEffect = { type: "confirm", attempt: 1, job: clear }

test("clearing asks first: nothing runs until the person confirms, and a no leaves the surface as it was", () => {
  const before = replay([{ type: "started", job: edge }, { type: "finished", attempt: 1, outcome: imported }])
  const open = transitionJobs(before.state, { type: "started", job: clear })

  // Only the question: no call to main. The last result stays on the surface behind it.
  expect(open.effects).toEqual([{ type: "confirm", attempt: 2, job: clear }])
  expect(runningJob(open.state)).toBeUndefined()
  expect(lastFinished(open.state)).toEqual({ job: edge, outcome: imported })

  // Cancel, Escape or a click outside: nothing ran, and the surface is as before the question.
  const declined = transitionJobs(open.state, { type: "answered", attempt: 2, confirmed: false })
  expect(declined.effects).toEqual([])
  expect(declined.state).toEqual({ status: "idle", attempt: 2, last: { job: edge, outcome: imported } })

  // Asked again and confirmed, it runs once, under the attempt its question claimed.
  const again = transitionJobs(declined.state, { type: "started", job: clear })
  const confirmed = transitionJobs(again.state, { type: "answered", attempt: 3, confirmed: true })
  expect(confirmed.effects).toEqual([{ type: "run", attempt: 3, job: clear, timeoutMs: 60_000 }])
  expect(runningJob(confirmed.state)).toEqual(clear)
})

test("a confirmed clear runs once, however often the button or the answer is pressed", () => {
  const result = replay([
    { type: "started", job: clear },
    // The red button again, and another job, while the question is open: neither starts anything.
    { type: "started", job: clear },
    { type: "started", job: edge },
    { type: "answered", attempt: 1, confirmed: true },
    // A second press of the dialog's button, and a late no, change nothing.
    { type: "answered", attempt: 1, confirmed: true },
    { type: "answered", attempt: 1, confirmed: false },
    { type: "finished", attempt: 1, outcome: cleared },
  ])

  expect(result.effects).toEqual([asked, ran, { type: "abort", attempt: 1 }, { type: "notify", finished: { job: clear, outcome: cleared } }])
  expect(lastFinished(result.state)).toEqual({ job: clear, outcome: cleared })
})

test("an answer to an earlier question, or after the surface went, clears nothing", () => {
  const stale = replay([
    { type: "started", job: clear },
    { type: "answered", attempt: 1, confirmed: false },
    { type: "started", job: clear },
    // The first question's yes arrives late: the open question is the second.
    { type: "answered", attempt: 1, confirmed: true },
  ])

  expect(stale.effects).toEqual([asked, { type: "confirm", attempt: 2, job: clear }])
  expect(stale.state).toMatchObject({ status: "confirming", attempt: 2 })

  // The surface goes while the question is open: no call was made, so there is none to abort, and a yes runs nothing.
  const gone = replay([{ type: "started", job: clear }, { type: "disposed" }, { type: "answered", attempt: 1, confirmed: true }])
  expect(gone.effects).toEqual([asked])
  expect(gone.state).toEqual({ status: "disposed" })
})

test("a confirmed clear that fails or times out ends in an error the surface says", () => {
  for (const failure of [{ type: "failed" as const, attempt: 1 }, { type: "timed-out" as const, attempt: 1 }]) {
    const result = replay([{ type: "started", job: clear }, { type: "answered", attempt: 1, confirmed: true }, failure])

    expect(result.effects).toEqual([asked, ran, { type: "abort", attempt: 1 }, { type: "notify", finished: { job: clear, outcome: { type: "error" } } }])
    expect(lastFinished(result.state)).toEqual({ job: clear, outcome: { type: "error" } })
  }
})
