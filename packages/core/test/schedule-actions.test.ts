import { describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "@opencode/core/agent"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import {
  harness,
  ownerPending,
  ownerSessionID as sessionID,
  promoteOwner,
  scheduleIt as it,
  setupScheduleHarness as setup,
} from "./fixture/schedule-harness"

const settle = Effect.repeat(Effect.yieldNow, { times: 5 })

describe("Schedule background actions", () => {
  it.effect("runs subagent prompts in an isolated child session, auto-archives NO_REPLY runs, and honors notify", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const sessions = yield* Session.Service
      yield* sessions.setMetadata({ sessionID, metadata: { projectScope: { id: sessionID, since: 0 } } })

      const schedule = yield* schedules.create({
        sessionID,
        name: "Triage",
        when: { type: "every", every: "5 minutes" },
        action: {
          type: "prompt",
          prompt: "Check regressions",
          target: { type: "subagent", agent: "reviewer" },
        },
      })

      harness.resumeReply = () => Effect.succeed("NO_REPLY")
      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      yield* settle
      expect(yield* ownerPending).toEqual([])
      expect(yield* schedules.get(schedule.id)).toMatchObject({
        runCount: 1,
        activeJobID: undefined,
        lastOutcome: "fired",
      })

      harness.resumeReply = () => Effect.succeed("PR #42 broke main.")
      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      yield* settle
      const pending = yield* ownerPending
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        type: "synthetic",
        delivery: "queue",
        payload: {
          description: "Triage · #2",
          text: expect.stringContaining("PR #42 broke main."),
        },
      })
      yield* promoteOwner

      const children = (yield* sessions.list({ parentID: sessionID })).data
      const unarchived = (yield* sessions.list({ parentID: sessionID, archived: false })).data
      expect(children).toHaveLength(2)
      expect(unarchived.map((child) => child.id)).toEqual([Session.ID.make(`ses_${schedule.id}_2`)])
      expect(children[0]?.agent).toBe(Agent.ID.make("reviewer"))
      expect(children[0]?.metadata).toMatchObject({ projectScope: { id: sessionID, since: 0 } })

      yield* schedules.pause(schedule.id)
      const quietParent = yield* schedules.create({
        sessionID,
        name: "Silent sweep",
        when: { type: "in", in: "5 minutes" },
        action: {
          type: "prompt",
          prompt: "Write summary in child session only",
          target: { type: "subagent", notify: false },
        },
      })
      harness.resumeReply = () => Effect.succeed("Summary ready in child session.")
      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      yield* settle
      expect(yield* ownerPending).toEqual([])
      expect(yield* schedules.get(quietParent.id)).toMatchObject({ status: "done", runCount: 1 })
    }),
  )

  it.effect("keeps foreground session non-busy while a background subagent runs and skips overlapping slots", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const exec = yield* SessionExecution.Service
      const gate = yield* Deferred.make<string>()
      harness.resumeReply = () => Deferred.await(gate)

      const schedule = yield* schedules.create({
        sessionID,
        name: "Slow sweep",
        when: { type: "every", every: "1 minute" },
        action: { type: "prompt", prompt: "Audit slow tests", target: { type: "subagent" } },
      })

      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(yield* exec.isActive(sessionID)).toBe(false)
      expect(yield* schedules.get(schedule.id)).toMatchObject({
        runCount: 1,
        activeJobID: `job_${schedule.id}_1`,
      })

      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      expect(yield* schedules.get(schedule.id)).toMatchObject({
        runCount: 1,
        lastOutcome: "skipped",
        activeJobID: `job_${schedule.id}_1`,
      })

      yield* Deferred.succeed(gate, "Sweep complete.")
      yield* settle
      expect(yield* schedules.get(schedule.id)).toMatchObject({
        runCount: 1,
        activeJobID: undefined,
      })
      expect(yield* ownerPending).toHaveLength(1)

      harness.resumeReply = () => Effect.succeed("Sweep #2 complete.")
      yield* TestClock.adjust("1 minute")
      yield* schedules.tick
      yield* settle
      expect(yield* schedules.get(schedule.id)).toMatchObject({
        runCount: 2,
        lastOutcome: "fired",
        activeJobID: undefined,
      })
      expect(yield* ownerPending).toHaveLength(2)
    }),
  )

  it.effect("runs slash commands in this session by default or in a background subagent when target is subagent", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()
      const sessions = yield* Session.Service

      yield* schedules.create({
        sessionID,
        name: "Local brief",
        when: { type: "in", in: "5 minutes" },
        action: { type: "command", name: "/morning-brief", arguments: "local" },
      })
      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      const samePending = yield* ownerPending
      expect(samePending).toHaveLength(1)
      expect(samePending[0]).toMatchObject({
        type: "user",
        payload: { text: "Brief for: local" },
      })
      yield* promoteOwner

      let childPrompt = ""
      harness.resumeReply = (id) =>
        sessions.messages({ sessionID: id }).pipe(
          Effect.orDie,
          Effect.map((msgs) => {
            const first = msgs.find((m) => m.type === "user")
            childPrompt = first?.type === "user" ? first.text : ""
            return "Morning brief ready: 3 items."
          }),
        )

      yield* schedules.create({
        sessionID,
        name: "Brief",
        when: { type: "in", in: "10 minutes" },
        action: {
          type: "command",
          name: "morning-brief",
          arguments: "today",
          target: { type: "subagent" },
        },
      })

      yield* TestClock.adjust("10 minutes")
      yield* schedules.tick
      yield* settle
      expect(childPrompt).toBe("Brief for: today")

      const pending = yield* ownerPending
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        type: "synthetic",
        delivery: "queue",
        payload: {
          description: "Brief",
          text: expect.stringContaining("Morning brief ready: 3 items."),
        },
      })

      expect(
        yield* Effect.flip(
          schedules.create({
            sessionID,
            when: { type: "in", in: "5 minutes" },
            action: { type: "command", name: "does-not-exist" },
          }),
        ),
      ).toMatchObject({ _tag: "Schedule.InvalidError", reason: "Unknown command: does-not-exist" })

      // Authorizes both the shell-quoted $1 snippet and subagent permission even when target defaults to session.
      harness.agentRules = [
        { action: "shell", resource: "git log*", effect: "allow" },
        { action: "subagent", resource: "reviewer", effect: "deny" },
      ]
      expect(
        yield* Effect.flip(
          schedules.create({
            sessionID,
            when: { type: "in", in: "5 minutes" },
            action: { type: "command", name: "recent-log", arguments: "5" },
          }),
        ),
      ).toMatchObject({ _tag: "Permission.BlockedError" })

      harness.agentRules = [
        { action: "shell", resource: "git log*", effect: "deny" },
        { action: "subagent", resource: "*", effect: "allow" },
      ]
      expect(
        yield* Effect.flip(
          schedules.create({
            sessionID,
            when: { type: "in", in: "5 minutes" },
            action: { type: "command", name: "recent-log", arguments: "5" },
          }),
        ),
      ).toMatchObject({ _tag: "Permission.BlockedError" })

      harness.agentRules = [{ action: "*", resource: "*", effect: "allow" }]
      yield* promoteOwner
      harness.shellState.exitCode = 0
      harness.shellState.stdout = "check-note !`printf INJECTED`\n"
      yield* schedules.create({
        sessionID,
        name: "Checked brief",
        until: { type: "shell", run: "git status --short" },
        action: { type: "command", name: "morning-brief", arguments: "5" },
      })
      const checkedPending = yield* ownerPending
      expect(checkedPending).toHaveLength(1)
      expect(checkedPending[0]).toMatchObject({
        type: "user",
        payload: { text: "Brief for: 5\n\ncheck-note !`printf INJECTED`" },
      })
    }),
  )

  it.effect("runs deterministic shell and code actions with creation-time permissions and auto-pauses after 3 consecutive failures", () =>
    Effect.gen(function* () {
      const schedules = yield* setup()

      harness.agentRules = [
        { action: "shell", resource: "*", effect: "deny" },
        { action: "subagent", resource: "*", effect: "deny" },
      ]
      expect(
        yield* Effect.flip(
          schedules.create({
            sessionID,
            when: { type: "in", in: "5 minutes" },
            action: { type: "prompt", prompt: "subagent check", target: { type: "subagent" } },
          }),
        ),
      ).toMatchObject({ _tag: "Permission.BlockedError" })
      expect(
        yield* Effect.flip(
          schedules.create({
            sessionID,
            when: { type: "in", in: "5 minutes" },
            action: { type: "shell", run: "echo blocked" },
          }),
        ),
      ).toMatchObject({ _tag: "Permission.BlockedError" })

      harness.agentRules = [{ action: "*", resource: "*", effect: "allow" }]
      const shellSchedule = yield* schedules.create({
        sessionID,
        name: "Sync",
        when: { type: "every", every: "5 minutes" },
        action: { type: "shell", run: "git fetch origin" },
      })

      harness.shellState.exitCode = 0
      harness.shellState.stdout = ""
      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      expect(harness.shellState.runs).toEqual(["git fetch origin"])
      expect(yield* ownerPending).toEqual([])

      harness.shellState.stdout = "Fetched 2 branches\n"
      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      yield* settle
      expect(yield* ownerPending).toHaveLength(1)
      yield* promoteOwner
      yield* schedules.pause(shellSchedule.id)

      const failingSilent = yield* schedules.create({
        sessionID,
        name: "Nightly",
        when: { type: "every", every: "5 minutes" },
        action: { type: "shell", run: "bun run broken", notify: false },
      })
      harness.shellState.exitCode = 2
      harness.shellState.stderr = "boom"

      for (const _ of [1, 2]) {
        yield* TestClock.adjust("5 minutes")
        yield* schedules.tick
        yield* settle
        expect(yield* ownerPending).toEqual([])
        expect(yield* schedules.get(failingSilent.id)).toMatchObject({ status: "active", lastOutcome: "failed" })
      }

      yield* TestClock.adjust("5 minutes")
      yield* schedules.tick
      yield* settle
      expect(yield* schedules.get(failingSilent.id)).toMatchObject({ status: "paused", lastOutcome: "failed" })
      const pausedNotice = yield* ownerPending
      expect(pausedNotice).toHaveLength(1)
      expect(pausedNotice[0]?.payload).toMatchObject({
        description: "Nightly · paused",
        text: expect.stringContaining("[Schedule paused after 3 failed runs]"),
      })
      yield* promoteOwner

      harness.shellState.exitCode = 0
      harness.shellState.stdout = "PR #99 merged\n"
      const immediateCode = yield* schedules.create({
        sessionID,
        name: "Notify merge",
        until: { type: "shell", run: "gh pr view 99" },
        action: {
          type: "code",
          code: `await tools.slack.post_digest({ run, message }); return "Posted to Slack"`,
        },
      })
      yield* settle
      expect(immediateCode).toMatchObject({ status: "done", runCount: 1 })
      expect(harness.codeLog).toEqual([{ run: 1, message: "PR #99 merged" }])
      expect(yield* ownerPending).toHaveLength(1)
      expect((yield* schedules.get(shellSchedule.id)).status).toBe("paused")
    }),
  )
})
