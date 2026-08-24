import { describe, expect, test } from "bun:test"
import {
  generationQualityBonus,
  parseModelGeneration,
  quantBandwidthBytesPerParam,
  quantBytesPerParam,
  quantQualityPenalty,
  quantSpeedMultiplier,
} from "../../src/local/model-catalog/quant"

// Fixtures below mirror llmfit-core/src/models.rs (pinned commit
// 12c0edb74b34ad867047c084e5595d3841a08163) so this port stays behaviorally identical.

describe("quant tables", () => {
  test("matches llmfit's disk bytes-per-parameter table", () => {
    expect(quantBytesPerParam("F32")).toBe(4.0)
    expect(quantBytesPerParam("F16")).toBe(2.0)
    expect(quantBytesPerParam("Q8_0")).toBe(1.05)
    expect(quantBytesPerParam("Q4_K_M")).toBe(0.58)
    expect(quantBytesPerParam("Q2_K")).toBe(0.37)
    expect(quantBytesPerParam("UNKNOWN")).toBe(0.58)
  })

  test("matches llmfit's mlx quant values", () => {
    expect(quantBytesPerParam("mlx-4bit")).toBe(0.55)
    expect(quantBytesPerParam("mlx-8bit")).toBe(1.0)
    expect(quantSpeedMultiplier("mlx-4bit")).toBe(1.15)
    expect(quantSpeedMultiplier("mlx-8bit")).toBe(0.85)
    expect(quantQualityPenalty("mlx-4bit")).toBe(-4.0)
    expect(quantQualityPenalty("mlx-8bit")).toBe(0.0)
  })

  test("aligns Unsloth Dynamic (UD) variants with their base quant", () => {
    expect(quantBytesPerParam("UD-Q2_K_XL")).toBe(quantBytesPerParam("Q2_K"))
    expect(quantSpeedMultiplier("UD-Q2_K_XL")).toBe(quantSpeedMultiplier("Q2_K"))
    expect(quantQualityPenalty("UD-Q2_K_XL")).toBe(quantQualityPenalty("Q2_K"))

    expect(quantBytesPerParam("UD-Q4_K_M")).toBe(quantBytesPerParam("Q4_K_M"))
    // UD-Q8_K_S maps into the Q8_0-equivalent bpp table entry, not a literal default.
    expect(quantBytesPerParam("UD-Q8_K_S")).toBe(quantBytesPerParam("Q8_0"))
    expect(quantBytesPerParam("UD-Q2_K_XL")).toBeLessThan(0.5)
  })

  test("speed multiplier increases as quantization gets more aggressive", () => {
    expect(quantSpeedMultiplier("F16")).toBe(0.6)
    expect(quantSpeedMultiplier("Q5_K_M")).toBe(1.0)
    expect(quantSpeedMultiplier("Q4_K_M")).toBe(1.15)
    expect(quantSpeedMultiplier("Q2_K")).toBe(1.35)
    expect(quantSpeedMultiplier("Q2_K")).toBeGreaterThan(quantSpeedMultiplier("Q8_0"))
  })

  test("bandwidth bytes-per-parameter differs from disk bytes-per-parameter", () => {
    expect(quantBandwidthBytesPerParam("Q6_K")).toBe(0.75)
    expect(quantBytesPerParam("Q6_K")).toBe(0.8)
    expect(quantBandwidthBytesPerParam("Q4_K_M")).toBe(0.5)
    expect(quantBandwidthBytesPerParam("UNKNOWN")).toBe(0.5)
  })
})

describe("model generation parsing", () => {
  test("parses generation from architecture for known families", () => {
    expect(parseModelGeneration("qwen2", "")).toBe(2.0)
    expect(parseModelGeneration("qwen3", "")).toBe(3.0)
    expect(parseModelGeneration("qwen3_moe", "")).toBe(3.0)
    expect(parseModelGeneration("qwen3_5_moe", "")).toBe(3.5)
    expect(parseModelGeneration("qwen3_5", "")).toBe(3.5)
    expect(parseModelGeneration("qwen3_next", "")).toBe(3.8)

    expect(parseModelGeneration("deepseek", "")).toBe(1.0)
    expect(parseModelGeneration("deepseek_v2", "")).toBe(2.0)
    expect(parseModelGeneration("deepseek_v3", "")).toBe(3.0)
    expect(parseModelGeneration("deepseek_v4", "")).toBe(4.0)

    expect(parseModelGeneration("llama4", "")).toBe(4.0)

    expect(parseModelGeneration("gemma", "")).toBe(1.0)
    expect(parseModelGeneration("gemma2", "")).toBe(2.0)
    expect(parseModelGeneration("gemma3", "")).toBe(3.0)
    expect(parseModelGeneration("gemma4", "")).toBe(4.0)

    expect(parseModelGeneration("phi", "")).toBe(1.0)
    expect(parseModelGeneration("phi3", "")).toBe(3.0)

    expect(parseModelGeneration("unknown_arch", "")).toBeNull()
  })

  test("falls back to the model name when architecture is bare or missing", () => {
    expect(parseModelGeneration("llama", "meta-llama/Llama-3.1-8B")).toBe(3.1)
    expect(parseModelGeneration("llama", "meta-llama/Llama-2-7B")).toBe(2.0)

    expect(parseModelGeneration(null, "Qwen/Qwen3.6-35B-A3B")).toBe(3.6)
    expect(parseModelGeneration(null, "Qwen/Qwen2.5-72B")).toBe(2.5)
    expect(parseModelGeneration(null, "deepseek-ai/DeepSeek-V4-Flash")).toBe(4.0)
    expect(parseModelGeneration(null, "google/gemma-3-12b-it")).toBe(3.0)
  })
})

describe("generation quality bonus", () => {
  test("adds +3 per full generation above 1.0, capped at +9", () => {
    expect(generationQualityBonus("deepseek", "")).toBe(0.0)
    expect(generationQualityBonus("qwen2", "")).toBe(3.0)
    expect(generationQualityBonus("qwen3", "")).toBe(6.0)
    expect(generationQualityBonus("qwen3_5_moe", "")).toBe(7.5)
    expect(generationQualityBonus("deepseek_v4", "")).toBe(9.0)
    expect(generationQualityBonus(null, "some-unknown-model")).toBe(0.0)
  })
})
