import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode } from "../src/index.js"
import { Tool, inputTypeScript, jsonSchemaToTypeScript, outputTypeScript } from "../src/tool.js"

// A raw JSON Schema tool in the shape an MCP adapter produces: render-only input schema
// whose property descriptions and constraints must surface as JSDoc in pretty signatures.
const listIssues = Tool.make({
  description: "List issues in a repository",
  input: {
    type: "object",
    properties: {
      owner: { type: "string", description: "Repository owner" },
      after: { type: "string", description: "Cursor from the previous response's pageInfo" },
      perPage: { type: "number", description: "Results per page", default: 30 },
      labels: { type: "array", items: { type: "string" }, description: "Filter by labels", minItems: 1, maxItems: 10 },
      state: { type: "string", enum: ["open", "closed"] },
    },
    required: ["owner"],
  },
  run: () => Effect.succeed("[]"),
})

// An Effect Schema tool whose field annotations must flow through the emitted JSON Schema.
const lookupOrder = Tool.make({
  description: "Look up an order",
  input: Schema.Struct({
    id: Schema.String.annotate({ description: "Order identifier" }),
    verbose: Schema.optionalKey(Schema.Boolean),
  }),
  output: Schema.Struct({
    status: Schema.String.annotate({ description: "Current order status" }),
  }),
  run: () => Effect.succeed({ status: "open" }),
})

describe("pretty signature rendering", () => {
  test("described fields get JSDoc comments; undescribed and untagged fields get none", () => {
    expect(inputTypeScript(listIssues, true)).toBe(
      [
        "{",
        "  /** Repository owner */",
        "  owner: string",
        "  /** Cursor from the previous response's pageInfo */",
        "  after?: string",
        "  /**",
        "   * Results per page",
        "   * @default 30",
        "   */",
        "  perPage?: number",
        "  /**",
        "   * Filter by labels",
        "   * @minItems 1",
        "   * @maxItems 10",
        "   */",
        "  labels?: Array<string>",
        '  state?: "open" | "closed"',
        "}",
      ].join("\n"),
    )
  })

  test("compact mode output is unchanged by the pretty machinery", () => {
    expect(inputTypeScript(listIssues)).toBe(
      '{ owner: string; after?: string; perPage?: number; labels?: Array<string>; state?: "open" | "closed" }',
    )
    expect(inputTypeScript(lookupOrder)).toBe("{ id: string; verbose?: boolean }")
    expect(outputTypeScript(lookupOrder)).toBe("{ status: string }")
  })

  test("nested objects recurse with increasing indent and their own JSDoc", () => {
    const pretty = jsonSchemaToTypeScript(
      {
        type: "object",
        properties: {
          filter: {
            type: "object",
            description: "Search filter",
            properties: { state: { type: "string", description: "Issue state" } },
          },
        },
      },
      true,
    )
    expect(pretty).toBe(
      ["{", "  /** Search filter */", "  filter?: {", "    /** Issue state */", "    state?: string", "  }", "}"].join(
        "\n",
      ),
    )
  })

  test("Effect Schema annotations become JSDoc on input and output fields", () => {
    expect(inputTypeScript(lookupOrder, true)).toBe(
      ["{", "  /** Order identifier */", "  id: string", "  verbose?: boolean", "}"].join("\n"),
    )
    expect(outputTypeScript(lookupOrder, true)).toBe(
      ["{", "  /** Current order status */", "  status: string", "}"].join("\n"),
    )
  })

  test("constraints TypeScript cannot express surface as JSDoc tags", () => {
    const pretty = jsonSchemaToTypeScript(
      {
        type: "object",
        properties: {
          legacy: { type: "string", deprecated: true },
          homepage: { type: "string", format: "uri" },
          tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5, default: ["a", "b"] },
        },
      },
      true,
    )
    expect(pretty).toContain("  /** @deprecated */\n  legacy?: string")
    expect(pretty).toContain("  /** @format uri */\n  homepage?: string")
    expect(pretty).toContain(
      [
        "  /**",
        '   * @default ["a","b"]',
        "   * @minItems 2",
        "   * @maxItems 5",
        "   */",
        "  tags?: Array<string>",
      ].join("\n"),
    )
  })

  test("skips an unserializable default rather than emitting a broken tag", () => {
    const pretty = jsonSchemaToTypeScript(
      { type: "object", properties: { size: { type: "number", default: 1n } } },
      true,
    )
    expect(pretty).toBe(["{", "  size?: number", "}"].join("\n"))
  })

  test("neutralizes */ inside descriptions so nothing closes the comment early", () => {
    const pretty = jsonSchemaToTypeScript(
      { type: "object", properties: { note: { type: "string", description: "Ends */ early" } } },
      true,
    )
    expect(pretty).toContain("  /** Ends * / early */")
    expect(pretty).not.toContain("Ends */")
  })

  test("multiline descriptions become *-prefixed blocks with blank edges trimmed", () => {
    const pretty = jsonSchemaToTypeScript(
      {
        type: "object",
        properties: { query: { type: "string", description: "\nFirst line\n\nSecond line\n" } },
      },
      true,
    )
    expect(pretty).toBe(
      ["{", "  /**", "   * First line", "   *", "   * Second line", "   */", "  query?: string", "}"].join("\n"),
    )
  })

  test("stays total on cyclic $refs and pathological nesting in both modes", () => {
    const cyclic = {
      $ref: "#/$defs/Node",
      $defs: { Node: { type: "object", properties: { child: { $ref: "#/$defs/Node" }, name: { type: "string" } } } },
    } as const
    expect(jsonSchemaToTypeScript(cyclic)).toBe("{ child?: Node; name?: string }")
    expect(jsonSchemaToTypeScript(cyclic, true)).toContain("child?: Node")

    let deep: Record<string, unknown> = { type: "string" }
    for (let level = 0; level < 12; level += 1) deep = { type: "object", properties: { next: deep } }
    for (const pretty of [false, true]) {
      const rendered = jsonSchemaToTypeScript(deep, pretty)
      expect(rendered).toContain("unknown")
      expect(rendered).toContain("next?:")
    }
  })
})

