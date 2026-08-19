import { describe, expect, test } from "bun:test"
import {
  classifyByInstalledFamily,
  modelFamilyVersion,
  parseRecommendationQuant,
  recommendationQuantRank,
} from "../../src/local/model-catalog/family"

// Fixtures below mirror Skein's internal/providers/model_gallery_test.go and
// recommend_test.go (commit 95f0801a9a27d209f7c1ea1e136d665ac52b89e1) so this
// port stays behaviorally identical.

describe("modelFamilyVersion", () => {
  test.each([
    ["Qwen3.6-35B-A3B-GGUF", { family: "qwen", version: 3.6 }],
    ["qwen3-35b-a3b", { family: "qwen", version: 3 }],
    ["gemma-4-26B-it", { family: "gemma", version: 4 }],
    ["deepseek-v4-gguf", { family: "deepseek", version: 4 }],
    ["qwopus3.6-27b-v2-mtp-q8-0", { family: "qwopus", version: 3.6 }],
    ["mistral-small-3.1-24b", { family: "mistralsmall", version: 3.1 }],
    ["no-version-here", null],
    // "35B" alone is a parameter count, not a version.
    ["plainmodel-35B", null],
  ])("%s -> %o", (name, want) => {
    expect(modelFamilyVersion(name)).toEqual(want)
  })
})

describe("classifyByInstalledFamily", () => {
  test("splits into upgrades of installed families and fresh finds", () => {
    const installed = ["qwen3-35b-a3b", "qwopus3.6-27b-v2-mtp-q8-0"]
    const candidates = [
      { repo: "unsloth/Qwen3.6-35B-A3B-GGUF" }, // qwen 3.6 > installed 3 -> upgrade
      { repo: "unsloth/Qwen3-30B-GGUF" }, // qwen 3 == installed 3 -> skip
      { repo: "unsloth/gemma-4-26B-it-GGUF" }, // new family -> fresh
    ]

    const { upgrades, fresh } = classifyByInstalledFamily(candidates, installed, (c) => [c.repo])

    expect(upgrades).toHaveLength(1)
    expect(upgrades[0].candidate.repo).toBe("unsloth/Qwen3.6-35B-A3B-GGUF")
    expect(upgrades[0].replaces).toBe("qwen3-35b-a3b")
    expect(fresh).toHaveLength(1)
    expect(fresh[0].repo).toBe("unsloth/gemma-4-26B-it-GGUF")
  })

  test("falls back to a secondary name source when the primary does not parse", () => {
    const candidates = [{ repo: "already/Have-9B", file: "have-v9.gguf" }]

    const { fresh } = classifyByInstalledFamily(candidates, [], (c) => [c.repo, c.file])

    expect(fresh).toHaveLength(1)
  })
})

describe("parseRecommendationQuant", () => {
  test.each([
    ["Qwen3-32B-Q4_K_M.gguf", "q4_k_m"],
    ["model-IQ4_NL.gguf", "iq4_nl"],
    ["gemma-UD-Q5_K_M.gguf", "ud_q5_k_m"],
    ["model-APEX-Balanced.gguf", "q4_k_m"],
    ["model-APEX-I-Balanced.gguf", "q4_k_m"],
    ["model-APEX-Compact.gguf", "q4_k_s"],
    ["model-APEX-I-Compact.gguf", "q4_k_s"],
    ["model-APEX-Quality.gguf", "q5_k_m"],
    ["model-APEX-I-Quality.gguf", "q5_k_m"],
    ["model-APEX-I-Mini.gguf", "q3_k_m"],
    ["model-APEX-I-Nano.gguf", "q2_k"],
    ["unknown-model-fancy.gguf", "unknown"],
    ["nested/path/model-Q8_0.gguf", "q8_0"],
  ])("%s -> %s", (filename, want) => {
    expect(parseRecommendationQuant(filename)).toBe(want)
  })
})

describe("recommendationQuantRank", () => {
  test("orders quants from best to most compressed", () => {
    expect(recommendationQuantRank("q8_0")).toBe(1)
    expect(recommendationQuantRank("q4_k_m")).toBe(5)
    expect(recommendationQuantRank("q2_k")).toBe(10)
    expect(recommendationQuantRank("unknown")).toBeNull()
  })
})
