import { describe, expect, it } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Provider } from "@/provider/provider"
import { isOverflow, usable } from "../../src/session/overflow"

// Minimal model builder focused on the token limits that drive overflow math.
function model(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "m",
    providerID: "p",
    name: "M",
    limit: { context: opts.context, input: opts.input, output: opts.output },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
    status: "active",
    headers: {},
    release_date: "2025-01-01",
  } as unknown as Provider.Model
}

const cfg = { compaction: { auto: true } } as unknown as ConfigV1.Info

function tokens(t: {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}): SessionV1.Assistant["tokens"] {
  return {
    input: t.input,
    output: t.output,
    reasoning: 0,
    cache: { read: t.cacheRead ?? 0, write: t.cacheWrite ?? 0 },
    total: t.total,
  } as unknown as SessionV1.Assistant["tokens"]
}

describe("overflow.usable", () => {
  it("bases the input ceiling on context - output, not context - maxOutputTokens (issue #45168)", () => {
    // tencent/hy3 (opencode-go): models.dev reports context 256000, output 64000.
    // maxOutputTokens is capped at OUTPUT_TOKEN_MAX (32000), so the old ceiling
    // `context - maxOutputTokens` = 224000 is unreachable: the provider pins the
    // real input at 262144 - 65536 = 196608, so the measured count plateaus there.
    const hy3 = model({ context: 256_000, output: 64_000 })
    expect(usable({ cfg, model: hy3 })).toBe(172_000)
  })

  it("uses the explicit input cap but never above context - output", () => {
    // A model that advertises an explicit input cap equal to its context. The
    // usable budget must still reserve room for the output response, so it
    // collapses to context - output (matching the equivalent no-input model).
    const withInput = model({ context: 256_000, input: 256_000, output: 64_000 })
    const withoutInput = model({ context: 256_000, output: 64_000 })
    expect(usable({ cfg, model: withInput })).toBe(172_000)
    expect(usable({ cfg, model: withoutInput })).toBe(172_000)
  })

  it("returns 0 when the model has no context limit", () => {
    const unlimited = model({ context: 0, output: 32_000 })
    expect(usable({ cfg, model: unlimited })).toBe(0)
  })
})

describe("overflow.isOverflow — issue #45168 (hy3 never compacts)", () => {
  const hy3 = model({ context: 256_000, output: 64_000 })

  it("triggers compaction once input is pinned at the provider's real ceiling", () => {
    // Observed in the wild: the provider caps input at 196608 and stops serving
    // cache hits, so every request re-sends the full ~196k context raw.
    const pinned = tokens({ input: 196_608, output: 1_500 })
    expect(isOverflow({ cfg, tokens: pinned, model: hy3 })).toBe(true)
  })

  it("triggers when the input is fully cached but the cache write reaches the ceiling", () => {
    const pinned = tokens({ input: 0, output: 1_500, cacheWrite: 196_608 })
    expect(isOverflow({ cfg, tokens: pinned, model: hy3 })).toBe(true)
  })

  it("does not trigger early in the session", () => {
    const early = tokens({ input: 120_000, output: 2_000 })
    expect(isOverflow({ cfg, tokens: early, model: hy3 })).toBe(false)
  })

  it("does not trigger when compaction.auto is disabled", () => {
    const disabled = { compaction: { auto: false } } as unknown as ConfigV1.Info
    const pinned = tokens({ input: 196_608, output: 1_500 })
    expect(isOverflow({ cfg: disabled, tokens: pinned, model: hy3 })).toBe(false)
  })
})

// Realistic models.dev limits. `ceiling` is the provider's real input cap; the
// test asserts the algorithm compacts before that cap is hit.
const models = [
  {
    name: "tencent/hy3",
    model: model({ context: 256_000, output: 64_000 }),
    ceiling: 196_608,
    usableExpect: 172_000,
  },
  {
    name: "anthropic/claude-opus (200k input cap)",
    model: model({ context: 200_000, output: 32_000, input: 200_000 }),
    ceiling: 200_000,
    usableExpect: 148_000,
  },
  {
    name: "openai/gpt (400k context, 128k output)",
    model: model({ context: 400_000, output: 128_000 }),
    ceiling: 272_000,
    usableExpect: 252_000,
  },
  {
    name: "google/gemini (1M context, 64k output)",
    model: model({ context: 1_048_576, output: 65_536 }),
    ceiling: 983_040,
    usableExpect: 963_040,
  },
  {
    name: "deepseek (1M context, 384k output)",
    model: model({ context: 1_048_576, output: 384_000 }),
    ceiling: 664_576,
    usableExpect: 644_576,
  },
] as const

describe("overflow.isOverflow — multiple models.dev models", () => {
  for (const c of models) {
    describe(c.name, () => {
      it("computes the usable budget from the effective input ceiling", () => {
        expect(usable({ cfg, model: c.model })).toBe(c.usableExpect)
      })

      it("does not overflow early in the session", () => {
        const early = tokens({ input: Math.floor(c.ceiling * 0.4), output: 1_000 })
        expect(isOverflow({ cfg, tokens: early, model: c.model })).toBe(false)
      })

      it("overflows once input is pinned near the real ceiling", () => {
        const pinned = tokens({ input: c.ceiling, output: 1_000 })
        expect(isOverflow({ cfg, tokens: pinned, model: c.model })).toBe(true)
      })
    })
  }
})
