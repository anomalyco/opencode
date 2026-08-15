import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ToolRegistry } from "@/tool/registry"
import { ToolJsonSchema } from "@/tool/json-schema"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

function model(id: string, extra?: Partial<Provider.Model>) {
  return {
    providerID: "local",
    api: { id, url: "http://localhost:8080/v1", npm: "@ai-sdk/openai-compatible" },
    ...extra,
  } as Provider.Model
}

// Walks a sanitized schema and returns the paths of grammar-unsafe keywords.
// The `properties` / `$defs` / `definitions` maps are traversed by value only,
// so an argument named "pattern" (grep, glob) is not a violation.
function violations(node: unknown, at: string): string[] {
  if (Array.isArray(node)) return node.flatMap((item, index) => violations(item, `${at}[${index}]`))
  if (typeof node !== "object" || node === null) return []
  const record = node as Record<string, unknown>
  const bad = ["format", "pattern", "anyOf", "oneOf", "allOf", "$ref", "$defs", "definitions"]
    .filter((key) => key in record)
    .map((key) => `${at}.${key}`)
  if ("additionalProperties" in record && typeof record.additionalProperties !== "boolean") {
    bad.push(`${at}.additionalProperties(non-boolean)`)
  }
  if (Array.isArray(record.items)) bad.push(`${at}.items(tuple)`)
  const nested = Object.entries(record).flatMap(([key, value]) => {
    if (key === "properties" && typeof value === "object" && value !== null) {
      return Object.entries(value).flatMap(([name, item]) => violations(item, `${at}.properties.${name}`))
    }
    return violations(value, `${at}.${key}`)
  })
  return [...bad, ...nested]
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([ToolRegistry.node, Agent.node]), [
    [
      Config.node,
      TestConfig.layer({
        directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
      }),
    ],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ]),
)

afterEach(async () => {
  await disposeAllInstances()
})

describe("provider.transform tier schemas", () => {
  it.instance("every built-in tool schema is grammar-safe on the minimal tier", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.make("local"),
        modelID: ModelV2.ID.make("qwen3.5-4b"),
        agent: yield* agents.defaultInfo(),
      })

      for (const item of tools) {
        const sanitized = ProviderTransform.schema(model("qwen3.5-4b"), ToolJsonSchema.fromTool(item))
        expect(violations(sanitized, item.id)).toEqual([])
      }
    }),
  )

  test("extended sanitizer inlines refs, flattens unions, and coerces keywords", () => {
    const input = {
      type: "object",
      $defs: {
        item: { type: "string", pattern: "^[a-z]+$", format: "uri" },
      },
      properties: {
        one: { $ref: "#/$defs/item", description: "a ref" },
        two: { anyOf: [{ type: "null" }, { type: "number" }] },
        three: { type: "object", additionalProperties: { type: "string" } },
        four: { type: "array", items: [{ type: "string" }, { type: "number" }] },
      },
      required: ["one"],
    } as unknown as JSONSchema7

    const result = ProviderTransform.schema(model("qwen3.6-35b-a3b"), input) as Record<string, any>
    expect(violations(result, "root")).toEqual([])
    expect(result.properties.one).toEqual({ type: "string", description: "a ref" })
    expect(result.properties.two).toEqual({ type: "number" })
    expect(result.properties.three.additionalProperties).toBe(true)
    expect(result.properties.four.items).toEqual({ type: "string" })
  })

  test("vendor models keep their existing schema behavior", () => {
    const input = {
      type: "object",
      properties: {
        value: { type: "string", format: "uri", pattern: "^https://" },
        union: { anyOf: [{ type: "string" }, { type: "number" }] },
      },
    } as unknown as JSONSchema7

    const claude = ProviderTransform.schema(
      model("claude-sonnet-4-5", {
        api: { id: "claude-sonnet-4-5", url: "", npm: "@ai-sdk/anthropic" },
      } as Partial<Provider.Model>),
      input,
    )
    expect(claude).toEqual(input)

    const kimiInput = {
      type: "object",
      $defs: { foo: { type: "string" } },
      properties: {
        a: { $ref: "#/$defs/foo", description: "sibling" },
      },
    } as unknown as JSONSchema7
    const kimi = ProviderTransform.schema(
      model("kimi-k2-thinking", {
        api: { id: "kimi-k2-thinking", url: "http://localhost:8080/v1", npm: "@ai-sdk/openai-compatible" },
      } as Partial<Provider.Model>),
      kimiInput,
    ) as Record<string, any>
    // kimi keeps the moonshot sanitizer: $ref survives, sibling keywords are stripped.
    expect(kimi.properties.a).toEqual({ $ref: "#/$defs/foo" })
    expect(kimi.$defs).toEqual({ foo: { type: "string" } })
  })
})
