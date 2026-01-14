import { test, expect, describe } from "bun:test"
import { repairJson, repairToolCallJson } from "../../src/util/json-repair"

describe("repairJson", () => {
  test("returns valid JSON unchanged", () => {
    const valid = '{"key": "value", "num": 123}'
    expect(repairJson(valid)).toBe(valid)
  })

  test("fixes unquoted property names", () => {
    const malformed = '{key: "value"}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ key: "value" })
  })

  test("fixes unquoted string values - simple identifier", () => {
    const malformed = '{"direction": both}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ direction: "both" })
  })

  test("fixes unquoted string values - UUID-like", () => {
    const malformed = '{"id": cf56856a}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ id: "cf56856a" })
  })

  test("fixes single quotes", () => {
    const malformed = "{'key': 'value'}"
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ key: "value" })
  })

  test("fixes mixed quotes", () => {
    const malformed = `{'key1': "value1", "key2": 'value2'}`
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ key1: "value1", key2: "value2" })
  })

  test("removes trailing commas from objects", () => {
    const malformed = '{"key": "value",}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ key: "value" })
  })

  test("removes trailing commas from arrays", () => {
    const malformed = '["a", "b", "c",]'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual(["a", "b", "c"])
  })

  test("preserves JSON boolean literals", () => {
    const malformed = '{"enabled": true, "disabled": false}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ enabled: true, disabled: false })
  })

  test("preserves JSON null literal", () => {
    const malformed = '{"value": null}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ value: null })
  })

  test("preserves numeric values", () => {
    const malformed = '{"integer": 42, "float": 3.14}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ integer: 42, float: 3.14 })
  })

  test("handles nested objects", () => {
    const malformed = '{outer: {inner: value}}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ outer: { inner: "value" } })
  })

  test("handles arrays with unquoted values", () => {
    const malformed = '{"items": [first, second, third]}'
    // Note: array values are trickier - the current implementation focuses on object property values
    // This test documents current behavior
    const result = repairJson(malformed)
    // If this doesn't parse, the original is returned
    try {
      JSON.parse(result)
    } catch {
      expect(result).toBe(malformed)
    }
  })

  test("handles complex MCP tool call scenario", () => {
    // Real-world example from the bug report
    const malformed = '{"direction": both, "entity_id": cf56856a}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({
      direction: "both",
      entity_id: "cf56856a",
    })
  })

  test("handles unquoted enum-like values with hyphens", () => {
    const malformed = '{"status": in-progress}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ status: "in-progress" })
  })

  test("returns original on unparseable input", () => {
    const malformed = "this is not json at all {{{"
    const result = repairJson(malformed)
    expect(result).toBe(malformed)
  })

  test("handles empty object", () => {
    const valid = "{}"
    expect(repairJson(valid)).toBe(valid)
  })

  test("handles empty array", () => {
    const valid = "[]"
    expect(repairJson(valid)).toBe(valid)
  })

  test("fixes multiple issues in one pass", () => {
    const malformed = "{name: 'John', age: 30, active: true,}"
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({
      name: "John",
      age: 30,
      active: true,
    })
  })
})

describe("repairToolCallJson", () => {
  test("repairs with schema enum hints", () => {
    const malformed = '{"direction": both}'
    const schema = {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["both", "inbound", "outbound"],
        },
      },
    }
    const result = repairToolCallJson(malformed, schema)
    expect(JSON.parse(result)).toEqual({ direction: "both" })
  })

  test("repairs without schema", () => {
    const malformed = '{"key": value}'
    const result = repairToolCallJson(malformed)
    expect(JSON.parse(result)).toEqual({ key: "value" })
  })

  test("works with undefined schema", () => {
    const malformed = '{"key": value}'
    const result = repairToolCallJson(malformed, undefined)
    expect(JSON.parse(result)).toEqual({ key: "value" })
  })

  test("handles schema with multiple enum properties", () => {
    const malformed = '{"status": pending, "priority": high}'
    const schema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "active", "completed"],
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
      },
    }
    const result = repairToolCallJson(malformed, schema)
    expect(JSON.parse(result)).toEqual({
      status: "pending",
      priority: "high",
    })
  })
})

/**
 * Issue #8102 Reproduction Tests
 * https://github.com/anomalyco/opencode/issues/8102
 *
 * GLM-4.7 generates JavaScript-like objects instead of strict JSON for MCP tool calls.
 * These tests reproduce the exact error cases from the bug report.
 */
describe("Issue #8102 - GLM-4.7 MCP tool call JSON parsing", () => {
  test("reproduces: unquoted enum value 'both' in get_relations call", () => {
    // Error: "Invalid input for tool generator-mcp_get_relations: JSON parsing failed...
    //         Unexpected identifier 'both'"
    const malformedInput = '{"direction": both}'
    const result = repairJson(malformedInput)

    // Verify it now parses correctly
    expect(() => JSON.parse(malformedInput)).toThrow()
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result)).toEqual({ direction: "both" })
  })

  test("reproduces: unquoted UUID 'cf56856a' in execute_dynamic_api call", () => {
    // Error: "Invalid input for tool generator-mcp_execute_dynamic_api: JSON parsing failed...
    //         Unexpected identifier 'cf56856a'"
    const malformedInput = '{"entity_id": cf56856a}'
    const result = repairJson(malformedInput)

    // Verify it now parses correctly
    expect(() => JSON.parse(malformedInput)).toThrow()
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result)).toEqual({ entity_id: "cf56856a" })
  })

  test("reproduces: combined unquoted values in single tool call", () => {
    // Real scenario: multiple unquoted values in one MCP call
    const malformedInput = '{"direction": both, "entity_id": cf56856a, "limit": 10}'
    const result = repairJson(malformedInput)

    expect(() => JSON.parse(malformedInput)).toThrow()
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result)).toEqual({
      direction: "both",
      entity_id: "cf56856a",
      limit: 10,
    })
  })

  test("reproduces: schema-aware repair for MCP tool with enum", () => {
    // MCP tools have JSON schemas - use them to help repair
    const malformedInput = '{"direction": inbound}'
    const mcpToolSchema = {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["both", "inbound", "outbound"],
        },
      },
    }

    const result = repairToolCallJson(malformedInput, mcpToolSchema)
    expect(JSON.parse(result)).toEqual({ direction: "inbound" })
  })
})

describe("edge cases", () => {
  test("handles whitespace variations", () => {
    const malformed = '{  key  :  value  }'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ key: "value" })
  })

  test("handles newlines in input", () => {
    const malformed = `{
      "key": value
    }`
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ key: "value" })
  })

  test("preserves escaped characters in strings", () => {
    const valid = '{"path": "C:\\\\Users\\\\test"}'
    expect(repairJson(valid)).toBe(valid)
  })

  test("handles property names with underscores", () => {
    const malformed = '{my_property: value}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ my_property: "value" })
  })

  test("handles property names with dollar signs", () => {
    const malformed = '{$ref: value}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ $ref: "value" })
  })

  test("handles numeric property names that look like identifiers", () => {
    const malformed = '{"id123": value}'
    const result = repairJson(malformed)
    expect(JSON.parse(result)).toEqual({ id123: "value" })
  })
})
