import { expect, test } from "bun:test"
import type { JSONSchema7 } from "ai"
import { McpCatalog } from "../../src/mcp/catalog"

// Mirrors Slack's official MCP search tools (see #33341): `query` is required,
// the rest are optional string fields. The OpenAI/GPT path fills the omitted
// optionals with "", which Slack treats as an explicit value.
const schema: JSONSchema7 = {
  type: "object",
  properties: {
    query: { type: "string" },
    cursor: { type: "string" },
    after: { type: "string" },
    before: { type: "string" },
    context_channel_id: { type: "string" },
  },
  required: ["query"],
}

const clean = McpCatalog.cleanToolArguments

test("drops empty-string optional string args, keeps required", () => {
  expect(clean({ query: "match", cursor: "" }, schema)).toEqual({ query: "match" })
})

test("drops every omitted optional that the OpenAI path fills as empty string", () => {
  expect(
    clean(
      { query: "match", cursor: "", after: "", before: "", context_channel_id: "" },
      schema,
    ),
  ).toEqual({ query: "match" })
})

test("keeps non-empty optional string args", () => {
  expect(clean({ query: "match", cursor: "page-2" }, schema)).toEqual({
    query: "match",
    cursor: "page-2",
  })
})

test("keeps empty string for required fields", () => {
  expect(clean({ query: "", cursor: "" }, schema)).toEqual({ query: "" })
})

test("does not drop falsy non-string values for optionals", () => {
  expect(clean({ query: "match", cursor: 0 }, schema)).toEqual({ query: "match", cursor: 0 })
})

test("leaves unknown keys untouched", () => {
  expect(clean({ query: "match", unknown: "" }, schema)).toEqual({ query: "match", unknown: "" })
})

test("normalizes non-object args to an empty object", () => {
  expect(clean(null, schema)).toEqual({})
  expect(clean(undefined, schema)).toEqual({})
  expect(clean("query", schema)).toEqual({})
  expect(clean([], schema)).toEqual({})
})

test("treats args with no required list as all-optional", () => {
  const allOptional: JSONSchema7 = {
    type: "object",
    properties: { cursor: { type: "string" } },
  }
  expect(clean({ cursor: "" }, allOptional)).toEqual({})
  expect(clean({ cursor: "x" }, allOptional)).toEqual({ cursor: "x" })
})
