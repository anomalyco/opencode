import { expect, test } from "bun:test"
import { CopilotModels } from "@/plugin/github-copilot/models"
import { Provider } from "@/provider/provider"
import { usable } from "@/session/overflow"

function model(id = "gpt-test", messages = false) {
  return {
    id,
    name: id,
    version: `${id}-2026-10-01`,
    model_picker_enabled: true,
    supported_endpoints: [messages ? "/v1/messages" : "/responses"],
    billing: {
      token_prices: {
        batch_size: 1_000_000,
        default: {
          context_max: 272_000,
          input_price: 200,
          cache_price: 10,
          cache_write_price: 250,
          output_price: 1000,
        },
        long_context: {
          context_max: 922_000,
          input_price: 400,
          cache_price: 20,
          cache_write_price: 500,
          output_price: 1500,
        },
      },
    },
    capabilities: {
      family: messages ? "claude" : "gpt",
      limits: {
        max_context_window_tokens: 1_050_000,
        max_prompt_tokens: 922_000,
        max_output_tokens: 128_000,
      },
      supports: {
        tool_calls: true,
        reasoning_effort: ["low", "medium", "high"],
        ...(messages ? { adaptive_thinking: true } : {}),
      },
    },
  }
}

test.each([false, true])(
  "discovers context budgets and prices without changing model routing, messages=%s",
  async (messages) => {
    const remote = model(messages ? "claude-test" : "gpt-test", messages)
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe("/models")
        expect(request.headers.get("authorization")).toBe("Bearer test-token")
        return Response.json({ data: [remote] })
      },
    })
    const result = await CopilotModels.get(server.url.origin, { Authorization: "Bearer test-token" })
    const standard = result.models[remote.id]
    expect(standard.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(standard.cost).toEqual({
      input: 2,
      output: 10,
      cache: { read: 0.1, write: 2.5 },
      tiers: [{ input: 4, output: 15, cache: { read: 0.2, write: 5 }, tier: { type: "context", size: 272_000 } }],
    })
    expect(result.models[`${remote.id}--long`].limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
    expect(result.models[`${remote.id}--long`].name).toContain("Long 922K | $4/$15 per 1M in/out")
    for (const entry of Object.values(result.models)) {
      expect(entry.api.id).toBe(remote.id)
      expect(entry.api.url).toBe(`${server.url.origin}${messages ? "/v1" : ""}`)
      expect(entry.api.npm).toBe(messages ? "@ai-sdk/anthropic" : "@ai-sdk/github-copilot")
      expect(entry.variants).toEqual(standard.variants)
      expect(entry.cost).toEqual(standard.cost)
      expect(result.pickerEnabled.has(entry.api.id)).toBe(true)
    }
    expect(standard.variants?.medium).toMatchObject(messages ? { effort: "medium" } : { reasoningEffort: "medium" })
  },
)

test("retains models with old pricing and no context tier metadata", async () => {
  const remote = model()
  using server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        data: [
          {
            ...remote,
            billing: {
              token_prices: { batch_size: 500_000, default: { input_price: 200, output_price: 1000, cache_price: 10 } },
            },
          },
        ],
      })
    },
  })
  const result = await CopilotModels.get(server.url.origin)
  expect(Object.keys(result.models)).toEqual([remote.id])
  expect(result.models[remote.id].limit.input).toBe(922_000)
  expect(result.models[remote.id].cost).toEqual({ input: 4, output: 20, cache: { read: 0.2, write: 0 } })
})

test("supports alternate cache-read and context boundary fields", async () => {
  const remote = model()
  const { context_max, cache_price, ...standard } = remote.billing.token_prices.default
  using server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        data: [
          {
            ...remote,
            billing: {
              token_prices: {
                ...remote.billing.token_prices,
                default: { ...standard, max_prompt_tokens: context_max, cache_read_price: cache_price },
              },
            },
          },
        ],
      })
    },
  })
  const result = await CopilotModels.get(server.url.origin)
  expect(result.models[remote.id].limit.input).toBe(272_000)
  expect(result.models[remote.id].cost.cache.read).toBe(0.1)
  expect(result.models[remote.id].cost.tiers?.[0].tier.size).toBe(272_000)
})

