import { describe, expect, test } from "bun:test"
import { mergeCatalog, loadSeedCatalog, serveSeedFallback } from "../../src/local/model-catalog/seed"
import type { ModelCandidate } from "../../src/local/model-catalog/types"
import { importLlmfitSeed } from "../../src/local/model-catalog/llmfit"

const makeLiveCandidate = (repository: string): ModelCandidate => ({
  id: repository,
  name: repository.split("/").at(-1) ?? repository,
  author: repository.split("/")[0] ?? null,
  repository,
  revision: "abc123def456",
  architecture: null,
  parameterCount: null,
  activeParameterCount: null,
  trainedContext: null,
  pipelineTag: null,
  capabilities: [],
  languages: [],
  license: "apache-2.0",
  downloads: 1000,
  likes: 50,
  tags: [],
  variants: [],
  policy: {
    allowed: true,
    reasons: [],
  },
  provenance: {
    source: "huggingface",
    repository,
    revision: "abc123def456",
    fetchedAt: new Date().toISOString(),
    freshness: "live",
  },
})

const makeCachedCandidate = (
  repository: string,
  freshness: "fresh-cache" | "stale-cache" = "fresh-cache",
): ModelCandidate => ({
  id: repository,
  name: repository.split("/").at(-1) ?? repository,
  author: repository.split("/")[0] ?? null,
  repository,
  revision: "abc123def456",
  architecture: null,
  parameterCount: null,
  activeParameterCount: null,
  trainedContext: null,
  pipelineTag: null,
  capabilities: [],
  languages: [],
  license: "apache-2.0",
  downloads: 1000,
  likes: 50,
  tags: [],
  variants: [],
  policy: {
    allowed: true,
    reasons: [],
  },
  provenance: {
    source: "huggingface",
    repository,
    revision: "abc123def456",
    fetchedAt: new Date().toISOString(),
    freshness,
  },
})

describe("mergeCatalog", () => {
  const seed = importLlmfitSeed([
    {
      name: "Qwen/Qwen3-35B-A3B",
      provider: "qwen",
      parameter_count: "35B",
      parameters_raw: 35000000000,
      min_ram_gb: 16,
      recommended_ram_gb: 32,
      quantization: "Q4_K_M",
      format: "gguf",
      context_length: 131072,
      use_case: "General purpose text generation",
    },
  ]).models

  test("returns seed candidates when no live data is provided", () => {
    const result = mergeCatalog(seed, [])

    expect(result).toHaveLength(1)
    expect(result[0].repository).toBe("Qwen/Qwen3-35B-A3B")
    expect(result[0].provenance.source).toBe("seed")
  })

  test("live data overrides seed for the same repository", () => {
    const live = [makeLiveCandidate("Qwen/Qwen3-35B-A3B")]
    const result = mergeCatalog(seed, live)

    expect(result).toHaveLength(1)
    expect(result[0].provenance.source).toBe("huggingface")
  })

  test("preserves seed-only repositories when live does not cover them", () => {
    const seedExtended = importLlmfitSeed([
      {
        name: "Qwen/Qwen3-35B-A3B",
        provider: "qwen",
        parameter_count: "35B",
        parameters_raw: 35000000000,
        min_ram_gb: 16,
        recommended_ram_gb: 32,
        quantization: "Q4_K_M",
        format: "gguf",
        context_length: 131072,
        use_case: "General purpose text generation",
      },
      {
        name: "Alpha/Tiny-2B",
        provider: "alpha",
        parameter_count: "2B",
        parameters_raw: 2000000000,
        min_ram_gb: 4,
        recommended_ram_gb: 8,
        quantization: "Q4_K_M",
        format: "gguf",
        context_length: 8192,
        use_case: "Chat",
      },
    ]).models

    const live = [makeLiveCandidate("Qwen/Qwen3-35B-A3B")]
    const result = mergeCatalog(seedExtended, live)

    expect(result).toHaveLength(2)
    expect(result.find((c) => c.repository === "Qwen/Qwen3-35B-A3B")?.provenance.source).toBe("huggingface")
    expect(result.find((c) => c.repository === "Alpha/Tiny-2B")?.provenance.source).toBe("seed")
  })

  test("overlay overrides all sources", () => {
    const live = [makeLiveCandidate("Qwen/Qwen3-35B-A3B")]
    const overlay: ModelCandidate[] = [
      {
        ...makeLiveCandidate("Qwen/Qwen3-35B-A3B"),
        name: "Overridden Qwen",
        provenance: {
          source: "overlay",
          repository: "Qwen/Qwen3-35B-A3B",
          fetchedAt: new Date().toISOString(),
          freshness: "fresh-cache",
        },
      },
    ]
    const result = mergeCatalog(seed, live, overlay)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("Overridden Qwen")
    expect(result[0].provenance.source).toBe("overlay")
  })

  test("sorts output deterministically by repository ID", () => {
    const seedExtended = importLlmfitSeed([
      {
        name: "Zephyr/Small-1B",
        provider: "zephyr",
        parameter_count: "1B",
        parameters_raw: 1000000000,
        min_ram_gb: 2,
        recommended_ram_gb: 4,
        quantization: "Q4_K_M",
        format: "gguf",
        context_length: 4096,
        use_case: "Chat",
      },
      {
        name: "Alpha/Tiny-2B",
        provider: "alpha",
        parameter_count: "2B",
        parameters_raw: 2000000000,
        min_ram_gb: 4,
        recommended_ram_gb: 8,
        quantization: "Q4_K_M",
        format: "gguf",
        context_length: 8192,
        use_case: "Chat",
      },
    ]).models

    const result = mergeCatalog(seedExtended, [])

    expect(result[0].repository).toBe("Alpha/Tiny-2B")
    expect(result[1].repository).toBe("Zephyr/Small-1B")
  })
})

describe("loadSeedCatalog", () => {
  test("returns candidates with seed provenance", () => {
    const { candidates } = loadSeedCatalog()

    for (const candidate of candidates) {
      expect(candidate.provenance.source).toBe("seed")
    }
  })
})

describe("serveSeedFallback", () => {
  test("returns candidates with seed freshness when Hugging Face is unavailable", () => {
    const seed = importLlmfitSeed([
      {
        name: "Qwen/Qwen3-35B-A3B",
        provider: "qwen",
        parameter_count: "35B",
        parameters_raw: 35000000000,
        min_ram_gb: 16,
        recommended_ram_gb: 32,
        quantization: "Q4_K_M",
        format: "gguf",
        context_length: 131072,
        use_case: "General purpose text generation",
      },
    ]).models

    const result = serveSeedFallback(seed)

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].provenance.freshness).toBe("seed")
  })
})
