import { describe, expect, test } from "bun:test"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { computeContextState } from "../../src/feature-plugins/sidebar/context"

function makeMessage(overrides: Partial<AssistantMessage["tokens"]> = {}): AssistantMessage {
  return {
    id: "msg_1",
    sessionID: "ses_1",
    role: "assistant",
    agent: "build",
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "",
    parentID: "msg_0",
    path: { cwd: "/test", root: "/test" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
      ...overrides,
    },
    time: { created: 0 },
  }
}

describe("sidebar context cache calculation", () => {
  test("returns 0% cache when no cache read tokens", () => {
    const msg = makeMessage({ input: 1000, output: 500, cache: { read: 0, write: 0 } })
    const state = computeContextState(msg)
    expect(state.cachePercent).toBe(0)
    expect(state.input).toBe(1000)
    expect(state.cache).toBe(0)
  })

  test("calculates cache hit percentage correctly", () => {
    const msg = makeMessage({ input: 800, output: 500, cache: { read: 200, write: 0 } })
    const state = computeContextState(msg)
    expect(state.input).toBe(800)
    expect(state.cache).toBe(200)
    expect(state.cachePercent).toBe(20)
  })

  test("100% cache hit when all input is cached", () => {
    const msg = makeMessage({ input: 0, output: 500, cache: { read: 1000, write: 0 } })
    const state = computeContextState(msg)
    expect(state.input).toBe(0)
    expect(state.cache).toBe(1000)
    expect(state.cachePercent).toBe(100)
  })

  test("does not include cache.write in cache hit calculation", () => {
    const msg = makeMessage({ input: 800, output: 500, cache: { read: 200, write: 500 } })
    const state = computeContextState(msg)
    expect(state.cache).toBe(200)
    expect(state.cachePercent).toBe(20)
  })

  test("cache.write is included in total token count", () => {
    const msg = makeMessage({ input: 800, output: 500, reasoning: 100, cache: { read: 200, write: 400 } })
    const state = computeContextState(msg)
    expect(state.tokens).toBe(800 + 500 + 100 + 200 + 400)
  })

  test("handles zero input and zero cache gracefully", () => {
    const msg = makeMessage({ input: 0, output: 0, cache: { read: 0, write: 0 } })
    const state = computeContextState(msg)
    expect(state.cachePercent).toBe(0)
    expect(state.input).toBe(0)
    expect(state.cache).toBe(0)
  })

  test("rounds cache percentage to nearest integer", () => {
    const msg = makeMessage({ input: 1000, output: 500, cache: { read: 333, write: 0 } })
    const state = computeContextState(msg)
    expect(state.cachePercent).toBe(25)
  })

  test("50% cache hit", () => {
    const msg = makeMessage({ input: 500, output: 500, cache: { read: 500, write: 0 } })
    const state = computeContextState(msg)
    expect(state.cachePercent).toBe(50)
  })

  test("calculates context percentage when limit provided", () => {
    const msg = makeMessage({ input: 1000, output: 500, cache: { read: 0, write: 0 } })
    const state = computeContextState(msg, 200000)
    expect(state.percent).toBe(1)
  })

  test("returns null percent when no context limit", () => {
    const msg = makeMessage({ input: 1000, output: 500 })
    const state = computeContextState(msg)
    expect(state.percent).toBeNull()
  })
})
