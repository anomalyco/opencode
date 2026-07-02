import { describe, expect, test } from "bun:test"
import { usable } from "@/session/overflow"
import type { Provider } from "@/provider/provider"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"

const COMPACTION_BUFFER = 20_000

const model = (overrides: { context?: number; input?: number; output?: number }): Provider.Model =>
  ({
    limit: {
      context: overrides.context ?? 200_000,
      input: overrides.input,
      output: overrides.output ?? 32_000,
    },
    capabilities: {
      toolcall: true,
      reasoning: false,
      temperature: true,
      attachment: false,
    },
    api: { npm: "@ai-sdk/anthropic" },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    options: {},
  }) as Provider.Model

const cfg = (overrides: { reserved?: number; auto?: boolean } = {}): ConfigV1.Info =>
  ({ compaction: overrides }) as ConfigV1.Info

describe("overflow.usable", () => {
  test("returns 0 when context is 0", () => {
    expect(usable({ cfg: cfg(), model: model({ context: 0 }) })).toBe(0)
  })

  test("uses limit.input path when set", () => {
    const m = model({ context: 200_000, input: 150_000, output: 32_000 })
    const reserved = Math.min(COMPACTION_BUFFER, 32_000)
    expect(usable({ cfg: cfg(), model: m })).toBe(150_000 - reserved)
  })

  test("uses context - reserved for fallback path without limit.input", () => {
    const m = model({ context: 200_000, output: 32_000 })
    const reserved = Math.min(COMPACTION_BUFFER, 32_000)
    expect(usable({ cfg: cfg(), model: m })).toBe(200_000 - reserved)
  })

  test("shared-window model with high output does not collapse usable to 0", () => {
    const m = model({ context: 262_144, output: 262_144 })
    const reserved = Math.min(COMPACTION_BUFFER, 262_144)
    expect(usable({ cfg: cfg(), model: m })).toBe(262_144 - reserved)
  })

  test("respects custom cfg.compaction.reserved", () => {
    const m = model({ context: 200_000, output: 32_000 })
    expect(usable({ cfg: cfg({ reserved: 50_000 }), model: m })).toBe(200_000 - 50_000)
  })

  test("outputTokenMax caps reserved via maxOutputTokens", () => {
    const m = model({ context: 200_000, output: 131_071 })
    const reserved = Math.min(COMPACTION_BUFFER, Math.min(131_071, 16_000))
    expect(usable({ cfg: cfg(), model: m, outputTokenMax: 16_000 })).toBe(200_000 - reserved)
  })

  test("clamps to 0 when reserved exceeds available context", () => {
    const m = model({ context: 10_000, output: 32_000 })
    expect(usable({ cfg: cfg({ reserved: 50_000 }), model: m })).toBe(0)
  })
})
