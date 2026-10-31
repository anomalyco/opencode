import { describe, expect } from "bun:test"
import { Clock, DateTime, Effect, Exit } from "effect"
import { TestClock } from "effect/testing"
import {
  harness,
  ownerPending,
  ownerSessionID as sessionID,
  scheduleIt as it,
  setupScheduleHarness as setup,
} from "./fixture/schedule-harness"

const settle = Effect.repeat(Effect.yieldNow, { times: 5 })

describe("Schedule Run History and Inbox", () => {
  it.effect("delivers inbox-only runs without waking chat, orders needs_you first, and adapts cadence via schedule_result", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()

      const outside = yield* Effect.exit(schedules.reportResult(sessionID, { attention: "quiet" }))
      expect(Exit.isFailure(outside)).toBe(true)

      const monitor = yield* schedules.create({
        sessionID,
        name: "Deploy monitor",
        when: { type: "every", every: "30 minutes" },
        action: {
          type: "subagent",
          prompt: "Check deploy health",
          deliver: "inbox",
        },
      })

      harness.resumeReply = (childID) =>
        schedules
          .reportResult(childID, { attention: "quiet" })
          .pipe(Effect.orDie, Effect.as("Checked 14 pods; all green, nothing to report."))
      yield* TestClock.adjust("30 minutes")
      yield* schedules.tick
      yield* settle
      expect(yield* ownerPending).toEqual([])
      expect(yield* schedules.inbox({ sessionID })).toEqual([])

      harness.resumeReply = () => Effect.succeed("Canary finished cleanly at 100%.")
      yield* TestClock.adjust("30 minutes")
      yield* schedules.tick
      yield* settle
      expect(yield* ownerPending).toEqual([])
      expect(yield* schedules.inbox({ sessionID })).toMatchObject([
        { run: 2, attention: "ready", summary: "Canary finished cleanly at 100%." },
      ])

      harness.resumeReply = (childID) =>
        schedules
          .reportResult(childID, {
            attention: "needs_you",
            summary: "Migration needs production sign-off",
            nextIn: "2 minutes",
          })
          .pipe(Effect.orDie, Effect.as("Blocked on migration approval."))
      yield* TestClock.adjust("30 minutes")
      yield* schedules.tick
      yield* settle
      expect(yield* ownerPending).toEqual([])

      const afterAdaptive = yield* schedules.get(monitor.id)
      const nowMs = yield* Clock.currentTimeMillis
      expect(DateTime.toEpochMillis(afterAdaptive.nextDueAt!)).toBe(nowMs + 2 * 60_000)

      const inbox = yield* schedules.inbox({ sessionID })
      expect(inbox.map((item) => ({ run: item.run, attention: item.attention, summary: item.summary }))).toEqual([
        { run: 3, attention: "needs_you", summary: "Migration needs production sign-off" },
        { run: 2, attention: "ready", summary: "Canary finished cleanly at 100%." },
      ])

      const readRun = yield* schedules.markRead(inbox[0]!.id)
      expect(readRun.readAt).toBeDefined()
      expect((yield* schedules.inbox({ sessionID })).map((item) => item.run)).toEqual([2])
      expect((yield* schedules.inbox({ sessionID, includeRead: true })).map((item) => item.run)).toEqual([3, 2])
      expect((yield* schedules.runs({ scheduleID: monitor.id })).map((item) => item.run)).toEqual([3, 2, 1])
    }),
  )

  it.effect("surfaces silent schedules in the Inbox when auto-paused after 3 consecutive failures", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()

      const silent = yield* schedules.create({
        sessionID,
        name: "Nightly backup",
        when: { type: "every", every: "5 minutes" },
        action: { type: "shell", run: "bun run backup", deliver: "silent" },
      })
      harness.shellState.exitCode = 1
      harness.shellState.stderr = "disk full"

      for (const strike of [1, 2]) {
        yield* TestClock.adjust("5 minutes")
        yield* schedules.tick
        yield* settle
        expect(yield* schedules.inbox({ sessionID })).toEqual([])
        expect((yield* schedules.runs({ scheduleID: silent.id }))[0]).toMatchObject({
          run: strike,
          status: "failed",
          attention: "quiet",
        })
      }

      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      yield* settle
      expect((yield* schedules.get(silent.id)).status).toBe("paused")
      expect(yield* schedules.inbox({ sessionID })).toMatchObject([
        {
          scheduleID: silent.id,
          run: 3,
          status: "failed",
          attention: "needs_you",
          summary: expect.stringContaining("[Paused after repeated failures]"),
        },
      ])
    }),
  )
})
