import { expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { Schedule } from "../src/schedule.js"

const decodeAction = Schema.decodeUnknownSync(Schedule.Action)
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
