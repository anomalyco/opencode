// Quantization and generation scoring, ported from llmfit.
//
// Source: https://github.com/av/llmfit (MIT License), llmfit-core/src/models.rs
// Pinned commit: 12c0edb74b34ad867047c084e5595d3841a08163
// Ported functions: quant_bpp, quant_bytes_per_param, quant_speed_multiplier,
// quant_quality_penalty, parse_generation, generation_quality_bonus.
//
// llmfit distinguishes two bytes-per-parameter scales for the same quantization:
// `quantBytesPerParam` estimates on-disk artifact size, `quantBandwidthBytesPerParam`
// estimates the bytes actually moved per token for the bandwidth-based speed model.
// They differ (for example Q6_K is 0.80 on disk but 0.75 for bandwidth) because GGUF
// block padding and K-quant metadata are not identical to the pure weight bit-width.

function buildQuantTable(entries: readonly (readonly [readonly string[], number])[]): Record<string, number> {
  return Object.fromEntries(entries.flatMap(([quants, value]) => quants.map((quant) => [quant, value])))
}

function lookupQuant(table: Record<string, number>, quant: string, fallback: number) {
  return table[quant] ?? fallback
}

const UD_TIERS = ["XL", "L", "M", "S"] as const

function udVariants(base: string) {
  return UD_TIERS.map((tier) => `UD-${base}_${tier}`)
}

const QUANT_BPP_TABLE = buildQuantTable([
  [["F32"], 4.0],
  [["F16", "BF16"], 2.0],
  [["Q8_0"], 1.05],
  [["Q6_K"], 0.8],
  [["Q5_K_M"], 0.68],
  [["Q4_K_M", "Q4_0"], 0.58],
  [["Q3_K_M"], 0.48],
  [["Q2_K"], 0.37],
  [udVariants("Q2_K"), 0.37],
  [udVariants("Q3_K"), 0.48],
  [udVariants("Q4_K"), 0.58],
  [udVariants("Q5_K"), 0.68],
  [udVariants("Q6_K"), 0.8],
  [udVariants("Q8_K"), 1.05],
  [["mlx-4bit"], 0.55],
  [["mlx-8bit"], 1.0],
  [["AWQ-4bit"], 0.5],
  [["AWQ-8bit"], 1.0],
  [["GPTQ-Int4"], 0.5],
  [["GPTQ-Int8"], 1.0],
])

const QUANT_BANDWIDTH_BYTES_PER_PARAM_TABLE = buildQuantTable([
  [["F16", "BF16"], 2.0],
  [["Q8_0"], 1.0],
  [["Q6_K"], 0.75],
  [["Q5_K_M"], 0.625],
  [["Q4_K_M", "Q4_0"], 0.5],
  [["Q3_K_M"], 0.375],
  [["Q2_K"], 0.25],
  [udVariants("Q2_K"), 0.25],
  [udVariants("Q3_K"), 0.375],
  [udVariants("Q4_K"), 0.5],
  [udVariants("Q5_K"), 0.625],
  [udVariants("Q6_K"), 0.75],
  [udVariants("Q8_K"), 1.0],
  [["mlx-4bit"], 0.5],
  [["mlx-8bit"], 1.0],
  [["AWQ-4bit", "GPTQ-Int4", "AutoRound-4bit"], 0.5],
  [["AWQ-8bit", "GPTQ-Int8", "AutoRound-8bit"], 1.0],
])

const QUANT_SPEED_MULTIPLIER_TABLE = buildQuantTable([
  [["F16", "BF16"], 0.6],
  [["Q8_0"], 0.8],
  [["Q6_K"], 0.95],
  [["Q5_K_M"], 1.0],
  [["Q4_K_M", "Q4_0"], 1.15],
  [["Q3_K_M"], 1.25],
  [["Q2_K"], 1.35],
  [udVariants("Q2_K"), 1.35],
  [udVariants("Q3_K"), 1.25],
  [udVariants("Q4_K"), 1.15],
  [udVariants("Q5_K"), 1.0],
  [udVariants("Q6_K"), 0.95],
  [udVariants("Q8_K"), 0.8],
  [["mlx-4bit"], 1.15],
  [["mlx-8bit"], 0.85],
  [["AWQ-4bit", "GPTQ-Int4", "AutoRound-4bit"], 1.2],
  [["AWQ-8bit", "GPTQ-Int8", "AutoRound-8bit"], 0.85],
])

const QUANT_QUALITY_PENALTY_TABLE = buildQuantTable([
  [["F16", "BF16"], 0.0],
  [["Q8_0"], 0.0],
  [["Q6_K"], -1.0],
  [["Q5_K_M"], -2.0],
  [["Q4_K_M", "Q4_0"], -5.0],
  [["Q3_K_M"], -8.0],
  [["Q2_K"], -12.0],
  [udVariants("Q2_K"), -12.0],
  [udVariants("Q3_K"), -8.0],
  [udVariants("Q4_K"), -5.0],
  [udVariants("Q5_K"), -2.0],
  [udVariants("Q6_K"), -1.0],
  [udVariants("Q8_K"), 0.0],
  [["mlx-4bit"], -4.0],
  [["mlx-8bit"], 0.0],
  [["AWQ-4bit"], -3.0],
  [["AWQ-8bit"], 0.0],
  [["GPTQ-Int4"], -3.0],
  [["GPTQ-Int8"], 0.0],
  [["AutoRound-4bit"], -3.0],
  [["AutoRound-8bit"], 0.0],
])

