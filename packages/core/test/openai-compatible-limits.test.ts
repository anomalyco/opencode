import { describe, expect, it } from "bun:test"
import {
  fetchModelLimits,
  mergeAdvertisedLimit,
  parseModelLimits,
} from "@opencode-ai/core/plugin/provider/openai-compatible-limits"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("parseModelLimits", () => {
  it("reads context limits from an OpenAI-compatible /models body", () => {
    const parsed = parseModelLimits({
      data: [
        { id: "factory-capable", context_length: 1_000_000, max_input_tokens: 1_000_000, max_output_tokens: 131_072 },
        { id: "factory-efficient", context_length: 262_144, max_input_tokens: 230_144 },
        { id: "no-limits" },
      ],
    })
    expect(parsed).toEqual({
      "factory-capable": { context: 1_000_000, input: 1_000_000, output: 131_072 },
      "factory-efficient": { context: 262_144, input: 230_144 },
    })
  })

  it("ignores malformed entries and non-array bodies", () => {
    expect(parseModelLimits({ data: [{ context_length: 100 }, { id: "", context_length: 100 }, { id: "x" }] })).toEqual(
      {},
    )
    expect(parseModelLimits({})).toEqual({})
    expect(parseModelLimits(null)).toEqual({})
    expect(parseModelLimits({ data: [{ id: "neg", context_length: -1 }, { id: "float", context_length: 1.5 }] })).toEqual(
      {},
    )
  })
})

function authHeader(init?: RequestInit): string | undefined {
  if (init?.headers === undefined) return undefined
  const headers = new Headers(init.headers)
  return headers.get("authorization") ?? undefined
}

describe("fetchModelLimits", () => {
  it("requests {baseURL}/models with bearer auth and parses the body", async () => {
    let seenUrl: string | undefined
    let seenAuth: string | undefined
    const limits = await fetchModelLimits({
      baseURL: "https://proxy.example.com/v1/",
      apiKey: "secret",
      fetchImpl: async (input, init) => {
        seenUrl = input instanceof Request ? input.url : String(input)
        seenAuth = authHeader(init)
        return jsonResponse({ data: [{ id: "m", context_length: 200_000 }] })
      },
    })
    expect(seenUrl).toBe("https://proxy.example.com/v1/models")
    expect(seenAuth).toBe("Bearer secret")
    expect(limits).toEqual({ m: { context: 200_000 } })
  })

  it("prefers an explicit authorization header over the apiKey bearer", async () => {
    let seenAuth: string | undefined
    await fetchModelLimits({
      baseURL: "https://proxy.example.com/v1",
      apiKey: "secret",
      authorization: "Token other",
      fetchImpl: async (_input, init) => {
        seenAuth = authHeader(init)
        return jsonResponse({ data: [] })
      },
    })
    expect(seenAuth).toBe("Token other")
  })

  it("throws on non-2xx so callers can fail open", async () => {
    let message: string | undefined
    try {
      await fetchModelLimits({
        baseURL: "https://proxy.example.com/v1",
        fetchImpl: async () => jsonResponse({ error: "bad key" }, 401),
      })
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain("401")
  })
})

describe("mergeAdvertisedLimit", () => {
  const keys = ["context", "input", "output"] as const

  it("fills empty fields from the advertisement", () => {
    expect(
      mergeAdvertisedLimit({
        current: { context: 0, output: 0 },
        advertised: { context: 1_000_000, input: 1_000_000, output: 131_072 },
        explicit: new Set(),
        keys,
      }),
    ).toEqual({ context: 1_000_000, input: 1_000_000, output: 131_072 })
  })

  it("never overwrites existing non-zero values (models.dev wins)", () => {
    expect(
      mergeAdvertisedLimit({
        current: { context: 128_000, input: 128_000, output: 4_096 },
        advertised: { context: 1_000_000, input: 1_000_000, output: 131_072 },
        explicit: new Set(),
        keys,
      }),
    ).toBeUndefined()
  })

  it("never overwrites fields the user set in the config", () => {
    expect(
      mergeAdvertisedLimit({
        current: { context: 0, output: 0 },
        advertised: { context: 1_000_000, input: 1_000_000, output: 131_072 },
        explicit: new Set(["context", "output"] as const),
        keys,
      }),
    ).toEqual({ context: 0, input: 1_000_000, output: 0 })
  })

  it("fills per field, keeping partial current data", () => {
    expect(
      mergeAdvertisedLimit({
        current: { context: 0, output: 4_096 },
        advertised: { context: 262_144, input: 230_144 },
        explicit: new Set(),
        keys,
      }),
    ).toEqual({ context: 262_144, input: 230_144, output: 4_096 })
  })

  it("does nothing when the advertisement has no usable fields", () => {
    expect(
      mergeAdvertisedLimit({ current: { context: 0, output: 0 }, advertised: {}, explicit: new Set(), keys }),
    ).toBeUndefined()
  })
})
