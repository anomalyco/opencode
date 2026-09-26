import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM } from "../src/index.js"
import { OpenAIChat } from "../src/protocols.js"
import { ToolSchemaProjection } from "../src/protocols/utils/tool-schema.js"
import { Tool, toDefinitions } from "../src/tool.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { it } from "./lib/effect.js"

describe("tool schema projections", () => {
  test("moonshot keeps $ref siblings and converts tuples to one items schema", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          linked: { $ref: "#/$defs/Linked", description: "keep me" },
          tuple: { type: "array", items: [{ type: "string" }, { type: "number" }] },
          tupleRest: { type: "array", items: [{ type: "string" }], additionalItems: { type: "integer" } },
          prefixTuple: { type: "array", prefixItems: [{ type: "boolean" }, { type: "string" }] },
          closedTuple: { type: "array", prefixItems: [{ type: "boolean" }, { type: "string" }], items: false },
          closedDraft07: { type: "array", items: [{ type: "boolean" }], additionalItems: false },
          prefixRest: { type: "array", prefixItems: [true, { type: "number" }], items: { type: "string" } },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        linked: { $ref: "#/$defs/Linked", description: "keep me" },
        tuple: { type: "array", items: {} },
        tupleRest: { type: "array", items: { anyOf: [{ type: "string" }, { type: "integer" }] } },
        prefixTuple: { type: "array", prefixItems: [{ type: "boolean" }, { type: "string" }], items: {} },
        closedTuple: {
          type: "array",
          prefixItems: [{ type: "boolean" }, { type: "string" }],
          maxItems: 2,
          items: { anyOf: [{ type: "boolean" }, { type: "string" }] },
        },
        closedDraft07: { type: "array", maxItems: 1, items: { type: "boolean" } },
        prefixRest: {
          type: "array",
          prefixItems: [{}, { type: "number" }],
          items: { anyOf: [{}, { type: "number" }, { type: "string" }] },
        },
      },
    })
  })

  test("moonshot rewrites literals, described references, and boolean schemas it drops or rejects", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          kind: { type: "string", const: "a" },
          untyped: { const: 1 },
          parent: { allOf: [{ $ref: "#/$defs/Parent" }], description: "The parent" },
          closed: { allOf: [{ $ref: "#/$defs/Parent" }], additionalProperties: false },
          anything: true,
          list: { type: "array", items: true },
        },
        $defs: { Parent: { type: "object", properties: { name: { type: "string" } } }, Any: true },
      }),
    ).toEqual({
      type: "object",
      properties: {
        kind: { type: "string", enum: ["a"] },
        untyped: { type: "number", enum: [1] },
        parent: { $ref: "#/$defs/Parent", description: "The parent" },
        closed: { allOf: [{ $ref: "#/$defs/Parent" }], additionalProperties: false },
        anything: {},
        list: { type: "array", items: {} },
      },
      $defs: { Parent: { type: "object", properties: { name: { type: "string" } } }, Any: {} },
    })
  })

  test("moonshot moves a $ref beside anyOf into each branch", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          bounded: { $ref: "#/$defs/Name", description: "Name", anyOf: [{ minLength: 1 }, { maxLength: 3 }] },
          mixed: { $ref: "#/$defs/Name", enum: ["a", 1] },
        },
        $defs: { Name: { type: "string" } },
      }),
    ).toEqual({
      type: "object",
      properties: {
        bounded: {
          description: "Name",
          anyOf: [
            { $ref: "#/$defs/Name", minLength: 1 },
            { $ref: "#/$defs/Name", maxLength: 3 },
          ],
        },
        mixed: {
          anyOf: [
            { $ref: "#/$defs/Name", type: "string", enum: ["a"] },
            { $ref: "#/$defs/Name", type: "number", enum: [1] },
          ],
        },
      },
      $defs: { Name: { type: "string" } },
    })
  })

  test("moonshot leaves property names and literal values alone", () => {
    const schema = {
      type: "object",
      properties: {
        const: { type: "string" },
        prefixItems: { type: "string" },
        allOf: { type: "string" },
        enum: { type: "string" },
        list: { type: "array", items: { type: "number" }, default: { items: [1, 2] }, examples: [{ const: 1 }] },
        sample: { type: "object", example: { enum: ["a", 1] } },
      },
    }
    expect(ToolSchemaProjection.moonshot(schema)).toEqual(schema)
  })

  test("moonshot types enums and splits mixed ones", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          kind: { description: "The kind of flag", enum: ["boolean", "string"] },
          level: { enum: [1, 2.5] },
          optional: { enum: [null, "a"] },
          choice: { anyOf: [{ enum: [true, false] }, { type: "null" }] },
          list: { type: "array", items: { enum: ["x"] } },
          map: { type: "object", additionalProperties: { enum: ["y"] } },
          typed: { type: "string", enum: ["a", null] },
          mixed: { enum: ["a", 1] },
          mixedNullable: { description: "Mixed", enum: ["a", 1, null] },
          typeList: { type: ["string", "integer"], enum: ["a", 1] },
          inUnion: {
            anyOf: [
              { type: "string", minLength: 2 },
              { type: "number", minimum: 0 },
            ],
            enum: ["ok", 1],
          },
          nullableList: { type: ["integer", "null"], enum: [1, null] },
          narrowedList: { type: ["string", "null"], enum: ["a", 1] },
          onlyNull: { enum: [null] },
          empty: { enum: [] },
        },
        $defs: { Mode: { enum: ["fast"] } },
      }),
    ).toEqual({
      type: "object",
      properties: {
        kind: { type: "string", description: "The kind of flag", enum: ["boolean", "string"] },
        level: { type: "number", enum: [1, 2.5] },
        optional: { type: ["string", "null"], enum: [null, "a"] },
        choice: { anyOf: [{ type: "boolean", enum: [true, false] }, { type: "null" }] },
        list: { type: "array", items: { type: "string", enum: ["x"] } },
        map: { type: "object", additionalProperties: { type: "string", enum: ["y"] } },
        typed: { type: "string", enum: ["a", null] },
        mixed: {
          anyOf: [
            { type: "string", enum: ["a"] },
            { type: "number", enum: [1] },
          ],
        },
        mixedNullable: {
          description: "Mixed",
          anyOf: [{ type: "string", enum: ["a"] }, { type: "number", enum: [1] }, { type: "null" }],
        },
        typeList: {
          anyOf: [
            { type: "string", enum: ["a"] },
            { type: "integer", enum: [1] },
          ],
        },
        inUnion: {
          anyOf: [
            { type: "string", minLength: 2, enum: ["ok"] },
            { type: "number", minimum: 0, enum: [1] },
          ],
        },
        nullableList: { type: ["integer", "null"], enum: [1, null] },
        narrowedList: { type: ["string", "null"], enum: ["a", 1] },
        onlyNull: { type: "null", enum: [null] },
        empty: { enum: [] },
      },
      $defs: { Mode: { type: "string", enum: ["fast"] } },
    })
  })

  it.effect("declares every tool schema root as an object", () =>
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({
        endpoint: { baseURL: "https://api.openai.test/v1/" },
        auth: Auth.bearer("test"),
      })
      const parameters = (inputSchema: Record<string, unknown>, model = route.model({ id: "gpt-6-luna" })) =>
        compileRequest(
          LLM.request({
            model,
            prompt: "Use the tool.",
            tools: [{ name: "lookup", description: "Lookup data.", inputSchema }],
          }),
        ).pipe(Effect.map((prepared) => prepared.body.tools?.[0]?.function.parameters))
      const parameterless = toDefinitions({
        lookup: Tool.make({
          description: "Lookup data.",
          parameters: Schema.Struct({}).annotate({ description: "No input." }),
          success: Schema.String,
        }),
      })[0].inputSchema
      const union = {
        anyOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "string" } } },
        ],
      }
      const exclusive = { oneOf: [{ type: "object" }, { type: "object", required: ["a"] }] }
      const object = { type: "object", properties: {} }

      expect(yield* parameters(parameterless)).toEqual({ type: "object", description: "No input." })
      expect(yield* parameters({})).toEqual({ type: "object" })
      expect(yield* parameters({ description: "Query", properties: { q: { type: "string" } } })).toEqual({
        type: "object",
        description: "Query",
        properties: { q: { type: "string" } },
      })
      expect(yield* parameters(union)).toEqual({ type: "object", ...union })
      expect(yield* parameters(exclusive)).toEqual({ type: "object", ...exclusive })
      expect(yield* parameters(object)).toEqual(object)
      expect(yield* parameters({}, route.model({ id: "gpt-6-luna", compatibility: { sanitizer: "none" } }))).toEqual({
        type: "object",
      })
      expect(yield* parameters({ properties: { mode: { enum: ["fast"] } } }, route.model({ id: "kimi-k3" }))).toEqual({
        type: "object",
        properties: { mode: { type: "string", enum: ["fast"] } },
      })
    }),
  )
  test("moonshot keeps accepted $ref and allOf shapes accepted", () => {
    const $defs = {
      Union: { anyOf: [{ type: "string" }, { type: "null" }] },
      Alias: { $ref: "#/$defs/Union" },
      Name: { type: "string" },
    }
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          union: { $ref: "#/$defs/Alias", anyOf: [{ type: "string" }, { type: "null" }] },
          literal: { $ref: "#/$defs/Union", const: "a" },
          bounded: { $ref: "#/$defs/Name", anyOf: [{ minLength: 1 }, { maxLength: 3 }] },
        },
        patternProperties: { "^x": { allOf: [{ $ref: "#/$defs/Name" }], description: "ignored by Moonshot" } },
        $defs,
      }),
    ).toEqual({
      type: "object",
      properties: {
        union: { $ref: "#/$defs/Alias", anyOf: [{ type: "string" }, { type: "null" }] },
        literal: { $ref: "#/$defs/Union", const: "a" },
        bounded: {
          anyOf: [
            { $ref: "#/$defs/Name", minLength: 1 },
            { $ref: "#/$defs/Name", maxLength: 3 },
          ],
        },
      },
      patternProperties: { "^x": { allOf: [{ $ref: "#/$defs/Name" }], description: "ignored by Moonshot" } },
      $defs,
    })
  })

  test("moonshot does not expose ignored invalid branches to validation", () => {
    const schema = {
      type: "object",
      properties: {
        nullable: { type: ["string", "null"], minLength: null },
        intersection: {
          allOf: [
            { type: "object", properties: { disabled: false } },
            { type: "object", properties: { enabled: { type: "string" } } },
          ],
        },
        tagged: {
          oneOf: [
            {
              type: "object",
              properties: { kind: { type: "string", enum: ["a"] }, disabled: false },
              required: ["kind"],
            },
            { type: "object", properties: { kind: { type: "string", enum: ["b"] } }, required: ["kind"] },
          ],
        },
      },
    }
    expect(ToolSchemaProjection.moonshot(schema)).toEqual(schema)
  })

  test("moonshot handles boolean branches and tuple bounds", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          choice: { anyOf: [{ type: "string" }, true, false] },
          blocked: { type: "array", prefixItems: [{ type: "string" }, false] },
          extra: { type: "array", items: [{ type: "string" }], additionalItems: true },
          literal: { type: "string", const: "a", enum: ["a", "b"] },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        choice: { anyOf: [{ type: "string" }, {}] },
        blocked: { type: "array", prefixItems: [{ type: "string" }, false], maxItems: 1, items: { type: "string" } },
        extra: { type: "array", items: {} },
        literal: { type: "string", enum: ["a"] },
      },
    })
  })

  test("moonshot supports tagged unions, nullable constraints, and integer bounds", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          pet: { $ref: "#/$defs/Pet" },
          optional: { type: ["string", "null"], minLength: 2, default: null },
          count: { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 4.5 },
          merged: {
            allOf: [
              { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
              { type: "object", properties: { b: { type: "number" } } },
            ],
          },
          untouched: {
            allOf: [
              { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
              { type: "object", properties: { b: { type: "number" } } },
            ],
          },
        },
        $defs: {
          Pet: { oneOf: [{ $ref: "#/$defs/Cat" }, { $ref: "#/$defs/Dog" }], discriminator: { propertyName: "kind" } },
          Cat: { type: "object", required: ["kind"], properties: { kind: { type: "string", const: "cat" } } },
          Dog: { type: "object", required: ["kind"], properties: { kind: { type: "string", const: "dog" } } },
          Any: { title: "Arbitrary JSON" },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        pet: { $ref: "#/$defs/Pet" },
        optional: {
          default: null,
          anyOf: [
            { type: "string", minLength: 2 },
            { type: "null", minLength: 2 },
          ],
        },
        count: { type: "integer", minimum: 1, maximum: 4 },
        merged: { type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"] },
        untouched: {
          allOf: [
            { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
            { type: "object", properties: { b: { type: "number" } } },
          ],
        },
      },
      $defs: {
        Pet: { discriminator: { propertyName: "kind" }, anyOf: [{ $ref: "#/$defs/Cat" }, { $ref: "#/$defs/Dog" }] },
        Cat: { type: "object", required: ["kind"], properties: { kind: { type: "string", enum: ["cat"] } } },
        Dog: { type: "object", required: ["kind"], properties: { kind: { type: "string", enum: ["dog"] } } },
        Any: { title: "Arbitrary JSON", type: ["null", "boolean", "object", "array", "number", "string"] },
      },
    })
  })

  it.effect("selects tool schema handling from the model name unless compatibility is explicit", () =>
    Effect.gen(function* () {
      const route = OpenAIChat.route.with({
        endpoint: { baseURL: "https://api.openai.test/v1/" },
        auth: Auth.bearer("test"),
      })
      const original = {
        type: "object",
        required: ["mode", "missing"],
        properties: { mode: { enum: ["fast", "safe"] } },
      }
      const parameters = (model: ReturnType<typeof route.model>) =>
        compileRequest(
          LLM.request({
            model,
            prompt: "Use the tool.",
            tools: [{ name: "lookup", description: "Lookup data.", inputSchema: original }],
          }),
        ).pipe(Effect.map((prepared) => prepared.body.tools?.[0]?.function.parameters))
      const gemini = { ...original, required: ["mode"] }
      const moonshot = { ...original, properties: { mode: { type: "string", enum: ["fast", "safe"] } } }

      expect(yield* parameters(route.model({ id: "google/Gemini-3.8-Flash" }))).toEqual(gemini)
      expect(
        yield* parameters(route.model({ id: "my-tuned-endpoint", compatibility: { sanitizer: "gemini" } })),
      ).toEqual(gemini)
      expect(
        yield* parameters(route.model({ id: "google/gemini-3.8-flash", compatibility: { sanitizer: "moonshot" } })),
      ).toEqual(moonshot)
      expect(yield* parameters(route.model({ id: "moonshotai/Kimi-K3" }))).toEqual(moonshot)
      expect(
        yield* parameters(route.model({ id: "google/gemini-3.8-flash", compatibility: { sanitizer: "none" } })),
      ).toEqual(original)
      expect(
        yield* parameters(route.model({ id: "moonshotai/Kimi-K3", compatibility: { sanitizer: "none" } })),
      ).toEqual(original)
      expect(yield* parameters(route.model({ id: "gpt-6-luna" }))).toEqual(original)
    }),
  )

  it.effect("applies model compatibility to nested schemas", () =>
    Effect.gen(function* () {
      const model = OpenAIChat.route
        .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
        .model({ id: "kimi-k2", compatibility: { sanitizer: "moonshot" } })
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Use the tool.",
          tools: [
            {
              name: "lookup",
              description: "Lookup data.",
              inputSchema: {
                type: "object",
                anyOf: [
                  {
                    type: "object",
                    properties: {
                      tuple: { type: "array", items: [{ type: "string" }, { type: "number" }] },
                      linked: { $ref: "#/$defs/Linked", description: "keep me" },
                    },
                  },
                ],
              },
            },
          ],
        }),
      )

      expect(prepared.body.tools?.[0]?.function.parameters).toEqual({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: {
              tuple: { type: "array", items: {} },
              linked: { $ref: "#/$defs/Linked", description: "keep me" },
            },
          },
        ],
      })
    }),
  )
})
