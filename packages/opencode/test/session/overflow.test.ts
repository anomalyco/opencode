import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { reserved, usable } from "@/session/overflow"
import type { Provider } from "@/provider/provider"

function cfg(compaction?: ConfigV1.Info["compaction"]) {
  const base = Schema.decodeUnknownSync(ConfigV1.Info)({}) as ConfigV1.Info
  return { ...base, compaction }
}

function model(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai-compatible" },
    options: {},
  } as Provider.Model
}

describe("overflow.reserved", () => {
  test("scales proportionally on small windows", () => {
    expect(reserved(cfg(), 56_320)).toBe(8_448)
  })

  test("caps at the legacy 20k buffer on large windows", () => {
    expect(reserved(cfg(), 200_000)).toBe(20_000)
  })

  test("floors at 2,048 on tiny windows", () => {
    expect(reserved(cfg(), 8_192)).toBe(2_048)
  })

  test("compaction.reserved config keeps absolute priority", () => {
    expect(reserved(cfg({ reserved: 5_000 }), 56_320)).toBe(5_000)
    expect(reserved(cfg({ reserved: 30_000 }), 8_192)).toBe(30_000)
  })
})

describe("overflow.usable", () => {
  test("subtracts the proportional reserve from limit.input", () => {
    expect(usable({ cfg: cfg(), model: model({ context: 56_320, input: 56_320, output: 8_192 }) })).toBe(47_872)
  })

  test("keeps large explicit windows unchanged (20k reserve)", () => {
    expect(usable({ cfg: cfg(), model: model({ context: 200_000, input: 200_000, output: 64_000 }) })).toBe(180_000)
  })

  test("keeps the context minus output path for models without limit.input", () => {
    expect(usable({ cfg: cfg(), model: model({ context: 200_000, output: 64_000 }) })).toBe(168_000)
  })
})
