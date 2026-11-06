import { describe, expect, test } from "bun:test"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import type { Info } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { z } from "zod"

// What the catalog lists for one tool's input, through the same path as registered tools.
const listed = (input: Info["input"]) => {
  const tool: Info = { name: "probe", description: "Probe", input, execute: () => Effect.die("unused") }
  const entry = CodeModeTool.catalog({ tools: new Map([["probe", tool]]) }).tools[0]
  return entry?.type === "tool" ? entry.parameters : undefined
}

describe("catalog parameters", () => {
  test("lists required names, then … for optional ones, from a raw JSON Schema object", () => {
    expect(
      listed({
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, page: { type: "number" } },
        required: ["owner", "repo"],
      }),
    ).toEqual(["owner", "repo", "…"])
    expect(listed({ type: "object", properties: {} })).toEqual([])
    expect(listed({ type: "object" })).toEqual([])
  })

  test("reads Effect and zod objects, including an Effect struct named by an identifier", () => {
    expect(listed(Schema.Struct({ id: Schema.String, note: Schema.optionalKey(Schema.String) }))).toEqual(["id", "…"])
    expect(listed(Schema.Struct({ id: Schema.String }).annotate({ identifier: "Lookup" }))).toEqual(["id"])
    expect(listed(z.object({ query: z.string(), limit: z.number().default(10) }))).toEqual(["query", "…"])
  })

  test("leaves inputs that are not plain objects unsummarized rather than claiming they take nothing", () => {
    expect(
      listed(Schema.Union([Schema.Struct({ a: Schema.String }), Schema.Struct({ b: Schema.String })])),
    ).toBeUndefined()
    expect(listed(Schema.Record(Schema.String, Schema.String))).toBeUndefined()
    expect(
      listed(z.discriminatedUnion("kind", [z.object({ kind: z.literal("a") }), z.object({ kind: z.literal("b") })])),
    ).toBeUndefined()
    expect(listed({ anyOf: [{ type: "object", properties: { a: { type: "string" } } }] })).toBeUndefined()
  })
})
