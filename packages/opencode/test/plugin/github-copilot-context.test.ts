import { expect, test } from "bun:test"
import { CopilotModels } from "@/plugin/github-copilot/models"
import { Provider } from "@/provider/provider"
import { isOverflow, usable } from "@/session/overflow"

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
    expect(Object.keys(result.models)).toEqual([remote.id])
    expect([...result.pickerEnabled]).toEqual([remote.id])
    const standard = result.models[remote.id]
    expect(standard.name).toBe(remote.name)
    expect(standard.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
    expect(standard.options.copilotContext).toEqual({ default: 272_000, long: 922_000 })
    expect(standard.cost).toEqual({
      input: 2,
      output: 10,
      cache: { read: 0.1, write: 2.5 },
      tiers: [{ input: 4, output: 15, cache: { read: 0.2, write: 5 }, tier: { type: "context", size: 272_000 } }],
    })
    expect(standard.api).toMatchObject({
      id: remote.id,
      url: `${server.url.origin}${messages ? "/v1" : ""}`,
      npm: messages ? "@ai-sdk/anthropic" : "@ai-sdk/github-copilot",
    })
    expect("endpoint" in standard.api ? standard.api.endpoint : undefined).toBe(messages ? "messages" : "responses")
    expect(Object.keys(standard.variants ?? {}).sort()).toEqual([
      "default@default",
      "default@long",
      "high",
      "high@default",
      "high@long",
      "low",
      "low@default",
      "low@long",
      "medium",
      "medium@default",
      "medium@long",
    ])
    for (const effort of ["low", "medium", "high"]) {
      const reasoning = messages
        ? { thinking: { type: "adaptive", display: "summarized" }, effort }
        : { reasoningEffort: effort, reasoningSummary: "auto", include: ["reasoning.encrypted_content"] }
      expect(standard.variants?.[effort]).toEqual(reasoning)
      for (const tier of ["default", "long"] as const) {
        expect(standard.variants?.[`${effort}@${tier}`]).toEqual({ copilotContextTier: tier })
        const effective = CopilotModels.context(standard, `${effort}@${tier}`)
        expect(effective.limit).toEqual({
          context: tier === "long" ? 1_050_000 : 400_000,
          input: tier === "long" ? 922_000 : 272_000,
          output: 128_000,
        })
        expect(effective.api).toEqual(standard.api)
        expect(effective.cost).toEqual(standard.cost)
        expect(effective.name).toBe(remote.name)
      }
    }
    for (const tier of ["default", "long"]) {
      expect(standard.variants?.[`default@${tier}`]).toEqual({ copilotContextTier: tier })
    }
    for (const variant of [undefined, "medium", "default@default", "unknown"]) {
      expect(CopilotModels.context(standard, variant).limit).toEqual({
        context: 400_000,
        input: 272_000,
        output: 128_000,
      })
    }
    expect(CopilotModels.context(standard, "default@long").limit.input).toBe(922_000)
    expect(standard.limit.input).toBe(922_000)
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
  expect(result.models[remote.id].options.copilotContext).toBeUndefined()
  expect(Object.keys(result.models[remote.id].variants ?? {})).toEqual(["low", "medium", "high"])
  expect(CopilotModels.context(result.models[remote.id], "medium@long")).toBe(result.models[remote.id])
})

test("does not add context choices without long-context pricing", async () => {
  const remote = model()
  using server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        data: [
          {
            ...remote,
            billing: { token_prices: { batch_size: 1_000_000, default: remote.billing.token_prices.default } },
          },
        ],
      }),
  })
  const result = await CopilotModels.get(server.url.origin)
  const entry = result.models[remote.id]
  expect(Object.keys(result.models)).toEqual([remote.id])
  expect(entry.name).toBe(remote.name)
  expect(entry.options.copilotContext).toBeUndefined()
  expect(entry.cost.tiers).toBeUndefined()
  expect(CopilotModels.context(entry, "default@long")).toBe(entry)
})

