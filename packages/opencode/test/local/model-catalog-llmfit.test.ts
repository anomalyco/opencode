import { describe, expect, test } from "bun:test"
import {
  importLlmfitSeed,
  LlmfitEntry,
  toModelCandidate,
} from "../../src/local/model-catalog/llmfit"

describe("importLlmfitSeed", () => {
  test("imports basic model fields", () => {
    const entries = [
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
        hf_downloads: 12000,
        hf_likes: 800,
      },
    ]

    const { models, evidence } = importLlmfitSeed(entries)

    expect(models).toHaveLength(1)
    expect(models[0].repository).toBe("Qwen/Qwen3-35B-A3B")
    expect(models[0].name).toBe("Qwen3-35B-A3B")
    expect(models[0].author).toBe("qwen")
    expect(models[0].parameterCount).toBe(35000000000)
    expect(models[0].trainedContext).toBe(131072)
    expect(models[0].quantization).toBe("Q4_K_M")
    expect(models[0].format).toBe("gguf")
    expect(models[0].minRamGb).toBe(16)
    expect(models[0].recommendedRamGb).toBe(32)
    expect(models[0].provenance).toMatch(/llmfit@/)
    expect(evidence).not.toHaveLength(0)
  })

  test("deduplicates by repository name", () => {
    const entries = [
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
    ]

    const { models } = importLlmfitSeed(entries)
    expect(models).toHaveLength(1)
  })

  test("sorts models deterministically by repository", () => {
    const entries = [
      {
        name: "Zephyr/Small",
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
        name: "Alpha/Tiny",
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
    ]

    const { models } = importLlmfitSeed(entries)
    expect(models[0].repository).toBe("Alpha/Tiny")
    expect(models[1].repository).toBe("Zephyr/Small")
  })

  test("imports MoE active parameters", () => {
    const entries = [
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
        is_moe: true,
        num_experts: 64,
        active_experts: 8,
        active_parameters: 5000000000,
      },
    ]

    const { models } = importLlmfitSeed(entries)

    expect(models[0].isMoe).toBe(true)
    expect(models[0].numExperts).toBe(64)
    expect(models[0].activeExperts).toBe(8)
    expect(models[0].activeParameterCount).toBe(5000000000)
  })

  test("handles missing optional fields", () => {
    const entries = [
      {
        name: "Tiny/Model",
        provider: "tiny",
        parameter_count: "1K",
        parameters_raw: 1000,
        min_ram_gb: 1,
        recommended_ram_gb: 2,
        quantization: "Q4_K_M",
        format: "gguf",
        context_length: 4096,
        use_case: "Test",
      },
    ]

    const { models } = importLlmfitSeed(entries)

    expect(models[0].activeParameterCount).toBeNull()
    expect(models[0].isMoe).toBe(false)
    expect(models[0].numExperts).toBeNull()
    expect(models[0].license).toBeNull()
    expect(models[0].pipelineTag).toBeNull()
    expect(models[0].capabilities).toEqual([])
    expect(models[0].languages).toEqual([])
  })

  test("emits quality evidence for parameter count and RAM", () => {
    const entries = [
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
    ]

    const { evidence } = importLlmfitSeed(entries)

    const qualityEvidence = evidence.filter((e) => e.kind === "quality" && e.source === "llmfit")
    expect(qualityEvidence).not.toHaveLength(0)

    const contextEvidence = evidence.filter((e) => e.kind === "context" && e.source === "llmfit")
    expect(contextEvidence).toHaveLength(1)
  })
})

describe("toModelCandidate", () => {
  test("maps seed model to ModelCandidate with seed provenance", () => {
    const seed = {
      repository: "Qwen/Qwen3-35B-A3B",
      name: "Qwen3-35B-A3B",
      author: "qwen",
      parameterCount: 35000000000,
      activeParameterCount: 5000000000,
      trainedContext: 131072,
      pipelineTag: "text-generation",
      capabilities: ["vision"],
      languages: [],
      license: "apache-2.0",
      downloads: 12000,
      likes: 800,
      quantization: "Q4_K_M",
      format: "gguf" as const,
      isMoe: true,
      numExperts: 64,
      activeExperts: 8,
      hiddenLayers: 60,
      attentionHeads: 40,
      kvHeads: 8,
      headDim: 128,
      hiddenSize: 5120,
      vocabSize: 152064,
      moeIntermediateSize: 2048,
      sharedExpertIntermediateSize: 1024,
      minRamGb: 16,
      recommendedRamGb: 32,
      minVramGb: 8,
      useCase: "General purpose text generation",
      releaseDate: "2025-01-01",
      architecture: "qwen3_moe",
      provenance: "llmfit@abc123",
    }

    const candidate = toModelCandidate(seed)

    expect(candidate.id).toBe("Qwen/Qwen3-35B-A3B")
    expect(candidate.author).toBe("qwen")
    expect(candidate.parameterCount).toBe(35000000000)
    expect(candidate.activeParameterCount).toBe(5000000000)
    expect(candidate.trainedContext).toBe(131072)
    expect(candidate.capabilities).toEqual(["vision"])
    expect(candidate.license).toBe("apache-2.0")
    expect(candidate.provenance.source).toBe("seed")
    expect(candidate.provenance.freshness).toBe("seed")
    expect(candidate.policy.allowed).toBe(true)
    expect(candidate.tags).toContain("gguf")
    expect(candidate.tags).toContain("Q4_K_M")
  })

  test("marks non-gguf formats as not allowed", () => {
    const seed = {
      repository: "Qwen/Qwen3-35B-A3B",
      name: "Qwen3-35B-A3B",
      author: "qwen",
      parameterCount: 35000000000,
      activeParameterCount: null,
      trainedContext: 131072,
      pipelineTag: "text-generation",
      capabilities: [],
      languages: [],
      license: "apache-2.0",
      downloads: 12000,
      likes: 800,
      quantization: "Q4_K_M",
      format: "mlx" as const,
      isMoe: false,
      numExperts: null,
      activeExperts: null,
      hiddenLayers: null,
      attentionHeads: null,
      kvHeads: null,
      headDim: null,
      hiddenSize: null,
      vocabSize: null,
      moeIntermediateSize: null,
      sharedExpertIntermediateSize: null,
      minRamGb: 16,
      recommendedRamGb: 32,
      minVramGb: 8,
      useCase: "General purpose text generation",
      releaseDate: null,
      architecture: "qwen3",
      provenance: "llmfit@abc123",
    }

    const candidate = toModelCandidate(seed)

    expect(candidate.policy.allowed).toBe(false)
    expect(candidate.policy.reasons).toContain("unsupported format: mlx")
  })
})
