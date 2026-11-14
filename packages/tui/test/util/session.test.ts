import { describe, expect, test } from "bun:test"
import type { ModelInfo, SessionInfo, SessionMessageInfo } from "@opencode/client"
import { Money } from "@opencode/schema/money"
import { costEstimate, sessionFamily } from "../../src/util/session"

const ref = { providerID: "provider", id: "model" }
const pricing: ModelInfo = {
  ...ref,
  modelID: "model",
  name: "Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  time: { released: 0 },
  cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
  status: "active",
  enabled: true,
  limit: { context: 0, output: 0 },
}
const tiered: ModelInfo = {
  ...pricing,
  cost: [
    ...pricing.cost,
    { tier: { type: "context", size: 200_000 }, input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 } },
    { tier: { type: "context", size: 400_000 }, input: 9, output: 30, cache: { read: 0.9, write: 11.25 } },
  ],
}

function session(id: string, tokens: SessionInfo["tokens"]): SessionInfo {
  return {
    id,
    projectID: "project",
    location: { directory: "/workspace" },
    model: ref,
    cost: 0,
    tokens,
    time: { created: 0, updated: 0 },
  }
}

const input = (millions: number) => ({
  input: millions * 1_000_000,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

function message(tokens: SessionInfo["tokens"]): SessionMessageInfo {
  return {
    id: "message",
    type: "assistant",
    agent: "build",
    model: ref,
    content: [],
    tokens,
    time: { created: 0 },
  }
}

describe("util.session", () => {
  test("flattens nested subagents from any session in the family", () => {
    const sessions = [
      { id: "root" },
      { id: "child-a", parentID: "root" },
      { id: "grandchild-a", parentID: "child-a" },
      { id: "great-grandchild-a", parentID: "grandchild-a" },
      { id: "grandchild-a2", parentID: "child-a" },
      { id: "child-b", parentID: "root" },
      { id: "grandchild-b", parentID: "child-b" },
    ]

    expect(sessionFamily(sessions, "great-grandchild-a")).toEqual([
      { session: sessions[1], prefix: "" },
      { session: sessions[2], prefix: "├─ " },
      { session: sessions[3], prefix: "│  └─ " },
      { session: sessions[4], prefix: "└─ " },
      { session: sessions[5], prefix: "" },
      { session: sessions[6], prefix: "└─ " },
    ])
  })

  test("prices family tokens at flat catalog rates", () => {
    expect(
      costEstimate(
        [
          session("root", {
            input: 1_000_000,
            output: 100_000,
            reasoning: 10_000,
            cache: { read: 2_000_000, write: 100_000 },
          }),
          session("child", input(0.5)),
        ],
        [pricing],
        () => [],
      ),
    ).toBeCloseTo(7.125)
  })

  test("adds per-call tier surcharges while pricing partial history and unloaded children at base rates", () => {
    expect(
      costEstimate([session("root", input(0.8)), session("child", input(0.1))], [tiered], (id) =>
        id === "child"
          ? []
          : [
              message(input(0.25)),
              message(input(0.15)),
              {
                id: "compaction",
                type: "compaction",
                status: "completed",
                reason: "auto",
                summary: "Summary",
                model: ref,
                tokens: input(0.3),
                time: { created: 0 },
              },
            ],
      ),
    ).toBeCloseTo(3.45)
  })

  test("prices new fork calls without repricing inherited usage", () => {
    expect(
      costEstimate(
        [
          {
            ...session("fork", input(0.3)),
            fork: { sessionID: "parent", boundary: { type: "through", messageID: "parent-message" } },
          },
        ],
        [tiered],
        () => [message(input(0.3)), { ...message(input(0.3)), id: "new-message", time: { created: 1 } }],
      ),
    ).toBeCloseTo(1.8)
  })

  test.each([
    { tokens: 200_000, expected: 0.6 },
    { tokens: 200_001, expected: 1.200006 },
    { tokens: 400_000, expected: 2.4 },
    { tokens: 400_001, expected: 3.600009 },
  ])("selects the largest matching tier for $tokens input tokens", ({ tokens, expected }) => {
    expect(
      costEstimate([session("root", input(tokens / 1_000_000))], [tiered], () => [message(input(tokens / 1_000_000))]),
    ).toBeCloseTo(expected, 8)
  })

  test("prices each family member with its own provider and model", () => {
    const other = { ...pricing, providerID: "other", id: "other-model", cost: [{ ...pricing.cost[0]!, input: 10 }] }
    expect(
      costEstimate(
        [session("root", input(1)), { ...session("child", input(0.5)), model: other }],
        [pricing, other],
        () => [],
      ),
    ).toBe(Money.USD.make(8))
  })

  test("omits estimates when any scoped session lacks catalog pricing", () => {
    const sessions = [session("root", input(1))]
    expect(costEstimate(sessions, undefined, () => [])).toBeUndefined()
    expect(costEstimate(sessions, [{ ...pricing, providerID: "other" }], () => [])).toBeUndefined()
    expect(costEstimate(sessions, [{ ...pricing, cost: [] }], () => [])).toBeUndefined()
    expect(
      costEstimate(
        [...sessions, { ...session("child", input(0.5)), model: { ...ref, id: "removed" } }],
        [pricing],
        () => [],
      ),
    ).toBeUndefined()
    expect(
      costEstimate(sessions, [{ ...pricing, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] }], () => []),
    ).toBe(Money.USD.zero)
  })
})