test("preserves explicit thinking budgets in both context choices", async () => {
  const remote = model("claude-budget", true)
  using server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        data: [
          {
            ...remote,
            capabilities: {
              ...remote.capabilities,
              supports: { tool_calls: true, min_thinking_budget: 1024, max_thinking_budget: 32_000 },
            },
          },
        ],
      }),
  })
  const entry = (await CopilotModels.get(server.url.origin)).models[remote.id]
  for (const [effort, budgetTokens] of [
    ["high", 16_000],
    ["max", 31_999],
  ] as const) {
    expect(entry.variants?.[effort]).toEqual({ thinking: { type: "enabled", budgetTokens } })
    for (const tier of ["default", "long"]) {
      expect(entry.variants?.[`${effort}@${tier}`]).toEqual({ copilotContextTier: tier })
      expect(CopilotModels.context(entry, `${effort}@${tier}`).limit.input).toBe(tier === "long" ? 922_000 : 272_000)
    }
  }
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
  expect(CopilotModels.context(result.models[remote.id]).limit.input).toBe(272_000)
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
  expect(result.models.utility.options.copilotContext).toBeUndefined()
  expect(Object.keys(result.models.utility.variants ?? {})).toEqual(["low", "medium", "high"])
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
  expect(Object.keys(result.models).sort()).toEqual([regular.id, fast.id].sort())
  for (const tier of ["default", "long"]) {
    const entry = CopilotModels.context(result.models[fast.id], `medium@${tier}`)
    expect(entry.api.id).toBe(regular.id)
    expect(entry.options).toEqual({ speed: "fast", copilotContext: { default: 272_000, long: 922_000 } })
    expect(entry.headers).toEqual({ "anthropic-beta": "fast-mode" })
    expect(entry.cost.input).toBe(10)
    expect(entry.cost.output).toBe(50)
    expect(entry.cost.tiers?.[0]).toMatchObject({ input: 10, output: 50 })
    expect(entry.name).toBe("Claude Fast")
    expect(entry.limit.input).toBe(tier === "long" ? 922_000 : 272_000)
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
  expect(result.models[remote.id].options.copilotContext).toBeUndefined()
  expect(Object.keys(result.models[remote.id].variants ?? {})).toEqual(["low", "medium", "high"])
})

test("refreshes choices without accumulating variants and removes unsupported tiers", async () => {
  const remote = model()
  using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote] }) })
  const first = await CopilotModels.get(server.url.origin)
  const second = await CopilotModels.get(server.url.origin, {}, first.models)
  expect(second).toEqual(first)
  expect(await CopilotModels.get(server.url.origin, {}, second.models)).toEqual(first)
  remote.capabilities.limits.max_prompt_tokens = 80_000
  const reduced = await CopilotModels.get(server.url.origin, {}, second.models)
  expect(Object.keys(reduced.models)).toEqual([remote.id])
  expect(reduced.models[remote.id].limit.input).toBe(80_000)
  expect(reduced.models[remote.id].options.copilotContext).toBeUndefined()
  expect(Object.keys(reduced.models[remote.id].variants ?? {})).toEqual(["low", "medium", "high"])
  expect(CopilotModels.context(reduced.models[remote.id], "high@long").limit.input).toBe(80_000)
})

test("keeps one automatic model choice and applies the selected context compaction budget", async () => {
  const remote = model()
  using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote] }) })
  const result = await CopilotModels.get(server.url.origin)
  expect(Provider.sort(Object.values(result.models))[0].id).toBe(remote.id)
  expect(Provider.sort(Object.values(result.models))).toHaveLength(1)
  for (const [variant, budget] of [
    [undefined, 252_000],
    ["high", 252_000],
    ["default@default", 252_000],
    ["high@default", 252_000],
    ["default@long", 902_000],
    ["high@long", 902_000],
  ] as const) {
    const effective = CopilotModels.context(result.models[remote.id], variant) as Provider.Model
    expect(usable({ cfg: {}, model: effective })).toBe(budget)
    expect(usable({ cfg: { compaction: { reserved: 10_000 } }, model: effective })).toBe(budget + 10_000)
    for (const [total, overflow] of [
      [budget - 1, false],
      [budget, true],
    ] as const) {
      expect(
        isOverflow({
          cfg: {},
          model: effective,
          tokens: { total, input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ).toBe(overflow)
    }
  }
})

test("keeps endpoint model IDs verbatim without generating context aliases", async () => {
  const remote = model()
  const collision = { ...model(`${remote.id}--long`), billing: undefined }
  using server = Bun.serve({ port: 0, fetch: () => Response.json({ data: [remote, collision] }) })
  const first = await CopilotModels.get(server.url.origin)
  expect(Object.keys(first.models)).toEqual([remote.id, collision.id])
  expect(first.models[remote.id].name).toBe(remote.name)
  expect(first.models[collision.id].name).toBe(collision.name)
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
  expect(result.models[fast.id].options).toEqual({ speed: "fast" })
  expect(Object.keys(result.models[fast.id].variants ?? {})).toEqual(["low", "medium", "high"])
})
