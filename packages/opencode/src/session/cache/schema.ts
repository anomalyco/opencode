export interface CacheInput {
  sessionID: string
  model: string
  messages: string[]
  temperature: number | undefined
  toolCount: number
}

export interface CacheEntryValue {
  text: string
  toolCalls: ToolCallItem[]
  finishReason: string
  tokenUsage: UsageItem
  responseTime: number
}

export interface ToolCallItem {
  id: string
  name: string
  input: string
  output?: string
}

export interface UsageItem {
  prompt: number
  completion: number
  total: number
}

export interface CacheStats {
  hits: number
  misses: number
  expires: number
  evictions: number
  tierExactHits: number
  tierPrefixHits: number
  tierSemanticHits: number
}

export interface CacheHit {
  strategy: "exact" | "prefix" | "semantic"
  entry: CacheEntry
  confidence: number
  utility: number
  divergence: number
}

export interface ResponseCacheConfig {
  enabled: boolean
  maxSize?: number
  maxBytes?: number
  ttlSeconds?: number
  trieBreakevenPrefixLen?: number
  trieMaxEntries?: number
  semanticDims?: number
  semanticMinSimilarity?: number
  semanticMaxEntries?: number
  utilMinMs?: number
  minPrefixLen?: number
  minConfidence?: number
  maxDivergence?: number
}

export interface CacheEntry {
  key: string
  value: CacheEntryValue
  createdAt: number
  lastAccessed: number
  accessCount: number
  size: number
  sessionID: string
  model: string
}
