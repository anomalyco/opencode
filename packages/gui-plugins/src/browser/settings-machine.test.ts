import { expect, test } from "bun:test"
import {
  initialSettingsState,
  lastOutcome,
  runningJob,
  transitionSettings,
  type SettingsEffect,
  type SettingsEvent,
} from "./settings-machine"

const imported = {
  type: "imported" as const,
  result: { type: "imported" as const, imported: 3, skipped: 0, protected: 1, failed: 0 },
}

function replay(events: readonly SettingsEvent[]) {
  return events.reduce(
    (result, event) => {
      const next = transitionSettings(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: initialSettingsState, effects: new Array<SettingsEffect>() },
  )
}

test("runs one job at a time and reports the outcome of the job that ran", () => {
  const result = replay([
    { type: "started", job: { type: "import-browser", source: "edge", profile: "Default" } },
    // A second click while the import runs starts nothing.
    { type: "started", job: { type: "clear" } },
    { type: "finished", attempt: 1, outcome: imported },
  ])

  expect(result.effects).toEqual([
    {
      type: "run",
      attempt: 1,
      job: { type: "import-browser", source: "edge", profile: "Default" },
      timeoutMs: 300_000,
    },
    { type: "abort", attempt: 1 },
    { type: "refresh" },
  ])
  expect(lastOutcome(result.state)).toEqual(imported)
  expect(runningJob(result.state)).toBeUndefined()
})

test("a timed-out job ends in an error, and its late reply changes nothing", () => {
  const result = replay([
    { type: "started", job: { type: "install-store", url: "https://chromewebstore.google.com/detail/x" } },
    { type: "timed-out", attempt: 1 },
    { type: "finished", attempt: 1, outcome: imported },
    { type: "started", job: { type: "clear" } },
    { type: "failed", attempt: 1 },
  ])

  // The profile may have changed in main anyway, so the page reads it again.
  expect(result.effects.slice(1, 3)).toEqual([{ type: "abort", attempt: 1 }, { type: "refresh" }])
  expect(runningJob(result.state)).toEqual({ type: "clear" })
  expect(
    replay([
      { type: "started", job: { type: "clear" } },
      { type: "timed-out", attempt: 1 },
    ]).state,
  ).toEqual({
    status: "idle",
    attempt: 1,
    outcome: { type: "error" },
  })
})

test("leaving the page aborts the running job, and nothing runs after", () => {
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
