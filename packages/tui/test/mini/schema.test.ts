import { describe, expect, test } from "bun:test"
import { ATTEMPTS, feedback, instructions, payload, validate } from "../../../src/cli/cmd/run/schema"

describe("payload", () => {
  test("parses a bare JSON answer", () => {
    expect(payload('{"ok": true}')).toEqual({ value: { ok: true } })
  })

  test("parses primitive JSON values", () => {
    expect(payload("42")).toEqual({ value: 42 })
    expect(payload('"text"')).toEqual({ value: "text" })
  })

  test("falls back to the last fenced block", () => {
    const text = 'Here you go:\n```json\n{"a": 1}\n```\nand fixed:\n```json\n{"a": 2}\n```\n'
    expect(payload(text)).toEqual({ value: { a: 2 } })
  })

  test("accepts fences without a language tag", () => {
    expect(payload('```\n{"a": 1}\n```')).toEqual({ value: { a: 1 } })
  })

  test("returns undefined for prose", () => {
    expect(payload("I could not produce JSON.")).toBeUndefined()
    expect(payload("")).toBeUndefined()
  })
})

describe("validate", () => {
  const schema = {
    type: "object",
    required: ["name", "count"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      count: { type: "integer", minimum: 0, maximum: 10 },
      tags: { type: "array", items: { type: "string" }, maxItems: 2 },
      level: { enum: ["low", "high"] },
    },
  }

  test("accepts a conforming value", () => {
    expect(validate(schema, { name: "a", count: 3, tags: ["x"], level: "low" })).toEqual([])
  })

  test("reports missing required properties", () => {
    expect(validate(schema, { name: "a" })).toEqual(['$: missing required property "count"'])
  })

  test("reports type mismatches with paths", () => {
    expect(validate(schema, { name: 1, count: "x" })).toEqual([
      "$.name: expected string, got integer",
      "$.count: expected integer, got string",
    ])
  })

  test("distinguishes integer from number", () => {
    expect(validate({ type: "integer" }, 1.5)).toEqual(["$: expected integer, got number"])
    expect(validate({ type: "number" }, 1)).toEqual([])
  })

  test("checks bounds, lengths, and item counts", () => {
    expect(validate(schema, { name: "", count: 11, tags: ["a", "b", "c"] })).toEqual([
      "$.name: string shorter than minLength 1",
      "$.count: 11 is above maximum 10",
      "$.tags: more items than maxItems 2",
    ])
  })

  test("validates array items recursively", () => {
    expect(validate(schema, { name: "a", count: 0, tags: ["ok", 5] })).toEqual([
      "$.tags[1]: expected string, got integer",
    ])
  })

  test("rejects values outside an enum", () => {
    expect(validate(schema, { name: "a", count: 0, level: "mid" })).toEqual([
      "$.level: value is not one of the allowed enum values",
    ])
  })

  test("rejects unexpected properties when additionalProperties is false", () => {
    expect(validate(schema, { name: "a", count: 0, extra: 1 })).toEqual(['$: unexpected property "extra"'])
  })

  test("supports const and type arrays", () => {
    expect(validate({ const: "fixed" }, "fixed")).toEqual([])
    expect(validate({ const: "fixed" }, "other")).toEqual(["$: value does not equal the required const"])
    expect(validate({ type: ["string", "null"] }, null)).toEqual([])
    expect(validate({ type: ["string", "null"] }, 1)).toEqual(["$: expected one of string, null, got integer"])
  })

  test("ignores unknown keywords and non-object schemas", () => {
    expect(validate({ format: "email" }, "not-an-email")).toEqual([])
    expect(validate(true, { anything: 1 })).toEqual([])
    expect(validate(false, 1)).toEqual(["$: schema forbids any value"])
  })
})

describe("prompts", () => {
  test("instructions embed the schema", () => {
    const text = instructions({ type: "object" })
    expect(text).toContain('"type": "object"')
    expect(text).toContain("JSON only")
  })

  test("feedback lists every error", () => {
    const text = feedback(['$: missing required property "a"', "$.b: expected string, got integer"])
    expect(text).toContain('- $: missing required property "a"')
    expect(text).toContain("- $.b: expected string, got integer")
  })

  test("attempt budget is bounded", () => {
    expect(ATTEMPTS).toBeGreaterThan(1)
    expect(ATTEMPTS).toBeLessThanOrEqual(5)
  })
})