test("does not expose extra context choices for disabled or utility models", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        data: [
          { ...model("disabled"), policy: { state: "disabled" } },
          { ...model("utility"), model_picker_enabled: false },
        ],
      })
    },
  })
  const result = await CopilotModels.get(server.url.origin)
  expect(Object.keys(result.models)).toEqual(["utility"])
  expect(result.pickerEnabled.size).toBe(0)
})

test("preserves fast mode routing and uses its own advertised prices", async () => {
  const regular = model("claude-test", true)
  const fast = {
    ...model("claude-test-fast", true),
    billing: {
      token_prices: {
        ...regular.billing.token_prices,
        default: { ...regular.billing.token_prices.default, input_price: 1000, output_price: 5000 },
        long_context: { ...regular.billing.token_prices.long_context, input_price: 1000, output_price: 5000 },
      },
    },
  }
  using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [regular, fast] }) })
  const existing = (await CopilotModels.get(server.url.origin)).models[regular.id]
  const result = await CopilotModels.get(
    server.url.origin,
    {},
    {
      [fast.id]: {
        ...existing,
        id: fast.id,
        name: "Claude Fast",
        options: { speed: "fast" },
        headers: { "anthropic-beta": "fast-mode" },
      },
    },
  )
  for (const id of [fast.id, `${fast.id}--long`]) {
    expect(result.models[id].api.id).toBe(regular.id)
    expect(result.models[id].options).toEqual({ speed: "fast" })
    expect(result.models[id].headers).toEqual({ "anthropic-beta": "fast-mode" })
    expect(result.models[id].cost.input).toBe(10)
    expect(result.models[id].cost.output).toBe(50)
    expect(result.models[id].name).toContain("Claude Fast")
  }
})

test("clamps default input budgets and only creates supported choices", async () => {
  const remote = model()
  using server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        data: [
          {
            ...remote,
            capabilities: {
              ...remote.capabilities,
              limits: { ...remote.capabilities.limits, max_prompt_tokens: 80_000 },
            },
          },
        ],
      }),
  })
  const result = await CopilotModels.get(server.url.origin)
  expect(Object.keys(result.models)).toEqual([remote.id])
  expect(result.models[remote.id].limit.input).toBe(80_000)
})

test("refreshes choices without accumulating aliases and removes unsupported tiers", async () => {
  const remote = model()
  using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote] }) })
  const first = await CopilotModels.get(server.url.origin)
  const second = await CopilotModels.get(server.url.origin, {}, first.models)
  expect(second).toEqual(first)
  remote.capabilities.limits.max_prompt_tokens = 80_000
  const reduced = await CopilotModels.get(server.url.origin, {}, second.models)
  expect(Object.keys(reduced.models)).toEqual([remote.id])
  expect(reduced.models[remote.id].limit.input).toBe(80_000)
})

test("prefers Default in automatic model selection and applies each compaction budget", async () => {
  const remote = model()
  using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote] }) })
  const result = await CopilotModels.get(server.url.origin)
  expect(Provider.sort(Object.values(result.models))[0].id).toBe(remote.id)
  for (const [id, budget] of [
    [remote.id, 252_000],
    [`${remote.id}--long`, 902_000],
  ] as const) {
    expect(usable({ cfg: {}, model: result.models[id] as Provider.Model })).toBe(budget)
  }
})

test("does not overwrite endpoint models whose IDs collide with context suffixes", async () => {
  const remote = model()
  const collision = { ...model(`${remote.id}--long`), billing: undefined }
  using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote, collision] }) })
  const first = await CopilotModels.get(server.url.origin)
  expect(first.models[collision.id].api.id).toBe(collision.id)
  expect(first.models[collision.id].limit.input).toBe(922_000)
  expect(await CopilotModels.get(server.url.origin, {}, first.models)).toEqual(first)
})

test("retains catalog fast-mode prices when the API only advertises the regular model", async () => {
  const remote = model("claude-test", true)
  using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote] }) })
  const regular = (await CopilotModels.get(server.url.origin)).models[remote.id]
  const fast = {
    ...regular,
    id: "claude-test-fast",
    name: "Claude Fast",
    options: { speed: "fast" },
    cost: {
      input: 10,
      output: 50,
      cache: { read: 1, write: 12.5 },
    },
  }
  const result = await CopilotModels.get(server.url.origin, {}, { [fast.id]: fast })
  expect(result.models[fast.id].cost).toEqual(fast.cost)
  expect(result.models[`${fast.id}--long`]).toBeUndefined()
  expect(result.models[fast.id].name).toBe("Claude Fast")
})
