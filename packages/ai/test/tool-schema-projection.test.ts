import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, Tool } from "../src/index.js"
import { AnthropicMessages, Gemini, OpenAIChat, OpenAIResponses } from "../src/protocols.js"
import { ToolSchemaProjection } from "../src/protocols/utils/tool-schema.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { it } from "./lib/effect.js"

describe("tool schema projections", () => {
  test("only normalizes typed empty input structs, preserving raw schemas and output schemas", () => {
    const schema = { not: { type: "null" } }
    const definitions = Tool.toDefinitions({
      typed: Tool.make({
        description: "Typed",
        parameters: Schema.Struct({}),
        success: Schema.Struct({}),
        execute: () => Effect.succeed({}),
      }),
      raw: Tool.make({ description: "Raw", jsonSchema: schema, execute: () => Effect.succeed({}) }),
    })
    expect(definitions[0]?.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false })
    expect(definitions[0]?.outputSchema).toEqual(schema)
    expect(definitions[1]?.inputSchema).toEqual(schema)
  })

  test("retains empty input descriptions and preserves named outputs and explicit raw schemas", () => {
    const parameters = Schema.Struct({}).annotate({ identifier: "Ping", description: "No arguments" })
    const raw = { $ref: "#/$defs/Raw", $defs: { Raw: { not: { type: "null" }, description: "Raw schema" } } }
    const definitions = Tool.toDefinitions({
      typed: Tool.make({ description: "Ping", parameters, success: parameters, execute: () => Effect.succeed({}) }),
      raw: Tool.make({ description: "Raw", jsonSchema: raw, execute: () => Effect.succeed({}) }),
    })
    expect(definitions[0]?.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
      description: "No arguments",
    })
    expect(definitions[0]?.outputSchema).toEqual({
      $ref: "#/$defs/Ping",
      $defs: { Ping: { not: { type: "null" }, description: "No arguments" } },
    })
    expect(definitions[1]?.inputSchema).toEqual(raw)
  })

  const empty = { type: "object", properties: {}, additionalProperties: false }
  const nonempty = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  }
  const raw = { type: "object", properties: { value: { type: "number" } }, additionalProperties: true }

  for (const scenario of [
    {
      route: OpenAIChat.route,
      tools: [empty, nonempty, raw].map((parameters, index) => ({
        type: "function",
        function: { name: ["ping", "lookup", "raw"][index], parameters },
      })),
    },
    {
      route: OpenAIResponses.route,
      tools: [empty, nonempty, raw].map((parameters, index) => ({
        type: "function",
        name: ["ping", "lookup", "raw"][index],
        parameters,
      })),
    },
    {
      route: AnthropicMessages.route,
      tools: [empty, nonempty, raw].map((input_schema, index) => ({
        name: ["ping", "lookup", "raw"][index],
        input_schema,
      })),
    },
    {
      route: Gemini.route,
      tools: [
        {
          functionDeclarations: [
            { name: "ping", description: "Ping" },
            {
              name: "lookup",
              description: "Lookup",
              parameters: {
                type: "object",
                properties: nonempty.properties,
                required: nonempty.required,
              },
            },
            { name: "raw", description: "Raw", parameters: { type: "object", properties: raw.properties } },
          ],
        },
      ],
    },
  ]) {
    for (const input of [
      { name: "plain", schema: Schema.Struct({}) },
      { name: "described", schema: Schema.Struct({}).annotate({ description: "No arguments" }) },
      { name: "named", schema: Schema.Struct({}).annotate({ identifier: "Ping" }) },
      {
        name: "named and described",
        schema: Schema.Struct({}).annotate({ identifier: "Ping", description: "No arguments" }),
      },
    ]) {
      it.effect(
        `${scenario.route.id} prepares ${input.name} empty Effect Struct tools alongside nonempty and raw schemas`,
        () =>
          Effect.gen(function* () {
            const prepared = yield* compileRequest(
              LLM.request({
                model: scenario.route.with({ auth: Auth.bearer("test") }).model({ id: "test-model" }),
                prompt: "Use a tool.",
                tools: Tool.toDefinitions({
                  ping: Tool.make({
                    description: "Ping",
                    parameters: input.schema,
                    success: Schema.String,
                    execute: () => Effect.succeed("pong"),
                  }),
                  lookup: Tool.make({
                    description: "Lookup",
                    parameters: Schema.Struct({ query: Schema.String }),
                    success: Schema.String,
                    execute: (input) => Effect.succeed(input.query),
                  }),
                  raw: Tool.make({ description: "Raw", jsonSchema: raw, execute: () => Effect.succeed("raw") }),
                }),
              }),
            )
            expect(prepared.body.tools).toMatchObject(scenario.tools)
            if (scenario.route.id === "gemini") {
              expect(prepared.body.tools).toEqual(scenario.tools)
            }
          }),
      )
    }
  }

  test("moonshot strips $ref siblings and converts tuple arrays to a schema object", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          linked: { $ref: "#/$defs/Linked", description: "drop me" },
          tuple: { type: "array", items: [{ type: "string" }, { type: "number" }] },
          prefixTuple: { type: "array", prefixItems: [{ type: "boolean" }, { type: "string" }] },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        linked: { $ref: "#/$defs/Linked" },
        tuple: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
        prefixTuple: { type: "array", items: { anyOf: [{ type: "boolean" }, { type: "string" }] } },
      },
    })
  })

  test("moonshot derives a type for untyped enums", () => {
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
        mixed: { enum: ["a", 1] },
      },
      $defs: { Mode: { type: "string", enum: ["fast"] } },
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

  it.effect("applies model compatibility without changing schema semantics", () =>
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
                      linked: { $ref: "#/$defs/Linked", description: "drop me" },
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
              tuple: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
              linked: { $ref: "#/$defs/Linked" },
            },
          },
        ],
      })
    }),
  )
})
