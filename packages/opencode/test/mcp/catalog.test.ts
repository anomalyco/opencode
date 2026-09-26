import { describe, expect, test } from "bun:test"
import Ajv2020 from "ajv/dist/2020"
import { asSchema } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpCatalog } from "@/mcp/catalog"
import { Effect } from "effect"

const options = { toolCallId: "call_mcp", abortSignal: new AbortController().signal } as any

function clientReturning(result: unknown) {
  return {
    callTool: async () => result,
  } as unknown as Client
}

function mcpTool() {
  return {
    name: "screenshot",
    description: "Take a screenshot",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  } as any
}

describe("McpCatalog.convertTool", () => {
  test("preserves content when structuredContent is also present", async () => {
    const content = [{ type: "image" as const, mimeType: "image/png", data: "AAAA" }]
    const structuredContent = { image: { mimeType: "image/png", data: "AAAA" } }
    const converted = McpCatalog.convertTool(mcpTool(), clientReturning({ content, structuredContent }))

    const output = await converted.execute?.({}, options)

    expect(output).toMatchObject({ content, structuredContent })
  })

  test("falls back to structuredContent only when content is absent", async () => {
    const structuredContent = { results: [{ title: "one" }] }
    const converted = McpCatalog.convertTool(mcpTool(), clientReturning({ content: [], structuredContent }))

    const output = await converted.execute?.({}, options)

    expect(output).toMatchObject({
      structuredContent,
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    })
  })
})

test("preserves output schema validation across paginated tool discovery", async () => {
  const server = new Server({ name: "pagination", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, ({ params }) =>
    Promise.resolve(
      params?.cursor === "page-2"
        ? {
            tools: [
              {
                name: "second",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { value: { type: "number" } },
                  required: ["value"],
                },
              },
            ],
          }
        : {
            tools: [
              {
                name: "first",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { value: { type: "string" } },
                  required: ["value"],
                },
              },
            ],
            nextCursor: "page-2",
          },
    ),
  )
  server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
    Promise.resolve({
      content: [],
      structuredContent: { value: params.name === "first" ? 42 : 1 },
    }),
  )

  const client = new Client({ name: "pagination-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  try {
    const tools = await Effect.runPromise(McpCatalog.defs(client))
    expect(tools?.map((tool) => tool.name)).toEqual(["first", "second"])
    await expect(client.callTool({ name: "first", arguments: {} })).rejects.toThrow(
      "Structured content does not match the tool's output schema",
    )
  } finally {
    await Promise.all([client.close(), server.close()])
  }
})

describe("McpCatalog.assignToolNames", () => {
  test("gives colliding sanitized names distinct keys", () => {
    const names = McpCatalog.assignToolNames([
      { clientName: "a.b", name: "x" },
      { clientName: "a_b", name: "x" },
      { clientName: "a b", name: "x" },
    ])

    const assigned = [...names.values()].map((perServer) => perServer.get("x"))
    expect(new Set(assigned).size).toBe(3)
    expect(assigned[0]).toBe("a_b_x")
  })

  test("keeps distinct raw names distinct within one server", () => {
    const names = McpCatalog.assignToolNames([
      { clientName: "srv", name: "a.b" },
      { clientName: "srv", name: "a_b" },
    ])

    const byName = names.get("srv")!
    expect(byName.get("a.b")).toBe("srv_a_b")
    expect(byName.get("a_b")).toBeDefined()
    expect(byName.get("a_b")).not.toBe("srv_a_b")
  })
})

