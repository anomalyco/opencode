import { describe, expect, test } from "bun:test"
import type { ExperimentalMigrationV1StatusOutput } from "@opencode/client/promise"
import {
  createMigrationState,
  selectMigrationProgress,
  selectMigrationToastVisible,
  transitionMigration,
  type MigrationEvent,
  type MigrationState,
} from "./migration-status-machine"

const progress = { label: "Migrating sessions", numerator: 3, denominator: 10 }

const running: ExperimentalMigrationV1StatusOutput = { status: "running", progress }

// Polls once: the due wait, then the request's answer for the attempt it started.
function poll(state: MigrationState, answer: (attempt: number) => MigrationEvent) {
  if (state.status !== "waiting") throw new Error(`expected waiting, got ${state.status}`)
  const polling = transitionMigration(state, { type: "poll.due", attempt: state.attempt }).state

  if (polling.status !== "polling") throw new Error(`expected polling, got ${polling.status}`)

  return transitionMigration(polling, answer(polling.attempt))
}

describe("migration status poll", () => {
  test("keeps the running toast and retries with backoff after a transport failure", () => {
    const first = poll(createMigrationState().state, (attempt) => ({
      type: "poll.succeeded",
      attempt,
      output: running,
    }))

    expect(selectMigrationToastVisible(first.state)).toBe(true)

    // On dev a single `Failed to fetch` stopped polling and showed "migration failed" while it was still running.
    const delays = [1, 2, 3, 4, 5, 6, 7].reduce<{ state: MigrationState; delays: number[] }>(
      (result) => {
        const next = poll(result.state, (attempt) => ({ type: "poll.failed", attempt }))
        const wait = next.effects.find((effect) => effect.type === "start-wait")

        expect(next.effects.some((effect) => effect.type === "show-error")).toBe(false)
        expect(selectMigrationProgress(next.state)).toEqual(progress)

        return { state: next.state, delays: [...result.delays, wait?.delayMs ?? 0] }
      },
      { state: first.state, delays: [] },
    )

    expect(delays.delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 32_000])

    const recovered = poll(delays.state, (attempt) => ({
      type: "poll.succeeded",
      attempt,
      output: { status: "required" },
    }))

    expect(recovered.effects).toContainEqual({ type: "start-wait", attempt: expect.any(Number), delayMs: 1_000 })
    expect(selectMigrationToastVisible(recovered.state)).toBe(false)

    const done = poll(recovered.state, (attempt) => ({
      type: "poll.succeeded",
      attempt,
      output: { status: "completed" },
    }))

    expect(done.state).toEqual({ status: "completed" })
    expect(done.effects).toEqual([{ type: "cancel-timer" }])
  })

  test("reports a migration error answer and stops", () => {
    const failed = poll(createMigrationState().state, (attempt) => ({
      type: "poll.succeeded",
      attempt,
      output: { status: "error", error: "corrupt db" },
    }))

    expect(failed.state).toEqual({ status: "failed", error: "corrupt db" })
    expect(failed.effects).toEqual([{ type: "cancel-timer" }, { type: "show-error", error: "corrupt db" }])
    expect(selectMigrationToastVisible(failed.state)).toBe(false)
  })

  test("aborts a hung request and ignores its late answer", () => {
    const start = createMigrationState().state
    const polling = transitionMigration(start, { type: "poll.due", attempt: 1 }).state
    const timedOut = transitionMigration(polling, { type: "poll.timed-out", attempt: 2 })

    expect(timedOut.effects).toEqual([{ type: "abort-poll" }, { type: "start-wait", attempt: 3, delayMs: 1_000 }])
    expect(transitionMigration(timedOut.state, { type: "poll.failed", attempt: 2 }).state).toBe(timedOut.state)
    expect(
      transitionMigration(timedOut.state, { type: "poll.succeeded", attempt: 2, output: { status: "completed" } })
        .state,
    ).toBe(timedOut.state)
  })

  test("ignores stale timers and cancels work when disposed", () => {
    const start = createMigrationState().state

    expect(transitionMigration(start, { type: "poll.due", attempt: 7 }).state).toBe(start)

    const polling = transitionMigration(start, { type: "poll.due", attempt: 1 }).state

    expect(transitionMigration(polling, { type: "disposed" })).toEqual({
      state: { status: "disposed" },
      effects: [{ type: "cancel-timer" }, { type: "abort-poll" }],
    })
    expect(transitionMigration(start, { type: "disposed" }).effects).toEqual([{ type: "cancel-timer" }])
  })
})
