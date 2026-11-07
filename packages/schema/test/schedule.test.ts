import { expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { Schedule } from "../src/schedule.js"
import { SessionID } from "../src/session-id.js"

const decodeAction = Schema.decodeUnknownSync(Schedule.Action)
const decodeRequest = Schema.decodeUnknownSync(Schedule.Request)
const encodeInfo = Schema.encodeSync(Schedule.Info)

test("Schedule.Action accepts a prompt or a shell action", () => {
  expect(decodeAction({ type: "prompt", prompt: "check the build" })).toEqual({
    type: "prompt",
    prompt: "check the build",
  })
  expect(decodeAction({ type: "shell", run: "echo hi", cwd: "sub", timeout: "5 minutes" })).toEqual({
    type: "shell",
    run: "echo hi",
    cwd: "sub",
    timeout: "5 minutes",
  })
  expect(() => decodeAction({ type: "shell" })).toThrow()
})

test("Schedule.RunResult omits an absent exit code and error", () => {
  expect(Schema.encodeSync(Schedule.RunResult)({ durationMs: 3, output: "" })).toEqual({ durationMs: 3, output: "" })
  expect(Schema.encodeSync(Schedule.RunResult)({ exitCode: 0, durationMs: 3, output: "hi" })).toEqual({
    exitCode: 0,
    durationMs: 3,
    output: "hi",
  })
})

test("Schedule.Info round-trips lastRun", () => {
  const info: Schedule.Info = {
    id: Schedule.ID.make("sch_1"),
    when: { type: "in", in: "5 minutes" },
    tz: "UTC",
    action: { type: "shell", run: "echo hi" },
    status: "done",
    runCount: 1,
    lastRun: { exitCode: 0, durationMs: 12, output: "hi\n" },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  }
  expect(encodeInfo(info)).toMatchObject({
    action: { type: "shell", run: "echo hi" },
    lastRun: { exitCode: 0, durationMs: 12, output: "hi\n" },
  })
})

test("Schedule.Request takes exactly one of prompt or run", () => {
  expect(decodeRequest({ when: { in: "5 minutes" }, prompt: "check the build" })).toEqual({
    when: { in: "5 minutes" },
    prompt: "check the build",
  })
  expect(
    decodeRequest({ when: { every: "1 minute" }, run: "echo hi", cwd: "sub", timeout: "5 minutes" }),
  ).toEqual({
    when: { every: "1 minute" },
    run: "echo hi",
    cwd: "sub",
    timeout: "5 minutes",
  })
  expect(() => decodeRequest({ when: { in: "5 minutes" } })).toThrow()
  expect(() => decodeRequest({ when: { in: "5 minutes" }, prompt: "x", run: "echo hi" })).toThrow()
})

test("Schedule.toCreateInput maps run to a shell action and keeps a prompt session-bound", () => {
  const sessionID = SessionID.make("ses_test")
  const shell = Schedule.toCreateInput(undefined, { run: "echo hi", cwd: "sub", timeout: "5 minutes" })
  expect(shell.sessionID).toBeUndefined()
  expect(shell.action).toEqual({ type: "shell", run: "echo hi", cwd: "sub", timeout: "5 minutes" })

  const prompt = Schedule.toCreateInput(sessionID, { prompt: "check the build" })
  expect(prompt.sessionID).toBe(sessionID)
  expect(prompt.action).toEqual({ type: "prompt", prompt: "check the build" })
})