describe("McpCatalog.convertTool bounds untrusted server input", () => {
  test("prefixes the description with the server name and caps its length", () => {
    const tool = McpCatalog.convertTool(
      { ...mcpTool(), description: "x".repeat(10_000) },
      clientReturning({ content: [], structuredContent: {} }),
      undefined,
      "my-server",
    )

    expect(tool.description?.startsWith("[my-server] ")).toBe(true)
    expect(tool.description?.length).toBeLessThan(5_000)
  })

  test("does not recurse forever on a deeply nested input schema", () => {
    let schema: Record<string, unknown> = { type: "string" }
    for (let index = 0; index < 200; index++) schema = { type: "object", properties: { nested: schema } }

    const deep = mcpTool()
    deep.inputSchema = schema

    expect(() => McpCatalog.convertTool(deep, clientReturning({ content: [], structuredContent: {} }))).not.toThrow()
  })

  const invalidSchemaKeywords = (schema: unknown) => {
    const invalid: string[] = []
    const walk = (value: unknown, path: string) => {
      if (value === null || typeof value !== "object") return
      if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`))
      const entries = value as Record<string, unknown>
      if ("required" in entries && !Array.isArray(entries.required)) invalid.push(`${path}.required`)
      if ("properties" in entries && (typeof entries.properties !== "object" || Array.isArray(entries.properties)))
        invalid.push(`${path}.properties`)
      for (const keyword of ["anyOf", "oneOf", "allOf", "enum", "type", "prefixItems"]) {
        const members = entries[keyword]
        if (Array.isArray(members) && members.length === 0) invalid.push(`${path}.${keyword}`)
      }
      Object.entries(entries).forEach(([key, item]) => walk(item, `${path}.${key}`))
    }
    walk(schema, "schema")
    return invalid
  }

  const emitted = (inputSchema: unknown) => {
    const tool = mcpTool()
    tool.inputSchema = inputSchema
    return asSchema(
      McpCatalog.convertTool(tool, clientReturning({ content: [], structuredContent: {} })).inputSchema!,
    ).jsonSchema as Record<string, unknown>
  }

  test("drops over-budget subtrees instead of emitting invalid JSON Schema keywords", () => {
    const node = (depth: number): Record<string, unknown> =>
      depth === 0
        ? { type: "object", properties: { name: { type: "string" } }, required: ["name"] }
        : {
            type: "object",
            properties: { name: { type: "string" }, children: { type: "array", items: node(depth - 1) } },
            required: ["name"],
          }

    expect(invalidSchemaKeywords(emitted({ type: "object", properties: { data: node(6) }, required: ["data"] }))).toEqual(
      [],
    )
  })

  test("never emits empty anyOf/oneOf/allOf/enum at the depth or node budget boundary", () => {
    const union = { anyOf: [{ type: "string" }, { type: "number" }] }
    let depthSchema: Record<string, unknown> = union
    for (let index = 0; index < 5; index++) depthSchema = { items: depthSchema }

    const props: Record<string, unknown> = {}
    for (let index = 0; index < 496; index++) props[`p${index}`] = { type: "string" }
    props.zzz_enum = { enum: [{ deep: { type: "string" } }, { deep: { type: "string" } }] }
    props.zzz_union = union

    expect(invalidSchemaKeywords(emitted({ type: "object", properties: { k: depthSchema } }))).toEqual([])
    expect(invalidSchemaKeywords(emitted({ type: "object", properties: props }))).toEqual([])
  })

  test("keeps a cyclic tool callable by dropping required entries whose property was pruned", () => {
    const cyclic: Record<string, unknown> = { type: "object", properties: { kept: { type: "string" } } }
    cyclic.properties = { kept: { type: "string" }, self: cyclic }
    cyclic.required = ["kept", "self"]

    const schema = emitted(cyclic)

    expect(schema.required).toEqual(["kept"])
    expect(invalidSchemaKeywords(schema)).toEqual([])
  })

  test("drops a fully pruned required list rather than emitting an unsatisfiable tool", () => {
    const cyclic: Record<string, unknown> = { type: "object", properties: {} }
    cyclic.properties = { self: cyclic }
    cyclic.required = ["self"]

    const schema = emitted(cyclic)

    expect(schema.required).toBeUndefined()
    expect(schema.additionalProperties).toBe(false)
  })

  test("normalizes draft-07 tuple items to a single schema", () => {
    const schema = emitted({
      type: "object",
      properties: { k: { type: "array", items: [{ type: "string" }, { type: "number" }] } },
    })

    expect(schema.properties).toMatchObject({ k: { type: "array", items: {} } })
    expect(invalidSchemaKeywords(schema)).toEqual([])
  })

  test("does not throw on a null input schema", () => {
    const tool = mcpTool()
    tool.inputSchema = null

    expect(() =>
      McpCatalog.convertTool(tool, clientReturning({ content: [], structuredContent: {} })),
    ).not.toThrow()
  })

  test("drops source-empty schema keywords at the root and nested regardless of source length", () => {
    const schema = emitted({
      type: "object",
      properties: {
        k: { anyOf: [], oneOf: [], allOf: [], enum: [], type: [], prefixItems: [] },
      },
      anyOf: [],
      oneOf: [],
      allOf: [],
      enum: [],
      prefixItems: [],
    })

    expect(invalidSchemaKeywords(schema)).toEqual([])
    expect(schema).toMatchObject({
      type: "object",
      properties: { k: {} },
      additionalProperties: false,
    })
    expect("anyOf" in schema).toBe(false)
    expect("enum" in schema).toBe(false)
    expect("prefixItems" in schema).toBe(false)
  })

  test("preserves a genuinely empty required array", () => {
    const schema = emitted({ type: "object", properties: { kept: { type: "string" } }, required: [] })

    expect(schema.required).toEqual([])
    expect(invalidSchemaKeywords(schema)).toEqual([])
  })

  test("sanitizes nested schema keyword type confusion at every node", () => {
    const schema = emitted({
      type: "object",
      properties: {
        k: { type: "object", required: { a: 1 }, properties: [1, 2], items: 3, $ref: 42, prefixItems: [1, 2] },
      },
    })
    const k = (schema.properties as Record<string, Record<string, unknown>>).k

    expect(k.required).toBeUndefined()
    expect(k.properties).toBeUndefined()
    expect(k.items).toBeUndefined()
    expect(k.$ref).toBeUndefined()
    expect(k.prefixItems).toBeUndefined()
    expect(invalidSchemaKeywords(schema)).toEqual([])
  })

  test("does not mistake property names or enum values for schema keywords", () => {
    const schema = emitted({
      type: "object",
      properties: {
        options: {
          type: "object",
          properties: { required: { type: "boolean" }, items: { type: "string" } },
          required: ["required"],
        },
        choice: { enum: [{ required: { a: 1 } }, "other"] },
      },
    })
    const properties = schema.properties as Record<string, Record<string, unknown>>

    expect(properties.options.properties).toEqual({ required: { type: "boolean" }, items: { type: "string" } })
    expect(properties.options.required).toEqual(["required"])
    expect(properties.choice.enum).toEqual([{ required: { a: 1 } }, "other"])
  })

  test("filters nested required against emitted properties at every node", () => {
    const cyclic: Record<string, unknown> = { type: "object", additionalProperties: false }
    cyclic.properties = { kept: { type: "string" }, self: cyclic }
    cyclic.required = ["kept", "self"]

    const schema = emitted({ type: "object", properties: { nested: cyclic }, required: ["nested"] })
    const nested = (schema.properties as Record<string, Record<string, unknown>>).nested

    expect(nested.required).toEqual(["kept"])
    expect(invalidSchemaKeywords(schema)).toEqual([])
  })

  test("emits resolvable references when a $defs entry is pruned", () => {
    const shared = { type: "string" }
    const schema = emitted({
      type: "object",
      properties: { a: shared, b: { $ref: "#/$defs/A" } },
      $defs: { A: shared },
    })

    expect((schema.properties as Record<string, unknown>).b).toEqual({})
    expect(schema.$defs).toEqual({})
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("compiles the sanitized document under ajv 2020-12", () => {
    const ajv = new Ajv2020({ strict: false })
    const cases: unknown[] = [
      {
        type: "object",
        properties: { k: { anyOf: [], oneOf: [], allOf: [], enum: [], type: [], prefixItems: [] } },
        anyOf: [],
        oneOf: [],
        allOf: [],
        enum: [],
        prefixItems: [],
      },
      { type: "object", properties: { k: { type: "object", required: { a: 1 }, properties: [1, 2], items: 3 } } },
    ]

    for (const input of cases) expect(() => ajv.compile(emitted(input))).not.toThrow()
  })

  test("drops invalid schema-map members, type members, and dependentRequired entries", () => {
    const schema = emitted({
      type: "object",
      properties: {
        k: {
          type: ["string", "notatype", null],
          properties: { bad: [1, 2], good: { type: "string" }, also: "x" },
          patternProperties: { "^a": [1] },
          dependentSchemas: { a: [1] },
          dependentRequired: { dropped: "notarray", kept: [1, "c"] },
        },
      },
      $defs: { invalid: 7, valid: { type: "string" } },
    })
    const k = (schema.properties as Record<string, Record<string, unknown>>).k

    expect(k.type).toEqual(["string"])
    expect(k.properties).toEqual({ good: { type: "string" } })
    expect(k.patternProperties).toEqual({})
    expect(k.dependentSchemas).toEqual({})
    expect(k.dependentRequired).toEqual({ kept: ["c"] })
    expect(schema.$defs).toEqual({ valid: { type: "string" } })
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("drops non-schema members of anyOf/oneOf/allOf but preserves boolean schemas", () => {
    const schema = emitted({
      type: "object",
      properties: {
        k: {
          type: ["string", "notatype", null],
          anyOf: [{ type: "string" }, 1, null, "x", true],
          oneOf: ["x", { type: "number" }],
          allOf: [null],
        },
      },
    })
    const k = (schema.properties as Record<string, Record<string, unknown>>).k

    expect(k.type).toEqual(["string"])
    expect(k.anyOf).toEqual([{ type: "string" }, true])
    expect(k.oneOf).toEqual([{ type: "number" }])
    expect(k.allOf).toBeUndefined()
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("drops source-typed bounds, contentSchema, enum and ref forms that ajv refuses", () => {
    const schema = emitted({
      type: "object",
      properties: {
        k: {
          type: "string",
          minLength: "x",
          maxItems: -1,
          minProperties: 1.5,
          multipleOf: 0,
          maximum: "x",
          pattern: 5,
          contentEncoding: 5,
          format: 5,
          uniqueItems: "x",
          examples: 5,
          enum: 5,
          contentSchema: { required: { a: 1 } },
          $dynamicRef: "urn:example:x",
          $ref: "urn:example:x",
        },
        regex: { type: "string", pattern: "(" },
        valid: {
          type: "string",
          minLength: 2,
          maxItems: 3,
          pattern: "^a+$",
          contentEncoding: "base64",
          format: "email",
          uniqueItems: true,
          examples: [1],
        },
      },
    })
    const props = schema.properties as Record<string, Record<string, unknown>>

    for (const keyword of [
      "minLength",
      "maxItems",
      "minProperties",
      "multipleOf",
      "maximum",
      "pattern",
      "contentEncoding",
      "format",
      "uniqueItems",
      "examples",
      "enum",
      "$dynamicRef",
      "$ref",
    ])
      expect(props.k[keyword]).toBeUndefined()
    expect(props.k.contentSchema).toEqual({})
    expect(props.regex.pattern).toBeUndefined()
    expect(props.valid).toMatchObject({
      minLength: 2,
      maxItems: 3,
      pattern: "^a+$",
      contentEncoding: "base64",
      format: "email",
      uniqueItems: true,
      examples: [1],
    })
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("drops refs that are not resolvable local pointers", () => {
    const schema = emitted({
      type: "object",
      properties: {
        urn: { $ref: "urn:example:x" },
        relative: { $ref: "other.json#/A" },
        absolute: { $ref: "https://example.com/x" },
        local: { $ref: "#/$defs/Kept" },
      },
      $defs: { Kept: { type: "string" } },
    })
    const props = schema.properties as Record<string, Record<string, unknown>>

    expect(props.urn.$ref).toBeUndefined()
    expect(props.relative.$ref).toBeUndefined()
    expect(props.absolute.$ref).toBeUndefined()
    expect(props.local.$ref).toBe("#/$defs/Kept")
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("never emits a schema map whose hostile keys inject a prototype", () => {
    const schema = emitted(
      JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"number"},"prototype":{"type":"boolean"}},"$defs":{"__proto__":{"type":"string"}}}',
      ),
    )
    const properties = schema.properties as Record<string, unknown>
    const defs = schema.$defs as Record<string, unknown>

    expect(Object.hasOwn(properties, "__proto__")).toBe(true)
    expect(Object.hasOwn(properties, "constructor")).toBe(true)
    expect(Object.hasOwn(properties, "prototype")).toBe(true)
    expect(Object.hasOwn(defs, "__proto__")).toBe(true)
    expect(Object.getPrototypeOf(properties)).not.toBe(Object.prototype)
    expect(Object.keys(Object.prototype)).toEqual([])
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("drops keyword values that make the emitted document uncompilable", () => {
    const hostile: Array<[string, Record<string, unknown>]> = [
      ["invalid $anchor", { type: "object", properties: { p: { $anchor: "not valid!" } } }],
      ["invalid $dynamicAnchor", { type: "object", properties: { p: { $dynamicAnchor: "1bad" } } }],
      ["invalid root $anchor", { $anchor: "bad name", type: "object" }],
      ["invalid anchor in $defs", { type: "object", $defs: { D: { $anchor: "1 bad", type: "string" } } }],
      ["$anchor wrong type", { type: "object", properties: { p: { $anchor: 5 } } }],
      ["$schema wrong type", { $schema: 5, type: "object" }],
      ["$schema bogus", { $schema: "bogus", type: "object" }],
      ["$schema unresolvable dialect", { $schema: "https://json-schema.org/draft/2019-09/schema", type: "object" }],
      ["nested bogus $schema", { type: "object", properties: { p: { $schema: "bogus" } } }],
      ["$vocabulary wrong type", { type: "object", $vocabulary: 5 }],
      [
        "$vocabulary non-boolean member",
        { type: "object", $vocabulary: { "https://json-schema.org/draft/2020-12/vocab/core": 5 } },
      ],
      ["invalid patternProperties key", { type: "object", patternProperties: { "(": { type: "string" } } }],
      ["invalid nested patternProperties key", { type: "object", properties: { p: { patternProperties: { "[a": {} } } } }],
      ["non-string title", { type: "object", title: 7 }],
      ["non-string description", { type: "object", description: [] }],
      ["non-string nested title", { type: "object", properties: { p: { title: 7 } } }],
      [
        "malformed urn $id",
        {
          $id: "urn:root",
          type: "object",
          $defs: { A: { type: "string" } },
          properties: { a: { $ref: "#/$defs/A" } },
        },
      ],
      ["interior fragment $id", { $id: "foo#bar", type: "object" }],
      ["$schema inside contentSchema", { type: "object", properties: { p: { contentSchema: { $schema: 5 } } } }],
      [
        "invalid anchor inside contentSchema",
        { type: "object", properties: { p: { contentSchema: { $anchor: "no good" } } } },
      ],
      ["title inside contentSchema", { type: "object", properties: { p: { contentSchema: { title: 7 } } } }],
      [
        "hostile keywords inside $defs and allOf members",
        {
          type: "object",
          $defs: { D: { $schema: "bogus", title: 7, patternProperties: { "(": {} } } },
          properties: { p: { allOf: [{ $anchor: "bad name" }, { $vocabulary: 5 }] } },
        },
      ],
    ]

    for (const [label, input] of hostile) {
      const schema = emitted(input)
      try {
        new Ajv2020({ strict: false }).compile(schema)
      } catch (error) {
        throw new Error(`${label}: ${(error as Error).message}\n${JSON.stringify(schema)}`)
      }
    }
  })

  test("preserves resolvable dialects, anchors, ids and string metadata", () => {
    const schema = emitted({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.com/schema.json",
      title: "Tool",
      description: "A tool",
      type: "object",
      properties: {
        p: {
          $anchor: "good-anchor_1",
          patternProperties: { "^a": { type: "string" } },
        },
        urn: { $id: "urn:example:x", type: "string" },
      },
      $vocabulary: { "https://json-schema.org/draft/2020-12/vocab/core": true, dropped: 5 },
    })

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(schema.$id).toBe("https://example.com/schema.json")
    expect(schema.title).toBe("Tool")
    expect(schema.description).toBe("A tool")
    expect(schema.$vocabulary).toEqual({ "https://json-schema.org/draft/2020-12/vocab/core": true })
    const props = schema.properties as Record<string, Record<string, unknown>>
    expect(props.p.$anchor).toBe("good-anchor_1")
    expect(props.p.patternProperties).toEqual({ "^a": { type: "string" } })
    expect(props.urn.$id).toBe("urn:example:x")
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("sanitizes the same keyword families at every container", () => {
    const schema = emitted({
      type: "object",
      $defs: { D: { title: 7, $anchor: "bad name", patternProperties: { "(": {} } } },
      patternProperties: { "[a": { title: 7 }, "^ok": { $anchor: "fine_1" } },
      properties: { p: { contentSchema: { $schema: 5, title: 7 }, items: { $vocabulary: 5 } } },
    })
    const defs = schema.$defs as Record<string, Record<string, unknown>>
    const patterns = schema.patternProperties as Record<string, Record<string, unknown>>
    const p = (schema.properties as Record<string, Record<string, unknown>>).p

    expect(defs.D.title).toBeUndefined()
    expect(defs.D.$anchor).toBeUndefined()
    expect(defs.D.patternProperties).toEqual({})
    expect(Object.hasOwn(patterns, "[a")).toBe(false)
    expect(patterns["^ok"].$anchor).toBe("fine_1")
    expect((p.contentSchema as Record<string, unknown>).$schema).toBeUndefined()
    expect((p.contentSchema as Record<string, unknown>).title).toBeUndefined()
    expect((p.items as Record<string, unknown>).$vocabulary).toBeUndefined()
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("accepts only refs that resolve from the top-level document", () => {
    const schema = emitted({
      type: "object",
      properties: {
        nestedDefs: { type: "object", $defs: { Inner: { type: "string" } }, $ref: "#/$defs/Inner" },
        enumValue: { $ref: "#/$defs/Fake" },
        badPointer: { $ref: "#/nope/x" },
        goodPointer: { $ref: "#/properties/kept" },
        kept: { type: "string" },
        definitionsMismatch: { $ref: "#/definitions/Only" },
      },
      enum: [{ $defs: { Fake: {} } }],
    })
    const props = schema.properties as Record<string, Record<string, unknown>>

    expect(props.nestedDefs.$ref).toBeUndefined()
    expect(props.enumValue.$ref).toBeUndefined()
    expect(props.badPointer.$ref).toBeUndefined()
    expect(props.definitionsMismatch.$ref).toBeUndefined()
    expect(props.goodPointer.$ref).toBe("#/properties/kept")
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("strips duplicate anchors so the document still compiles", () => {
    const schema = emitted({
      type: "object",
      $anchor: "root_1",
      $defs: { A: { $anchor: "dup_1", type: "string" }, B: { $dynamicAnchor: "dup_1", type: "string" } },
      properties: { p: { $anchor: "dup_1", type: "number" } },
    })
    const defs = schema.$defs as Record<string, Record<string, unknown>>
    const props = schema.properties as Record<string, Record<string, unknown>>

    expect(defs.A.$anchor).toBe("dup_1")
    expect(defs.B.$dynamicAnchor).toBeUndefined()
    expect(props.p.$anchor).toBeUndefined()
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })

  test("retains anchor-form $refs that resolve and prunes the ones that do not", () => {
    const ajv = new Ajv2020({ strict: false })

    const retained = emitted({
      type: "object",
      $defs: { Kind: { $anchor: "Kind", type: "string", enum: ["a", "b"] } },
      properties: { kind: { $ref: "#Kind" } },
    })
    expect((retained.properties as Record<string, Record<string, unknown>>).kind).toEqual({ $ref: "#Kind" })
    expect(() => ajv.compile(retained)).not.toThrow()

    const dynamicTarget = emitted({
      type: "object",
      $defs: { Kind: { $dynamicAnchor: "Kind", type: "string" } },
      properties: { kind: { $ref: "#Kind" } },
    })
    expect((dynamicTarget.properties as Record<string, Record<string, unknown>>).kind).toEqual({ $ref: "#Kind" })
    expect(() => ajv.compile(dynamicTarget)).not.toThrow()

    const inProperty = emitted({
      type: "object",
      properties: { def: { $anchor: "A", type: "string" }, use: { $ref: "#A" } },
    })
    expect((inProperty.properties as Record<string, Record<string, unknown>>).use).toEqual({ $ref: "#A" })
    expect(() => ajv.compile(inProperty)).not.toThrow()

    const pruned = emitted({
      type: "object",
      $anchor: "RootA",
      properties: {
        missing: { $ref: "#Missing" },
        ghost: { $ref: "#Ghost" },
        prefixed: { $ref: "#Pre" },
        rooted: { $ref: "#RootA" },
      },
      enum: [{ $anchor: "Ghost", type: "string" }],
      prefixItems: [{ $anchor: "Pre", type: "string" }],
    })
    const props = pruned.properties as Record<string, Record<string, unknown>>
    expect(props.missing.$ref).toBeUndefined()
    expect(props.ghost.$ref).toBeUndefined()
    expect(props.prefixed.$ref).toBeUndefined()
    expect(props.rooted.$ref).toBeUndefined()
    expect(() => ajv.compile(pruned)).not.toThrow()
  })

  test("scopes anchor-form refs to their $id resource", () => {
    const schema = emitted({
      type: "object",
      $id: "https://example.com/root",
      properties: {
        cross: { $id: "https://example.com/inner", $anchor: "Outer", type: "string" },
        scoped: {
          $id: "https://example.com/other",
          type: "object",
          properties: { def: { $anchor: "Scoped", type: "string" }, use: { $ref: "#Scoped" } },
        },
        refOther: { $ref: "#Scoped" },
        refCross: { $ref: "#Outer" },
      },
    })
    const props = schema.properties as Record<string, Record<string, unknown>>

    expect(props.refOther.$ref).toBeUndefined()
    expect(props.refCross.$ref).toBeUndefined()
    const scoped = props.scoped as Record<string, unknown>
    expect((scoped.properties as Record<string, Record<string, unknown>>).use.$ref).toBe("#Scoped")
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow()
  })
})
