import { describe, expect, test } from "bun:test"
import { CodeMode } from "@opencode/codemode"
import { CodeModeAgents } from "@opencode/core/codemode/agents"
import { CodeModeExecution } from "@opencode/core/codemode/execution"
import { Agent } from "@opencode/core/agent"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSchema } from "@opencode/core/session/schema"
import { CallID } from "@opencode/schema/tool"
import { Effect, Result } from "effect"

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
        signal: new AbortController().signal,
      }),
    ),
  )

// A schema built by a script with `z`, as agent() and llm() receive it.
const built = async (code: string) => {
  const result = await execute(`return ${code}`)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const output = (schema: unknown) => {
  const result = CodeModeAgents.output(schema)
  if (Result.isFailure(result)) throw new Error(result.failure)
  return result.success
}

describe("z", () => {
  test("builds JSON Schema with required keys from what is not optional", async () => {
    const schema = await built(
      `z.object({ title: z.string().describe("Short title"), line: z.integer({ minimum: 1 }).optional(), severity: z.enum(["low", "high"]), tags: z.array(z.string(), { maxItems: 3 }), owner: z.string().nullable() })`,
    )
    expect(output(schema).json).toEqual({
      type: "object",
      properties: {
        title: { type: "string", description: "Short title" },
        line: { type: "integer", minimum: 1 },
        severity: { enum: ["low", "high"] },
        tags: { type: "array", items: { type: "string" }, maxItems: 3 },
        owner: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["title", "severity", "tags", "owner"],
      additionalProperties: false,
    })
  })

  test("common zod refinements map to JSON Schema keywords", async () => {
    const schema = await built(
      `z.object({ name: z.string().min(1).max(40), id: z.string().uuid(), site: z.string().url().optional(), code: z.string().regex(/^[A-Z]{3}$/), count: z.number().int().nonnegative(), score: z.number().positive().max(1), tags: z.array(z.string()).nonempty(), pair: z.array(z.number()).length(2), note: z.string().nullish() })`,
    )
    const json = output(schema).json
    expect(json.properties).toEqual({
      name: { type: "string", minLength: 1, maxLength: 40 },
      id: { type: "string", format: "uuid" },
      site: { type: "string", format: "uri" },
      code: { type: "string", pattern: "^[A-Z]{3}$" },
      count: { type: "integer", minimum: 0 },
      score: { type: "number", exclusiveMinimum: 0, maximum: 1 },
      tags: { type: "array", items: { type: "string" }, minItems: 1 },
      pair: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      note: { anyOf: [{ type: "string" }, { type: "null" }] },
    })
    expect(json.required).toEqual(["name", "id", "code", "count", "score", "tags", "pair"])
    expect(
      Result.isFailure(
        CodeModeAgents.check(output(schema), {
          name: "",
          id: "x",
          code: "abc",
          count: -1,
          score: 2,
          tags: [],
          pair: [1],
        }),
      ),
    ).toBe(true)
  })

  test("a non-object root is wrapped for the model and unwrapped for the script", async () => {
    const schema = output(await built(`z.array(z.object({ file: z.string() }))`))
    expect(schema.wrapped).toBe(true)
    expect(schema.json.required).toEqual(["value"])
    expect(CodeModeAgents.check(schema, { value: [{ file: "a.ts" }] })).toEqual(Result.succeed([{ file: "a.ts" }]))
  })
})

describe("check", () => {
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
      "valid options: agent, model, label, schema, retries",
    )
    expect(await failure(`await llm("x", { schema: "string" })`)).toContain("schema must be an object")
  })
})
