import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"

import { ToolTimeout } from "../../src/session/tool-timeout"
import type { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

function makeAgent(overrides: Partial<Agent.Info> = {}): Agent.Info {
  return {
    name: "test",
    mode: "primary",
    permission: [],
    options: {},
    ...overrides,
  } as Agent.Info
}

function configLayerWith(experimental: Record<string, unknown> | undefined) {
  return Layer.succeed(
    Config.Service,
    TestConfig.make({
      get: () => Effect.succeed({ experimental } as ReturnType<Config.Interface["get"] extends () => Effect.Effect<infer A> ? () => A : never>),
    }),
  )
}

describe("session.tool-timeout.resolve", () => {
  it.effect("uses DEFAULT_TOOL_TIMEOUT_MS when no config is set", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "read",
        agent: makeAgent(),
      }).pipe(Effect.provide(configLayerWith(undefined)))
      expect(result).toBe(ToolTimeout.DEFAULT_TOOL_TIMEOUT_MS)
    }),
  )

  it.effect("uses experimental.tool_timeout when set", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "read",
        agent: makeAgent(),
      }).pipe(Effect.provide(configLayerWith({ tool_timeout: 30_000 })))
      expect(result).toBe(30_000)
    }),
  )

  it.effect("agent.tool_timeout beats experimental.tool_timeout", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "read",
        agent: makeAgent({ tool_timeout: 15_000 }),
      }).pipe(Effect.provide(configLayerWith({ tool_timeout: 30_000 })))
      expect(result).toBe(15_000)
    }),
  )

  it.effect("returns 0 when agent.tool_timeout is 0 (disabled)", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "read",
        agent: makeAgent({ tool_timeout: 0 }),
      }).pipe(Effect.provide(configLayerWith({ tool_timeout: 30_000 })))
      expect(result).toBe(0)
    }),
  )

  it.effect("returns 0 when experimental.tool_timeout is 0 (disabled)", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "read",
        agent: makeAgent(),
      }).pipe(Effect.provide(configLayerWith({ tool_timeout: 0 })))
      expect(result).toBe(0)
    }),
  )

  it.effect("task tool uses experimental.task_timeout when set", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "task",
        agent: makeAgent(),
      }).pipe(
        Effect.provide(
          configLayerWith({ tool_timeout: 30_000, task_timeout: 120_000 }),
        ),
      )
      expect(result).toBe(120_000)
    }),
  )

  it.effect("task tool falls back to tool_timeout when task_timeout is unset", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "task",
        agent: makeAgent(),
      }).pipe(Effect.provide(configLayerWith({ tool_timeout: 45_000 })))
      expect(result).toBe(45_000)
    }),
  )

  it.effect("non-task tools ignore experimental.task_timeout", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "bash",
        agent: makeAgent(),
      }).pipe(
        Effect.provide(
          configLayerWith({ tool_timeout: 30_000, task_timeout: 120_000 }),
        ),
      )
      expect(result).toBe(30_000)
    }),
  )

  it.effect("agent.tool_timeout beats task_timeout for the task tool", () =>
    Effect.gen(function* () {
      const result = yield* ToolTimeout.resolve({
        tool: "task",
        agent: makeAgent({ tool_timeout: 90_000 }),
      }).pipe(
        Effect.provide(
          configLayerWith({ tool_timeout: 30_000, task_timeout: 120_000 }),
        ),
      )
      expect(result).toBe(90_000)
    }),
  )
})

describe("session.tool-timeout.ToolTimeoutError", () => {
  test("message includes tool name and timeout", () => {
    const error = new ToolTimeout.ToolTimeoutError({
      tool: "bash",
      timeoutMs: 42_000,
    })
    expect(error.message).toBe('Tool "bash" timed out after 42000ms')
    expect(error.tool).toBe("bash")
    expect(error.timeoutMs).toBe(42_000)
  })
})
