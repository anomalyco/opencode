import { expect, test } from "bun:test"
import { Tool } from "@opencode-ai/core/tool"
import { execute } from "@opencode-ai/core/tool/runtime"
import { Agent } from "@opencode-ai/schema/agent"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import type { Info } from "@opencode-ai/schema/tool"
import { Effect, Schema } from "effect"

const context = {
  sessionID: Session.ID.make("ses_null"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_null"),
  id: Tool.CallID.make("call_null"),
  progress: () => Effect.void,
}

// The JSON Schema advertised for these tools renders optional fields as `X | null`
// (JSON cannot express undefined), so callers legitimately send null to mean
// "omitted". The runtime must accept that without weakening schemas that
// genuinely distinguish null.
const collect = (input: Info["input"]) => {
  let received: unknown
  const tool: Info = {
    name: "probe",
    description: "Probe",
    input,
    execute: (value) => {
      received = value
      return Effect.succeed({ content: "ok" })
    },
  }
  return {
    tool,
    run: (value: unknown) => Effect.runPromise(execute(tool, value, context)).then(() => received),
    fail: (value: unknown) => Effect.runPromiseExit(execute(tool, value, context)).then((exit) => exit.toString()),
  }
}

test("null optional properties decode as omitted", async () => {
  const probe = collect(
    Schema.Struct({
      title: Schema.String,
      agent: Schema.optional(Schema.String),
    }),
  )
  expect(await probe.run({ title: "probe", agent: null })).toEqual({ title: "probe" })
})

test("nested null optional properties decode as omitted", async () => {
  const probe = collect(
    Schema.Struct({
      worktree: Schema.optional(
        Schema.Struct({
          branch: Schema.String,
          base: Schema.optional(Schema.String),
        }),
      ),
    }),
  )
  expect(await probe.run({ worktree: { branch: "main", base: null } })).toEqual({ worktree: { branch: "main" } })
})

test("schemas that accept null keep it", async () => {
  const probe = collect(Schema.Struct({ next: Schema.NullOr(Schema.String) }))
  expect(await probe.run({ next: null })).toEqual({ next: null })
})

test("null array elements survive the retry", async () => {
  const probe = collect(
    Schema.Struct({
      tags: Schema.Array(Schema.NullOr(Schema.String)),
      agent: Schema.optional(Schema.String),
    }),
  )
  expect(await probe.run({ tags: ["a", null], agent: null })).toEqual({ tags: ["a", null] })
})

test("unfixable nulls report the original error", async () => {
  const probe = collect(Schema.Struct({ title: Schema.String }))
  const message = await probe.fail({ title: null })
  expect(message).toContain("Invalid tool input")
  expect(message).toContain("Expected string")
})

test("standard schema inputs get the same retry", async () => {
  const attempts: Array<unknown> = []
  const input = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => {
        attempts.push(value)
        const record = value as Record<string, unknown>
        if ("agent" in record && record.agent === null) return { issues: [{ message: "Expected string | undefined" }] }
        return { value }
      },
      jsonSchema: {
        input: () => ({ type: "object" }),
        output: () => ({ type: "object" }),
      },
    },
  } as unknown as Info["input"]
  const probe = collect(input)
  expect(await probe.run({ title: "probe", agent: null })).toEqual({ title: "probe" })
  expect(attempts).toEqual([
    { title: "probe", agent: null },
    { title: "probe" },
  ])
})
