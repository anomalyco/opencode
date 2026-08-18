import { describe, expect, test } from "bun:test"
import { minimalRosterFilter, withSubagentEnum } from "@/tool/registry"

const ids = (filter: (id: string) => boolean, candidates: string[]) => candidates.filter(filter)

describe("minimalRosterFilter", () => {
  test("defaults to the core roster", () => {
    const filter = minimalRosterFilter()
    expect(ids(filter, ["bash", "read", "task", "websearch", "invalid"])).toEqual(["bash", "read", "invalid"])
  })

  test("include keeps built-ins through the cut", () => {
    const filter = minimalRosterFilter({ tierTools: { include: ["task"] } })
    expect(filter("task")).toBe(true)
    expect(filter("websearch")).toBe(false)
    expect(filter("bash")).toBe(true)
  })

  test("exclude drops base tools", () => {
    const filter = minimalRosterFilter({ tierTools: { exclude: ["todowrite"] } })
    expect(filter("todowrite")).toBe(false)
    expect(filter("bash")).toBe(true)
  })

  test("exclude cannot remove invalid", () => {
    // `invalid` is the LLM layer's landing slot for malformed tool calls and is
    // never advertised to the model, so removing it would break repair, not
    // save context.
    const filter = minimalRosterFilter({ tierTools: { exclude: ["invalid"] } })
    expect(filter("invalid")).toBe(true)
  })

  test("custom tools are exempt from the cut", () => {
    const filter = minimalRosterFilter({ customIDs: new Set(["parse_pdf", "house_search"]) })
    expect(filter("parse_pdf")).toBe(true)
    expect(filter("house_search")).toBe(true)
    // Built-ins are still cut.
    expect(filter("task")).toBe(false)
  })

  test("exclude still wins over the custom exemption", () => {
    const filter = minimalRosterFilter({
      tierTools: { exclude: ["parse_pdf"] },
      customIDs: new Set(["parse_pdf", "ocr"]),
    })
    expect(filter("parse_pdf")).toBe(false)
    expect(filter("ocr")).toBe(true)
  })
})

describe("withSubagentEnum", () => {
  const schema = {
    type: "object" as const,
    properties: {
      subagent_type: { type: "string" as const, description: "The type of specialized agent to use for this task" },
      prompt: { type: "string" as const },
    },
  }

  test("constrains subagent_type to the permitted agents", () => {
    const result = withSubagentEnum(schema, ["explore", "plan"])
    expect((result.properties?.subagent_type as { enum?: string[] }).enum).toEqual(["explore", "plan"])
    // The description survives, and other fields are untouched.
    expect((result.properties?.subagent_type as { description?: string }).description).toContain("specialized agent")
    expect(result.properties?.prompt).toEqual(schema.properties.prompt)
  })

  test("leaves the schema alone when no subagents are permitted", () => {
    // An empty enum is invalid JSON Schema and would reject every call.
    expect(withSubagentEnum(schema, [])).toBe(schema)
  })

  test("tolerates a schema without the field", () => {
    const other = { type: "object" as const, properties: { prompt: { type: "string" as const } } }
    expect(withSubagentEnum(other, ["explore"])).toBe(other)
  })

  test("does not mutate the input schema", () => {
    withSubagentEnum(schema, ["explore"])
    expect((schema.properties.subagent_type as { enum?: string[] }).enum).toBeUndefined()
  })
})
