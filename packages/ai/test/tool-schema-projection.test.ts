import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../src/index.js"
import { OpenAIChat } from "../src/protocols.js"
import { ToolSchemaProjection } from "../src/protocols/utils/tool-schema.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { it } from "./lib/effect.js"

describe("tool schema projections", () => {
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
        yield* parameters(route.model({ id: "google/gemini-3.8-flash", compatibility: { sanitizer: false } })),
      ).toEqual(original)
      expect(yield* parameters(route.model({ id: "moonshotai/Kimi-K3", compatibility: { sanitizer: false } }))).toEqual(
        original,
      )
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
