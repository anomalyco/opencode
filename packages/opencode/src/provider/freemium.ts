import { Log } from "../util/log"
import { Installation } from "../installation"

export namespace Freemium {
  const log = Log.create({ service: "freemium" })
  const CACHE_DURATION = 15 * 60 * 1000 // 15 minutes
  let cache: { models: OpenRouterModel[]; timestamp: number } | null = null

  export enum TaskComplexity {
    SIMPLE = "simple",
    MEDIUM = "medium",
    COMPLEX = "complex",
  }

  export interface OpenRouterModel {
    id: string
    name: string
    context_length: number
    pricing: {
      prompt: string
      completion: string
    }
    top_provider: {
      max_completion_tokens: number
    }
    supported_parameters: string[]
    architecture: {
      input_modalities: string[]
    }
  }

  export interface ScoredModel {
    model: OpenRouterModel
    score: number
  }

  let currentComplexity: TaskComplexity = TaskComplexity.MEDIUM

  const recentlyUsed: string[] = []
  const rateLimited = new Map<string, { until: number; duration: number }>()

  export async function getFreeModels(): Promise<OpenRouterModel[]> {
    const now = Date.now()
    if (cache && now - cache.timestamp < CACHE_DURATION) {
      return cache.models
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "User-Agent": Installation.USER_AGENT },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`)
      }

      const data = (await response.json()) as { data: OpenRouterModel[] }
      const freeModels = data.data.filter(
        (m) => m.pricing.prompt === "0" && m.pricing.completion === "0",
      )

      cache = { models: freeModels, timestamp: now }
      log.info("fetched free models", { count: freeModels.length })

      return freeModels
    } catch (error) {
      log.error("failed to fetch models", { error })
      return cache?.models ?? []
    }
  }

  export function setComplexity(complexity: TaskComplexity) {
    currentComplexity = complexity
  }

  export function selectBestModel(
    models: OpenRouterModel[],
    estimatedTokens: number = 0,
    complexity: TaskComplexity = currentComplexity,
  ): OpenRouterModel | null {
    if (models.length === 0) return null

    const availableModels = models.filter((m) => !isRateLimited(m.id))
    if (availableModels.length === 0) {
      log.warn("all models rate limited, using least recently limited")
      return selectFallbackModel(models)
    }

    const scored: ScoredModel[] = availableModels.map((model) => ({
      model,
      score: scoreModel(model, estimatedTokens, complexity),
    }))

    scored.sort((a, b) => b.score - a.score)

    const selected = scored[0].model
    markUsed(selected.id)

    log.info("selected model", {
      id: selected.id,
      score: scored[0].score,
      context: selected.context_length,
      complexity,
    })

    return selected
  }

  function selectFallbackModel(models: OpenRouterModel[]): OpenRouterModel | null {
    const rateLimitedModels = Array.from(rateLimited.entries())
      .sort((a, b) => a[1].until - b[1].until)
      .map(([id]) => id)

    const fallback = models.find((m) => m.id === rateLimitedModels[0])
    if (fallback) {
      log.info("using fallback model", { id: fallback.id })
      return fallback
    }

    return models[0] ?? null
  }

  function scoreModel(
    model: OpenRouterModel,
    estimatedTokens: number,
    complexity: TaskComplexity,
  ): number {
    let score = 100

    const config = {
      contextLength200k: 30,
      contextLength100k: 20,
      contextLength50k: 10,
      toolsSupport: 15,
      imageSupport: 10,
      gpt4ClaudeGemini: 20,
      deepseekGrok: 15,
      recentUsagePenalty: 30,
      rateLimitPenalty: 1000,
      insufficientContextPenalty: 50,
    }

    if (model.context_length > 200000) score += config.contextLength200k
    else if (model.context_length > 100000) score += config.contextLength100k
    else if (model.context_length > 50000) score += config.contextLength50k

    if (estimatedTokens > 0 && model.context_length < estimatedTokens) {
      score -= config.insufficientContextPenalty
    }

    const supportsTools = model.supported_parameters?.includes("tools")
    if (supportsTools) score += config.toolsSupport

    const supportsImages = model.architecture?.input_modalities?.includes("image")
    if (supportsImages) score += config.imageSupport

    const name = model.name.toLowerCase()
    const isPremiumModel =
      name.includes("gpt-4") || name.includes("claude") || name.includes("gemini")
    const isMidTierModel = name.includes("deepseek") || name.includes("grok")

    if (isPremiumModel) {
      score += config.gpt4ClaudeGemini
      if (complexity === TaskComplexity.COMPLEX) score += 40
      else if (complexity === TaskComplexity.MEDIUM) score += 20
    } else if (isMidTierModel) {
      score += config.deepseekGrok
      if (complexity === TaskComplexity.COMPLEX) score += 20
      else if (complexity === TaskComplexity.MEDIUM) score += 10
    } else {
      if (complexity === TaskComplexity.SIMPLE) score += 5
    }

    if (recentlyUsed.includes(model.id)) {
      score -= config.recentUsagePenalty
    }

    if (isRateLimited(model.id)) {
      score -= config.rateLimitPenalty
    }

    return score
  }

  function markUsed(modelId: string) {
    recentlyUsed.unshift(modelId)
    if (recentlyUsed.length > 5) {
      recentlyUsed.pop()
    }
  }

  export function markRateLimited(modelId: string, durationMs: number = 5 * 60 * 1000) {
    rateLimited.set(modelId, { until: Date.now() + durationMs, duration: durationMs })
    log.warn("model rate limited", { id: modelId, duration: durationMs })
  }

  function isRateLimited(modelId: string): boolean {
    const data = rateLimited.get(modelId)
    if (!data) return false

    if (Date.now() >= data.until) {
      rateLimited.delete(modelId)
      return false
    }

    return true
  }

  export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  export function detectComplexity(prompt: string, toolCount: number = 0): TaskComplexity {
    const complexKeywords = [
      "refactor",
      "architect",
      "design",
      "implement",
      "complex",
      "algorithm",
      "optimize",
      "debug",
      "analyze entire",
      "large codebase",
      "multiple files",
      "system design",
    ]

    const simpleKeywords = [
      "fix typo",
      "add comment",
      "rename",
      "delete",
      "simple change",
      "update text",
      "change color",
    ]

    const lowerPrompt = prompt.toLowerCase()
    const tokenCount = estimateTokens(prompt)

    if (simpleKeywords.some((kw) => lowerPrompt.includes(kw))) {
      return TaskComplexity.SIMPLE
    }

    const complexMatches = complexKeywords.filter((kw) => lowerPrompt.includes(kw)).length
    if (complexMatches >= 2 || tokenCount > 4000 || toolCount > 10) {
      return TaskComplexity.COMPLEX
    }

    if (complexMatches === 1 || tokenCount > 2000 || toolCount > 5) {
      return TaskComplexity.MEDIUM
    }

    return TaskComplexity.SIMPLE
  }
}