/** Estimated on-disk bytes per parameter for a quantization label. */
export function quantBytesPerParam(quant: string) {
  return lookupQuant(QUANT_BPP_TABLE, quant, 0.58)
}

/** Bytes per parameter moved per token, for the bandwidth-based speed estimator. */
export function quantBandwidthBytesPerParam(quant: string) {
  return lookupQuant(QUANT_BANDWIDTH_BYTES_PER_PARAM_TABLE, quant, 0.5)
}

/** Relative inference speed multiplier; lower quantization runs faster. */
export function quantSpeedMultiplier(quant: string) {
  return lookupQuant(QUANT_SPEED_MULTIPLIER_TABLE, quant, 1.0)
}

/** Additive quality penalty; lower quantization loses more quality. */
export function quantQualityPenalty(quant: string) {
  return lookupQuant(QUANT_QUALITY_PENALTY_TABLE, quant, -5.0)
}

/**
 * Parse a model's generation number from its architecture string, falling back to its
 * name. Returns null when no known family/generation can be determined.
 */
export function parseModelGeneration(architecture: string | null, name: string): number | null {
  const fromArchitecture = generationFromArchitecture(architecture)
  if (fromArchitecture !== null) return fromArchitecture
  return generationFromName(name)
}

/**
 * Additive quality bonus for newer model generations (empirically, later generations
 * achieve better quality per parameter). Zero when generation is unknown or <= 1.0,
 * capped at +9 (generation 4.0).
 */
export function generationQualityBonus(architecture: string | null, name: string): number {
  const generation = parseModelGeneration(architecture, name)
  if (generation === null) return 0.0
  return clamp((generation - 1.0) * 3.0, 0.0, 9.0)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function generationFromArchitecture(architecture: string | null): number | null {
  if (!architecture) return null
  const arch = architecture.toLowerCase()

  if (arch.startsWith("deepseek")) {
    if (arch.includes("v4")) return 4.0
    if (arch.includes("v3")) return 3.0
    if (arch.includes("v2")) return 2.0
    return 1.0
  }

  if (arch.startsWith("qwen")) {
    const suffix = arch.slice("qwen".length)
    if (suffix.startsWith("3_5") || suffix.startsWith("3.5")) return 3.5
    if (suffix.startsWith("3_next") || suffix.startsWith("3next")) return 3.8
    if (suffix.startsWith("3")) return 3.0
    if (suffix.startsWith("2")) return 2.0
    if (suffix.startsWith("1")) return 1.0
    return 1.0
  }

  if (arch.startsWith("llama")) {
    const suffix = arch.slice("llama".length)
    if (suffix.startsWith("4")) return 4.0
    // Architecture is just "llama" — fall through to name-based parsing.
  }

  if (arch.startsWith("gemma")) {
    const suffix = arch.slice("gemma".length)
    if (suffix.startsWith("4")) return 4.0
    if (suffix.startsWith("3")) return 3.0
    if (suffix.startsWith("2")) return 2.0
    return 1.0
  }

  if (arch.startsWith("phi")) {
    const suffix = arch.slice("phi".length)
    if (suffix.startsWith("4")) return 4.0
    if (suffix.startsWith("3") || suffix.startsWith("moe")) return 3.0
    if (suffix.startsWith("2")) return 2.0
    return 1.0
  }

  if (arch.startsWith("mistral") || arch.startsWith("mixtral")) return 1.0

  if (arch.startsWith("cohere")) {
    const suffix = arch.slice("cohere".length)
    if (suffix.startsWith("2")) return 2.0
    return 1.0
  }

  if (arch.startsWith("falcon")) {
    const suffix = arch.slice("falcon".length)
    if (suffix.startsWith("3")) return 3.0
    return 1.0
  }

  if (arch.startsWith("granite")) {
    const suffix = arch.slice("granite".length)
    if (suffix.startsWith("4")) return 4.0
    if (suffix.startsWith("moe")) return 1.0
    return 1.0
  }

  return null
}

function generationFromName(name: string): number | null {
  const value = name.toLowerCase()

  if (value.includes("qwen3.6") || value.includes("qwen3_6")) return 3.6
  if (value.includes("qwen3.5") || value.includes("qwen3_5")) return 3.5
  if (value.includes("qwen3")) return 3.0
  if (value.includes("qwen2.5") || value.includes("qwen2_5")) return 2.5
  if (value.includes("qwen2")) return 2.0

  if (value.includes("llama-4") || value.includes("llama4")) return 4.0
  if (value.includes("llama-3.3") || value.includes("llama3.3")) return 3.3
  if (value.includes("llama-3.2") || value.includes("llama3.2")) return 3.2
  if (value.includes("llama-3.1") || value.includes("llama3.1")) return 3.1
  if (value.includes("llama-3") || value.includes("llama3")) return 3.0
  if (value.includes("llama-2") || value.includes("llama2")) return 2.0

  if (value.includes("gemma-4") || value.includes("gemma4")) return 4.0
  if (value.includes("gemma-3") || value.includes("gemma3")) return 3.0
  if (value.includes("gemma-2") || value.includes("gemma2")) return 2.0

  if (value.includes("deepseek-v4") || value.includes("deepseekv4")) return 4.0
  if (value.includes("deepseek-v3") || value.includes("deepseekv3")) return 3.0
  if (value.includes("deepseek-v2") || value.includes("deepseekv2")) return 2.0

  if (value.includes("phi-4") || value.includes("phi4")) return 4.0
  if (value.includes("phi-3") || value.includes("phi3")) return 3.0

  return null
}
