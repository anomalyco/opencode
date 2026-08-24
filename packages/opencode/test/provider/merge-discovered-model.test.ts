import { describe, expect, test } from "bun:test"
import { Provider } from "@/provider/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

function makeModel(overrides: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: ModelV2.ID.make("qwen3-35b-a3b"),
    providerID: ProviderV2.ID.make("z4"),
    api: { id: "qwen3-35b-a3b", url: "http://z4/v1", npm: "@ai-sdk/openai-compatible" },
    name: "Qwen3.6 35B A3B",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 32768, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    ...overrides,
  }
}

describe("provider.mergeDiscoveredModel", () => {
  test("no existing entry: discovered wins outright", () => {
    const discovered = makeModel({ sizeBytes: 17_730_509_792 })
    expect(Provider.mergeDiscoveredModel(undefined, discovered)).toEqual(discovered)
  })

  test("regression: an existing entry with sizeBytes explicitly undefined must not clobber a discovered size", () => {
    const existing = makeModel({ sizeBytes: undefined })
    const discovered = makeModel({ sizeBytes: 17_730_509_792 })
    const merged = Provider.mergeDiscoveredModel(existing, discovered)
    expect(merged.sizeBytes).toBe(17_730_509_792)
  })

  test("an existing entry with a real size wins over a discovered one (existing is otherwise authoritative)", () => {
    const existing = makeModel({ sizeBytes: 1_000 })
    const discovered = makeModel({ sizeBytes: 17_730_509_792 })
    const merged = Provider.mergeDiscoveredModel(existing, discovered)
    expect(merged.sizeBytes).toBe(1_000)
  })

  test("neither side knows the size: stays undefined", () => {
    const existing = makeModel({ sizeBytes: undefined })
    const discovered = makeModel({ sizeBytes: undefined })
    const merged = Provider.mergeDiscoveredModel(existing, discovered)
    expect(merged.sizeBytes).toBeUndefined()
  })
})
