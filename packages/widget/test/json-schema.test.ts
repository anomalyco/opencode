import { expect, test } from "bun:test"
import { type JSONSchema, validateData } from "../src/index.js"

const schema: JSONSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 5 },
    age: { type: "integer", minimum: 0, maximum: 150 },
    tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 },
    mode: { enum: ["a", "b"] },
    kind: { const: "fixed" },
    value: { anyOf: [{ type: "string" }, { type: "number" }] },
    shape: {
      oneOf: [
        { type: "object", properties: { type: { const: "circle" }, r: { type: "number" } }, required: ["type", "r"] },
        { type: "object", properties: { type: { const: "square" }, side: { type: "number" } }, required: ["type"] },
      ],
    },
    extra: { type: "object", additionalProperties: { type: "boolean" } },
    nullable: { type: ["string", "null"] },
  },
  required: ["name"],
  additionalProperties: false,
}

test("valid data has no problems", () => {
  expect(
    validateData(schema, {
      name: "ada",
      age: 36,
      tags: ["x"],
      mode: "a",
      kind: "fixed",
      value: 1,
      shape: { type: "circle", r: 2 },
      extra: { on: true },
      nullable: null,
    }),
  ).toEqual([])
})

test("each keyword reports its problem with a JSON pointer", () => {
  expect(validateData(schema, [])).toEqual(["/: must be object"])
  expect(validateData(schema, {})).toEqual(["/name: is required"])
  expect(
    validateData(schema, {
      name: "",
      age: 1.5,
      tags: [],
      mode: "c",
      kind: "other",
      value: true,
      extra: { on: "yes" },
      nullable: 1,
      unknown: 1,
    }),
  ).toEqual([
    "/name: must have at least 1 characters",
    "/age: must be integer",
    "/tags: must have at least 1 items",
    '/mode: must be one of "a", "b"',
    '/kind: must be "fixed"',
    "/value: must be string",
    "/extra/on: must be boolean",
    "/nullable: must be string or null",
    "/unknown: is not allowed",
  ])
  expect(validateData(schema, { name: "toolong", age: 200, tags: ["a", 1, "c"] })).toEqual([
    "/name: must have at most 5 characters",
    "/age: must be at most 150",
    "/tags: must have at most 2 items",
    "/tags/1: must be string",
  ])
})

test("oneOf reports the closest branch and rejects ambiguous matches", () => {
  expect(validateData(schema, { name: "a", shape: { type: "circle" } })).toEqual(["/shape/r: is required"])
  const ambiguous: JSONSchema = { oneOf: [{ type: "number" }, { type: "integer" }] }
  expect(validateData(ambiguous, 1)).toEqual(["/: must match exactly one schema in oneOf, matches 2"])
  expect(validateData(ambiguous, 1.5)).toEqual([])
})

test("pattern matches strings and reports an invalid expression", () => {
  const color: JSONSchema = { type: "string", pattern: "^#[0-9a-f]{6}$" }
  expect(validateData(color, "#00ff00")).toEqual([])
  expect(validateData(color, "green")).toEqual(["/: must match ^#[0-9a-f]{6}$"])
  expect(validateData({ pattern: "^#" }, 1)).toEqual([])
  expect(validateData({ type: "string", pattern: "(" }, "x")).toEqual(["/: has an invalid pattern ("])
})
