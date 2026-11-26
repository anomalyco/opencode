import { expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { Agent } from "../src/agent.js"
import { Automation } from "../src/automation.js"

test("event triggers round-trip producer arguments and omit absent ones", () => {
  const event = { type: "event", server: "ci", event: "build.changed" } as const
  const encode = Schema.encodeSync(Automation.Trigger)
  const decode = Schema.decodeUnknownSync(Automation.Trigger)
  expect(encode({ ...event, args: undefined })).toStrictEqual(event)
  const filtered = { ...event, args: { build: 7 } }
  expect(encode(decode(filtered))).toStrictEqual(filtered)
})

test("code results independently keep JSON state, stop, or hand off one prompt", () => {
  for (const value of [
    null,
    {},
    { state: null },
    { done: true },
    { send: { prompt: "ready" } },
    {
      state: { nested: [1, "two"] },
      done: false,
      send: { prompt: "triage", to: { subagent: Agent.ID.make("reviewer") } },
    },
  ])
    expect(Result.getOrThrow(Automation.decodeCodeResult(value))).toEqual(value)
})

test("code results reject unsupported destinations and malformed sends instead of stripping keys", () => {
  for (const send of [
    null,
    [],
    [{ prompt: "one" }, { prompt: "two" }],
    {},
    { prompt: "" },
    { prompt: " \n " },
    { prompt: "x", session: "ses_other" },
    { prompt: "x", to: {} },
    { prompt: "x", to: { session: "ses_other" } },
    { prompt: "x", to: { subagent: "helper", session: "ses_other" } },
    { prompt: "x", to: { subagent: "" } },
    { prompt: "x", to: { newSession: true } },
  ])
    expect(Result.isFailure(Automation.decodeCodeResult({ state: 1, done: true, send }))).toBe(true)
  expect(Result.isFailure(Automation.decodeCodeResult({ done: "yes", send: { prompt: "x" } }))).toBe(true)
})
