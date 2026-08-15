import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import {
  reserved,
  usable,
  isOverflow,
  learnContextLimit,
  shouldWarnUnsetLimit,
  DEFAULT_USABLE_CONTEXT,
} from "@/session/overflow"
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

  test("unset context limit falls back to the conservative default window", () => {
    expect(usable({ cfg: cfg(), model: model({ context: 0, output: 32_000 }) })).toBe(DEFAULT_USABLE_CONTEXT)
  })

  test("unset context limit stays disabled when compaction.auto is off", () => {
    expect(usable({ cfg: cfg({ auto: false }), model: model({ context: 0, output: 32_000 }) })).toBe(0)
  })

  test("learned session cap shrinks the default window", () => {
    const sessionID = "ses_learned_cap"
    learnContextLimit(sessionID, 10_000)
    // 10_000 - reserved(10_000) = 10_000 - 2_048
    expect(usable({ cfg: cfg(), model: model({ context: 0, output: 32_000 }), sessionID })).toBe(7_952)
    // only the smallest observation is kept
    learnContextLimit(sessionID, 50_000)
    expect(usable({ cfg: cfg(), model: model({ context: 0, output: 32_000 }), sessionID })).toBe(7_952)
    learnContextLimit(sessionID, 5_000)
    expect(usable({ cfg: cfg(), model: model({ context: 0, output: 32_000 }), sessionID })).toBe(2_952)
  })

  test("learned cap never applies to models with explicit limits", () => {
    const sessionID = "ses_learned_explicit"
    learnContextLimit(sessionID, 1_000)
    expect(usable({ cfg: cfg(), model: model({ context: 200_000, output: 64_000 }), sessionID })).toBe(168_000)
  })
})

describe("overflow.isOverflow", () => {
  const tokens = (total: number) => ({ input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

  test("unset context limit overflows at the conservative default window", () => {
    const zero = model({ context: 0, output: 32_000 })
    expect(isOverflow({ cfg: cfg(), tokens: tokens(33_000), model: zero })).toBe(true)
    expect(isOverflow({ cfg: cfg(), tokens: tokens(10_000), model: zero })).toBe(false)
  })

  test("unset context limit never overflows when compaction.auto is off", () => {
    const zero = model({ context: 0, output: 32_000 })
    expect(isOverflow({ cfg: cfg({ auto: false }), tokens: tokens(100_000), model: zero })).toBe(false)
  })

  test("explicit limits behave exactly as before", () => {
    const explicit = model({ context: 200_000, output: 64_000 })
    expect(isOverflow({ cfg: cfg(), tokens: tokens(168_000), model: explicit })).toBe(true)
    expect(isOverflow({ cfg: cfg(), tokens: tokens(167_999), model: explicit })).toBe(false)
  })
})

describe("overflow.shouldWarnUnsetLimit", () => {
  test("warns exactly once per session for unset limits", () => {
    const input = { cfg: cfg(), model: model({ context: 0, output: 32_000 }), sessionID: "ses_warn_once" }
    expect(shouldWarnUnsetLimit(input)).toBe(true)
    expect(shouldWarnUnsetLimit(input)).toBe(false)
  })

  test("never warns for explicit limits or disabled auto compaction", () => {
    expect(
      shouldWarnUnsetLimit({ cfg: cfg(), model: model({ context: 200_000, output: 64_000 }), sessionID: "ses_warn_a" }),
    ).toBe(false)
    expect(
      shouldWarnUnsetLimit({
        cfg: cfg({ auto: false }),
        model: model({ context: 0, output: 32_000 }),
        sessionID: "ses_warn_b",
      }),
    ).toBe(false)
  })
})
