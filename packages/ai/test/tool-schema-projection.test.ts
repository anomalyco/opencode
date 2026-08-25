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

  test("gemini handles numeric enums, dangling required fields, untyped arrays, and scalar object keys", () => {
    expect(
      ToolSchemaProjection.gemini({
        type: "object",
        required: ["status", "missing"],
        properties: {
          status: { type: "integer", enum: [1, 2] },
          tags: { type: "array" },
          name: { type: "string", properties: { ignored: { type: "string" } }, required: ["ignored"] },
        },
      }),
    ).toEqual({
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["1", "2"] },
        tags: { type: "array", items: { type: "string" } },
        name: { type: "string" },
      },
    })
  })

  it.effect("applies model compatibility without changing schema semantics", () =>
    Effect.gen(function* () {
      const model = OpenAIChat.route
        .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
        .model({ id: "kimi-k2", compatibility: { toolSchema: "moonshot" } })
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