describe("non-identifier property names render as quoted keys", () => {
  // MCP-style schemas routinely carry property names that are not bare TS identifiers
  // (`foo-bar`, `@type`, dotted names); the rendered signature must quote them so the
  // model sees a valid TypeScript object type. Bare identifiers stay unquoted.
  const rawSchema = {
    type: "object",
    properties: {
      "foo-bar": { type: "string" },
      "@type": { type: "string" },
      "x.y": { type: "number", description: "Dotted name" },
      "123": { type: "number" },
      plain: { type: "boolean" },
    },
    required: ["@type"],
  } as const

  test("compact rendering quotes non-identifier keys and leaves identifiers bare", () => {
    expect(jsonSchemaToTypeScript(rawSchema)).toBe(
      '{ "123"?: number; "foo-bar"?: string; "@type": string; "x.y"?: number; plain?: boolean }',
    )
  })

  test("pretty rendering quotes non-identifier keys and keeps their JSDoc", () => {
    expect(jsonSchemaToTypeScript(rawSchema, true)).toBe(
      [
        "{",
        '  "123"?: number',
        '  "foo-bar"?: string',
        '  "@type": string',
        "  /** Dotted name */",
        '  "x.y"?: number',
        "  plain?: boolean",
        "}",
      ].join("\n"),
    )
  })

  test("JSON Schema input and output signatures of a tool both quote", () => {
    const tool = Tool.make({
      description: "Adapter tool with awkward field names",
      input: rawSchema,
      output: {
        type: "object",
        properties: { "content-type": { type: "string" } },
        required: ["content-type"],
      } as const,
      run: () => Effect.succeed({ "content-type": "text/plain" }),
    })
    expect(inputTypeScript(tool)).toContain('"foo-bar"?: string')
    expect(outputTypeScript(tool)).toBe('{ "content-type": string }')
    expect(outputTypeScript(tool, true)).toBe(["{", '  "content-type": string', "}"].join("\n"))
  })

  test("Effect Schema structs with non-identifier field names quote too", () => {
    const tool = Tool.make({
      description: "Schema tool with awkward field names",
      input: Schema.Struct({ "foo-bar": Schema.String, plain: Schema.optionalKey(Schema.Number) }),
      run: () => Effect.succeed(null),
    })
    expect(inputTypeScript(tool)).toBe('{ "foo-bar": string; plain?: number }')
    expect(inputTypeScript(tool, true)).toBe(["{", '  "foo-bar": string', "  plain?: number", "}"].join("\n"))
  })
})

