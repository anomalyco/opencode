import { describe, expect, test } from "bun:test"
import { CodeMode } from "@opencode/codemode"
import { CodeModeAgents } from "@opencode/core/codemode/agents"
import { CodeModeExecution } from "@opencode/core/codemode/execution"
import { Agent } from "@opencode/core/agent"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSchema } from "@opencode/core/session/schema"
import { CallID } from "@opencode/schema/tool"
import { Effect, Result } from "effect"
import { noToolCalls } from "../lib/tool"

const runtime = CodeMode.make({ tools: {}, extensions: [CodeModeAgents.extension] })

// No session: the arguments are checked before agent() or llm() look for one.
const execute = (code: string) =>
  Effect.runPromise(
    runtime.execute(code).pipe(
      Effect.provideService(
        CodeModeAgents.Service,
        CodeModeAgents.Service.of({ register: () => Effect.void, current: Effect.succeed(undefined) }),
      ),
      Effect.provideService(CodeModeExecution.Service, {
        sessionID: SessionSchema.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_test"),
        id: CallID.make("call_test"),
        progress: () => Effect.void,
        tool: noToolCalls,
        signal: new AbortController().signal,
      }),
    ),
  )

const output = (schema: unknown) => {
  const result = CodeModeAgents.output(schema)
  if (Result.isFailure(result)) throw new Error(result.failure)
  return result.success
}

describe("output and check", () => {
  const findings = output({
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: { file: { type: "string" }, severity: { enum: ["low", "high"] } },
          required: ["file", "severity"],
        },
      },
    },
    required: ["findings"],
  })

  test("accepts a matching value", () => {
    const value = { findings: [{ file: "a.ts", severity: "high" }] }
    expect(CodeModeAgents.check(findings, value)).toEqual(Result.succeed(value))
  })

  test("names every path to fix, for the model to correct", () => {
    const result = CodeModeAgents.check(findings, { findings: [{ file: 1, severity: "urgent" }, {}] })
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) return
    expect(result.failure).toContain("findings[0].file")
    expect(result.failure).toContain("findings[0].severity")
    expect(result.failure).toContain("findings[1]")
  })

  test("wraps a non-object root for the model and unwraps it for the script", () => {
    const schema = output({
      type: "array",
      items: { type: "object", properties: { file: { type: "string" } }, required: ["file"] },
    })
    expect(schema.wrapped).toBe(true)
    expect(schema.json.required).toEqual(["value"])
    expect(CodeModeAgents.check(schema, { value: [{ file: "a.ts" }] })).toEqual(Result.succeed([{ file: "a.ts" }]))
  })

  test("keeps pattern in JSON Schema for the model without failing compilation", () => {
    const schema = output({
      type: "object",
      properties: {
        code: { type: "string", pattern: "^[A-Z]{3}$" },
        count: { type: "integer", minimum: 0 },
      },
      required: ["code", "count"],
    })
    expect(CodeModeAgents.check(schema, { code: "ABC", count: 1 })).toEqual(Result.succeed({ code: "ABC", count: 1 }))
    expect(Result.isFailure(CodeModeAgents.check(schema, { code: "ABC", count: -1 }))).toBe(true)
  })

  test("rejects what is not a usable schema before any model call", () => {
    expect(Result.isFailure(CodeModeAgents.output("findings"))).toBe(true)
    expect(Result.isFailure(CodeModeAgents.output([{ type: "string" }]))).toBe(true)
  })
})

describe("agent() and llm() arguments", () => {
  const failure = async (code: string) => {
    const result = await execute(code)
    if (result.ok) throw new Error("expected failure")
    return result.error.message
  }

  test("an empty prompt, unknown option or bad schema fails with what to change", async () => {
    expect(await failure(`await agent("x")`)).toContain("not available in this session")
    expect(await failure(`await agent("")`)).toContain("non-empty prompt")
    expect(await failure(`await agent("x", { shema: {} })`)).toContain(
      "valid options: agent, model, effort, label, schema, retries",
    )
    expect(await failure(`await llm("x", { schema: "string" })`)).toContain("schema must be a JSON Schema object")
    expect(await failure(`await llm("x", { effort: "turbo" })`)).toContain("valid options:")
  })
})
