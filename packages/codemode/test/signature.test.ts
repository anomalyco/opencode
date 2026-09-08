import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"
import { inputTypeScript, jsonSchemaToTypeScript, outputTypeScript } from "../src/tool-schema.js"

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
        "  owner: string,",
        "  /** Cursor from the previous response's pageInfo */",
        "  after?: string,",
        "  /**",
        "   * Results per page",
        "   * @default 30",
        "   */",
        "  perPage?: number,",
        "  /**",
        "   * Filter by labels",
        "   * @minItems 1",
        "   * @maxItems 10",
        "   */",
        "  labels?: Array<string>,",
        '  state?: "open" | "closed",',
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
      [
        "{",
        "  /** Search filter */",
        "  filter?: {",
        "    /** Issue state */",
        "    state?: string,",
        "  },",
        "}",
      ].join("\n"),
    )
  })

  test("Effect Schema annotations become JSDoc on input and output fields", () => {
    expect(inputTypeScript(lookupOrder, true)).toBe(
      ["{", "  /** Order identifier */", "  id: string,", "  verbose?: boolean,", "}"].join("\n"),
    )
    expect(outputTypeScript(lookupOrder, true)).toBe(
      ["{", "  /** Current order status */", "  status: string,", "}"].join("\n"),
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
    expect(pretty).toBe(["{", "  size?: number,", "}"].join("\n"))
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
      ["{", "  /**", "   * First line", "   *", "   * Second line", "   */", "  query?: string,", "}"].join("\n"),
    )
  })

  test("stays total on cyclic $refs and pathological nesting in both modes", () => {
    const cyclic = {
      $ref: "#/$defs/Node",
      $defs: { Node: { type: "object", properties: { child: { $ref: "#/$defs/Node" }, name: { type: "string" } } } },
    } as const
    expect(jsonSchemaToTypeScript(cyclic)).toBe("{ child?: unknown; name?: string }")
    expect(jsonSchemaToTypeScript(cyclic, true)).toContain("child?: unknown")

    let deep: Record<string, unknown> = { type: "string" }
    for (let level = 0; level < 12; level += 1) deep = { type: "object", properties: { next: deep } }
    for (const pretty of [false, true]) {
      const rendered = jsonSchemaToTypeScript(deep, pretty)
      expect(rendered).toContain("unknown")
      expect(rendered).toContain("next?:")
    }
  })

  test("intersects ref and union siblings instead of discarding them", () => {
    expect(
      jsonSchemaToTypeScript({
        $ref: "#/$defs/User",
        properties: { active: { type: "boolean" } },
        required: ["active"],
        $defs: {
          User: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
      }),
    ).toBe("{ id: string } & { active: boolean }")
    expect(
      jsonSchemaToTypeScript({
        type: "object",
        properties: { common: { type: "boolean" } },
        required: ["common"],
        anyOf: [
          { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
          { type: "object", properties: { count: { type: "number" } }, required: ["count"] },
        ],
      }),
    ).toBe("({ name: string } | { count: number }) & { common: boolean }")
    expect(jsonSchemaToTypeScript({ $ref: "https://example.com/schema.json" })).toBe("unknown")
    expect(
      jsonSchemaToTypeScript({
        $ref: "#/$defs/User/properties/id",
        $defs: { User: { type: "object" }, id: { type: "string" } },
      }),
    ).toBe("unknown")
    expect(
      jsonSchemaToTypeScript({
        type: ["object", "null"],
        properties: { name: { type: "string" } },
      }),
    ).toBe("{ name?: string } | null")
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
        '  "123"?: number,',
        '  "foo-bar"?: string,',
        '  "@type": string,',
        "  /** Dotted name */",
        '  "x.y"?: number,',
        "  plain?: boolean,",
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
    expect(outputTypeScript(tool, true)).toBe(["{", '  "content-type": string,', "}"].join("\n"))
  })

  test("Effect Schema structs with non-identifier field names quote too", () => {
    const tool = Tool.make({
      description: "Schema tool with awkward field names",
      input: Schema.Struct({ "foo-bar": Schema.String, plain: Schema.optionalKey(Schema.Number) }),
      run: () => Effect.succeed(null),
    })
    expect(inputTypeScript(tool)).toBe('{ "foo-bar": string; plain?: number }')
    expect(inputTypeScript(tool, true)).toBe(["{", '  "foo-bar": string,', "  plain?: number,", "}"].join("\n"))
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

  test("allOf renders intersections with parenthesized union members", () => {
    const schema = {
      allOf: [{ type: "object", properties: { id: { type: "string" } } }, { type: ["string", "null"] }],
    } as const
    expect(jsonSchemaToTypeScript(schema)).toBe("{ id?: string } & (string | null)")
  })

  test("allOf does not discard an unresolved constraint", () => {
    expect(jsonSchemaToTypeScript({ allOf: [{ type: "string" }, { $ref: "https://example.com/external.json" }] })).toBe(
      "unknown",
    )
    expect(
      jsonSchemaToTypeScript({
        allOf: [{ type: "string" }, { allOf: [{ $ref: "https://example.com/external.json" }] }],
      }),
    ).toBe("unknown")
    expect(
      jsonSchemaToTypeScript({
        type: "string",
        allOf: [{ $ref: "#/$defs/Constraint" }],
        $defs: { Constraint: { description: "TypeScript-neutral constraint" } },
      }),
    ).toBe("string")
  })
})

describe("JSDoc signatures in catalogs and search results", () => {
  const runtime = CodeMode.make({ tools: { github: { list_issues: listIssues }, orders: { lookup: lookupOrder } } })

  const search = async (query: string) => {
    const result = await Effect.runPromise(
      runtime.execute(`return await tools.$codemode.search({ query: ${JSON.stringify(query)} })`),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("search failed")
    return result.value as { items: Array<{ path: string; signature: string }>; remaining: number }
  }

  test("a raw JSON Schema (MCP-style) tool's result signature carries field JSDoc and tags", async () => {
    const { items } = await search("list issues repository")
    const item = items.find(({ path }) => path === "tools.github.list_issues")!
    expect(item.signature).toBe(
      [
        "tools.github.list_issues(input: {",
        "  /** Repository owner */",
        "  owner: string,",
        "  /** Cursor from the previous response's pageInfo */",
        "  after?: string,",
        "  /**",
        "   * Results per page",
        "   * @default 30",
        "   */",
        "  perPage?: number,",
        "  /**",
        "   * Filter by labels",
        "   * @minItems 1",
        "   * @maxItems 10",
        "   */",
        "  labels?: Array<string>,",
        '  state?: "open" | "closed",',
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
          "  id: string,",
          "  verbose?: boolean,",
          "}): Promise<{",
          "  /** Current order status */",
          "  status: string,",
          "}>",
        ].join("\n"),
      )
    }
  })

  test("the inline catalog uses the same JSDoc signatures", async () => {
    const instructions = runtime.instructions()
    const github = (await search("list issues repository")).items.find(
      ({ path }) => path === "tools.github.list_issues",
    )!
    const orders = (await search("look up order")).items.find(({ path }) => path === "tools.orders.lookup")!
    expect(instructions).toContain(`  - ${github.signature} // List issues in a repository`)
    expect(instructions).toContain(`  - ${orders.signature} // Look up an order`)
    expect(instructions).toContain("/** Repository owner */")
  })
})

describe("non-identifier tool paths", () => {
  const resolveLibrary = Tool.make({
    description: "Resolve a Context7 library ID",
    input: {
      type: "object",
      properties: {
        query: { type: "string" },
        libraryName: { type: "string" },
      },
      required: ["query", "libraryName"],
    } as const,
    run: () => Effect.succeed("/reactjs/react.dev"),
  })
  const runtime = CodeMode.make({ tools: { context7: { "resolve-library-id": resolveLibrary } } })

  test("inline catalog uses bracket notation for dashed tool names", () => {
    const instructions = runtime.instructions()

    expect(instructions).toContain(
      'tools.context7["resolve-library-id"](input: {\n  query: string,\n  libraryName: string,\n}): Promise<unknown>',
    )
    expect(instructions).toContain("Do not infer or normalize tool names")
    expect(instructions).toContain("bracket notation and quotes are part of the path")
    expect(instructions).not.toContain("tools.context7.resolve-library-id")
    expect(instructions).not.toContain("tools.context7.resolve_library_id")
  })

  test("search results return callable bracket-notation paths and signatures", async () => {
    const result = await Effect.runPromise(
      runtime.execute(`return await tools.$codemode.search({ query: "resolve library" })`),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("search failed")

    const value = result.value as { items: Array<{ path: string; signature: string }> }
    expect(value.items[0]?.path).toBe('tools.context7["resolve-library-id"]')
    expect(value.items[0]?.signature).toContain('tools.context7["resolve-library-id"](input: {')
  })
})