describe("union schemas render every alternative", () => {
  test("anyOf with a number branch keeps sibling alternatives", () => {
    const schema = {
      anyOf: [{ type: "string" }, { type: "number" }],
    } as const
    expect(jsonSchemaToTypeScript(schema)).toBe("string | number")
    expect(jsonSchemaToTypeScript(schema, true)).toBe("string | number")
  })

  test("nullable numeric unions keep null", () => {
    const schema = {
      oneOf: [{ type: "number" }, { type: "null" }],
    } as const
    expect(jsonSchemaToTypeScript(schema)).toBe("number | null")
    expect(jsonSchemaToTypeScript(schema, true)).toBe("number | null")
  })

  test("tool input and output signatures preserve numeric unions", () => {
    const tool = Tool.make({
      description: "Tool with numeric unions",
      input: {
        type: "object",
        properties: {
          value: { anyOf: [{ type: "string" }, { type: "number" }] },
        },
      } as const,
      output: { anyOf: [{ type: "number" }, { type: "boolean" }] } as const,
      run: () => Effect.succeed(1),
    })
    expect(inputTypeScript(tool)).toBe("{ value?: string | number }")
    expect(outputTypeScript(tool)).toBe("number | boolean")
  })
})

describe("pretty signatures in search results", () => {
  const runtime = CodeMode.make({ tools: { github: { list_issues: listIssues }, orders: { lookup: lookupOrder } } })

  const search = async (query: string) => {
    const result = await Effect.runPromise(
      runtime.execute(`return await tools.$codemode.search({ query: ${JSON.stringify(query)} })`),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("search failed")
    return result.value as { items: Array<{ path: string; signature: string }>; total: number }
  }

  test("a raw JSON Schema (MCP-style) tool's result signature carries field JSDoc and tags", async () => {
    const { items } = await search("list issues repository")
    const item = items.find(({ path }) => path === "tools.github.list_issues")!
    expect(item.signature).toBe(
      [
        "tools.github.list_issues(input: {",
        "  /** Repository owner */",
        "  owner: string",
        "  /** Cursor from the previous response's pageInfo */",
        "  after?: string",
        "  /**",
        "   * Results per page",
        "   * @default 30",
        "   */",
        "  perPage?: number",
        "  /**",
        "   * Filter by labels",
        "   * @minItems 1",
        "   * @maxItems 10",
        "   */",
        "  labels?: Array<string>",
        '  state?: "open" | "closed"',
        "}): Promise<unknown>",
      ].join("\n"),
    )
  })

  test("an annotated Effect Schema tool's result signature carries field JSDoc (exact-path lookup too)", async () => {
    for (const query of ["look up order", "tools.orders.lookup"]) {
      const { items } = await search(query)
      const item = items.find(({ path }) => path === "tools.orders.lookup")!
      expect(item.signature).toBe(
        [
          "tools.orders.lookup(input: {",
          "  /** Order identifier */",
          "  id: string",
          "  verbose?: boolean",
          "}): Promise<{",
          "  /** Current order status */",
          "  status: string",
          "}>",
        ].join("\n"),
      )
    }
  })

  test("the inline catalog line for the same tool stays single-line compact", () => {
    const instructions = runtime.instructions()
    expect(instructions).toContain(
      '  - tools.github.list_issues(input: { owner: string; after?: string; perPage?: number; labels?: Array<string>; state?: "open" | "closed" }): Promise<unknown> // List issues in a repository',
    )
    expect(instructions).toContain(
      "  - tools.orders.lookup(input: { id: string; verbose?: boolean }): Promise<{ status: string }> // Look up an order",
    )
    expect(instructions).not.toContain("/**")
  })
})
