export * as Token from "./token"

const cache = new Map<string, number>()
const MAX_CACHE = 5_000

const DEFAULT_CHARS_PER_TOKEN = 2.8

const MODEL_FAMILY_RATIOS: Record<string, number> = {
  "gpt-4": 2.8,
  "gpt-4o": 2.8,
  "gpt-5": 2.8,
  "o1": 2.8,
  "o3": 2.8,
  "claude": 2.7,
  "gemini": 3.0,
  "deepseek": 2.5,
  "llama": 3.0,
  "mistral": 3.0,
  "codestral": 2.5,
}

export type EstimateOptions = {
  model?: string
}

function getRatio(options?: EstimateOptions): number {
  if (options?.model) {
    const lower = options.model.toLowerCase()
    for (const [prefix, ratio] of Object.entries(MODEL_FAMILY_RATIOS)) {
      if (lower.includes(prefix)) return ratio
    }
  }
  return DEFAULT_CHARS_PER_TOKEN
}

function simpleHash(s: string): number {
  let hash = 5381
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i)
  }
  return hash >>> 0
}

export const estimate = (input: string, options?: EstimateOptions) => {
  if (!input) return 0
  const modelKey = options?.model ?? ""
  const cacheKey = input.length > 200 ? `${modelKey}:${input.length}:${simpleHash(input)}` : `${modelKey}:${input}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached
  const ratio = getRatio(options)
  const result = Math.max(0, Math.round(input.length / ratio))
  if (cache.size >= MAX_CACHE) cache.clear()
  cache.set(cacheKey, result)
  return result
}
