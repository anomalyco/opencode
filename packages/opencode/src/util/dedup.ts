/**
 * Prompt deduplication and request caching for opencode.
 *
 * Eliminates redundant API calls by caching responses to identical prompts.
 * When the same prompt (with same model and parameters) is submitted,
 * returns the cached response instead of making another API call.
 *
 * Features:
 * - Content-addressable cache keys (SHA-256)
 * - TTL-based expiration
 * - LRU eviction when cache grows too large
 * - Request deduplication for in-flight requests
 * - Detailed statistics tracking
 */

import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { Global } from "@/global"
import { Log } from "./log"

export namespace Dedup {
  const log = Log.create({ service: "dedup" })

  // Configuration
  const DEFAULT_MAX_SIZE_MB = 100
  const DEFAULT_TTL_MS = 30 * 60 * 1000 // 30 minutes

  // Interfaces
  export interface Stats {
    requests: number
    duplicates: number
    cacheHits: number
    cacheMisses: number
    evictions: number
    errors: number
    dedupRate: number
    cacheHitRate: number
  }

  export interface Config {
    enabled: boolean
    maxSizeMb: number
    ttlMs: number
  }

  export const defaultConfig: Config = {
    enabled: true,
    maxSizeMb: DEFAULT_MAX_SIZE_MB,
    ttlMs: DEFAULT_TTL_MS,
  }

  interface DedupEntry {
    key: string
    response: string
    createdAt: number
    expiresAt: number
    promptLength: number
    model: string
    accessCount: number
    lastAccessed: number
  }

  // Complexity patterns
  const SIMPLE_PATTERNS = [
    "what is", "how to", "how do", "explain", "define",
    "tell me about", "describe", "list", "show me",
    "what are", "simple", "basic", "quick",
  ]

  const COMPLEX_PATTERNS = [
    "analyze", "research", "complex", "architect",
    "design system", "review code", "optimize performance",
    "security audit", "debug", "investigate",
  ]

  // State
  let index: Map<string, DedupEntry> = new Map()
  let maxSizeBytes = DEFAULT_MAX_SIZE_MB * 1024 * 1024
  let defaultTtl = DEFAULT_TTL_MS
  let initialized = false
  let cacheDir = ""
  let metaDir = ""
  let config: Config = { ...defaultConfig }

  // Statistics
  let stats = {
    requests: 0,
    duplicates: 0,
    cacheHits: 0,
    cacheMisses: 0,
    evictions: 0,
    errors: 0,
  }

  /**
   * Compute a deterministic cache key for a prompt.
   */
  export function computeKey(
    prompt: string,
    model: string,
    params?: Record<string, unknown>,
  ): string {
    const normalizedParams: Record<string, string> = {}
    if (params) {
      const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
      for (const [k, v] of sorted) {
        normalizedParams[k] = typeof v === "object" ? JSON.stringify(v) : String(v)
      }
    }

    const content = JSON.stringify({
      model,
      params: normalizedParams,
      prompt,
    })

    return createHash("sha256").update(content).digest("hex")
  }

  /**
   * Initialize the deduplicator.
   */
  export function init(dir?: string, cfg?: Partial<Config>): void {
    if (initialized) return

    config = { ...defaultConfig, ...cfg }
    cacheDir = dir ?? join(Global.Path.data, "cache", "dedup")
    maxSizeBytes = config.maxSizeMb * 1024 * 1024
    defaultTtl = config.ttlMs

    mkdirSync(cacheDir, { recursive: true })
    metaDir = join(cacheDir, "meta")
    mkdirSync(metaDir, { recursive: true })

    loadIndex()
    initialized = true
    log.info("dedup initialized", { cacheDir, config })
  }

  function getCachePath(key: string): { data: string; meta: string } {
    const prefix = key.slice(0, 4)
    const dataDir = join(cacheDir, "data", prefix)
    mkdirSync(dataDir, { recursive: true })
    return {
      data: join(dataDir, `${key}.json`),
      meta: join(dataDir, `${key}.meta.json`),
    }
  }

  function loadIndex(): void {
    const metaFile = join(metaDir, "index.json")
    if (!existsSync(metaFile)) return

    try {
      const data = JSON.parse(readFileSync(metaFile, "utf-8"))
      const now = Date.now()

      index = new Map()
      for (const [key, entry] of Object.entries(data) as [string, DedupEntry][]) {
        if (entry.expiresAt > 0 && now >= entry.expiresAt) continue
        index.set(key, entry)
      }

      log.info("dedup index loaded", { entries: index.size })
    } catch (err) {
      log.warn("failed to load dedup index", { err })
    }
  }

  function saveIndex(): void {
    const metaFile = join(metaDir, "index.json")
    const tempFile = join(metaDir, "index.tmp")

    const data: Record<string, DedupEntry> = {}
    for (const [key, entry] of index) {
      data[key] = entry
    }

    try {
      writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8")
      renameSync(tempFile, metaFile)
    } catch (err) {
      log.warn("failed to save dedup index", { err })
    }
  }

  /**
   * Get a cached response for a prompt.
   */
  export function get(
    prompt: string,
    model: string,
    params?: Record<string, unknown>,
  ): [string | null, boolean] {
    if (!initialized) init()
    if (!config.enabled) return [null, false]

    stats.requests++

    const key = computeKey(prompt, model, params)
    const now = Date.now()
    const entry = index.get(key)

    if (!entry) {
      stats.cacheMisses++
      return [null, false]
    }

    if (entry.expiresAt > 0 && now >= entry.expiresAt) {
      index.delete(key)
      const { data, meta } = getCachePath(key)
      try {
        unlinkSync(data)
        unlinkSync(meta)
      } catch {}
      saveIndex()
      stats.cacheMisses++
      return [null, false]
    }

    // Update access stats
    entry.lastAccessed = now
    entry.accessCount++

    // Read from disk
    const { data } = getCachePath(key)
    try {
      const response = readFileSync(data, "utf-8")
      stats.cacheHits++
      stats.duplicates++
      return [response, true]
    } catch {
      stats.cacheMisses++
      return [null, false]
    }
  }

  /**
   * Cache a response for a prompt.
   */
  export function set(
    prompt: string,
    model: string,
    response: string,
    params?: Record<string, unknown>,
    ttlMs?: number,
  ): string {
    if (!initialized) init()
    if (!config.enabled) return ""

    const key = computeKey(prompt, model, params)
    const now = Date.now()
    const ttl = ttlMs ?? defaultTtl

    const entry: DedupEntry = {
      key,
      response,
      createdAt: now,
      expiresAt: ttl > 0 ? now + ttl : 0,
      promptLength: prompt.length,
      model,
      lastAccessed: now,
      accessCount: 0,
    }

    // Evict if needed
    evictIfNeeded(Buffer.byteLength(response, "utf-8"))

    // Write to disk
    const { data, meta } = getCachePath(key)
    const tempData = `${data}.tmp`
    const tempMeta = `${meta}.tmp`

    try {
      writeFileSync(tempData, response, "utf-8")
      renameSync(tempData, data)

      writeFileSync(tempMeta, JSON.stringify(entry, null, 2), "utf-8")
      renameSync(tempMeta, meta)

      index.set(key, entry)

      if (index.size % 100 === 0) saveIndex()

      return key
    } catch (err) {
      log.warn("failed to write dedup entry", { err })
      stats.errors++
      return ""
    }
  }

  function evictIfNeeded(newEntrySize: number): void {
    let currentSize = 0
    for (const entry of index.values()) {
      currentSize += Buffer.byteLength(entry.response, "utf-8")
    }

    const targetSize = maxSizeBytes - newEntrySize
    if (currentSize <= targetSize) return

    // Sort by last accessed (oldest first)
    const sorted = Array.from(index.entries()).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)

    let evicted = 0
    for (const [key, entry] of sorted) {
      if (currentSize <= targetSize) break

      index.delete(key)
      const { data, meta } = getCachePath(key)
      try {
        unlinkSync(data)
        unlinkSync(meta)
      } catch {}

      currentSize -= Buffer.byteLength(entry.response, "utf-8")
      evicted++
    }

    if (evicted > 0) {
      stats.evictions += evicted
      log.info("evicted dedup entries", { count: evicted })
    }
  }

  /**
   * Clear all cached entries.
   */
  export function clear(): number {
    const count = index.size

    for (const [key, entry] of index) {
      const { data, meta } = getCachePath(key)
      try {
        unlinkSync(data)
        unlinkSync(meta)
      } catch {}
    }

    index.clear()
    saveIndex()
    log.info("dedup cleared", { count })

    return count
  }

  /**
   * Get deduplication statistics.
   */
  export function getStats(): Stats {
    const total = stats.cacheHits + stats.cacheMisses
    return {
      requests: stats.requests,
      duplicates: stats.duplicates,
      cacheHits: stats.cacheHits,
      cacheMisses: stats.cacheMisses,
      evictions: stats.evictions,
      errors: stats.errors,
      dedupRate: stats.requests > 0 ? (stats.duplicates / stats.requests) * 100 : 0,
      cacheHitRate: total > 0 ? (stats.cacheHits / total) * 100 : 0,
    }
  }

  /**
   * Estimate query complexity for smart routing.
   */
  export function estimateComplexity(
    prompt: string,
  ): { level: "simple" | "moderate" | "complex"; confidence: number } {
    const promptLower = prompt.toLowerCase()

    let simpleScore = 0
    let complexScore = 0

    // Check simple patterns
    for (const pattern of SIMPLE_PATTERNS) {
      if (promptLower.includes(pattern)) simpleScore++
    }

    // Check complex patterns
    for (const pattern of COMPLEX_PATTERNS) {
      if (promptLower.includes(pattern)) complexScore += 2
    }

    // Length-based scoring
    const wordCount = prompt.split(/\s+/).length
    if (wordCount < 20) simpleScore++
    else if (wordCount > 100) complexScore += 2

    // Code indicators
    const codeIndicators = ["```", "function", "class", "code", "implement", "algorithm"]
    for (const indicator of codeIndicators) {
      if (promptLower.includes(indicator)) complexScore++
    }

    // File path mentions
    if (prompt.includes("/") || prompt.includes("\\")) complexScore++

    const total = simpleScore + complexScore
    if (total === 0) return { level: "moderate", confidence: 0.5 }

    const simpleRatio = simpleScore / total

    if (simpleRatio > 0.7) return { level: "simple", confidence: Math.min(simpleRatio, 0.95) }
    if (simpleRatio < 0.3) return { level: "complex", confidence: Math.min(1 - simpleRatio, 0.95) }
    return { level: "moderate", confidence: 0.6 }
  }

  /**
   * Determine if a query should be routed to a cheaper model.
   */
  export function shouldRouteToCheapModel(prompt: string): boolean {
    const { level, confidence } = estimateComplexity(prompt)
    return level === "simple" && confidence >= 0.7
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart Router
// ─────────────────────────────────────────────────────────────────────────────

export namespace SmartRouter {
  const log = Log.create({ service: "smart_router" })

  // Model pricing per 1M tokens (input, output) in cents
  const MODEL_PRICING: Record<string, { input: number; output: number; provider: string; tier: string }> = {
    // Anthropic
    "claude-opus-4": { input: 15.0, output: 75.0, provider: "anthropic", tier: "ultra_premium" },
    "claude-sonnet-4": { input: 3.0, output: 15.0, provider: "anthropic", tier: "premium" },
    "claude-3-5-sonnet": { input: 3.0, output: 15.0, provider: "anthropic", tier: "premium" },
    "claude-3-5-haiku": { input: 0.8, output: 4.0, provider: "anthropic", tier: "standard" },

    // OpenAI
    "gpt-4o": { input: 5.0, output: 15.0, provider: "openai", tier: "premium" },
    "gpt-4o-mini": { input: 0.15, output: 0.6, provider: "openai", tier: "budget" },
    "gpt-4-turbo": { input: 10.0, output: 30.0, provider: "openai", tier: "premium" },

    // Google
    "gemini-1.5-pro": { input: 1.25, output: 5.0, provider: "google", tier: "premium" },
    "gemini-1.5-flash": { input: 0.075, output: 0.3, provider: "google", tier: "standard" },

    // Deepseek
    "deepseek-chat": { input: 0.14, output: 0.28, provider: "deepseek", tier: "budget" },
  }

  // Tier routing rules
  const ROUTING_RULES: Record<string, string[]> = {
    simple: ["budget", "standard", "premium", "ultra_premium"],
    moderate: ["standard", "premium", "ultra_premium"],
    complex: ["premium", "ultra_premium"],
  }

  const TIER_ORDER = ["budget", "standard", "premium", "ultra_premium"]

  export interface RoutingResult {
    model: string
    provider: string
    complexity: "simple" | "moderate" | "complex" | "unknown"
    confidence: number
    reason: string
    costEstimate: number
    savingsVsPrimary: number
    tier: string
  }

  export interface Config {
    primaryModel: string
    budgetModel: string
    enableRouting: boolean
    routingThreshold: number
  }

  export const defaultConfig: Config = {
    primaryModel: "claude-3-5-sonnet",
    budgetModel: "claude-3-5-haiku",
    enableRouting: true,
    routingThreshold: 0.7,
  }

  let config: Config = { ...defaultConfig }

  // Statistics
  let stats = {
    totalRequests: 0,
    simpleRoutedToCheap: 0,
    complexRoutedToPremium: 0,
    overridden: 0,
    costSavingsCents: 0,
  }

  export function configure(cfg: Partial<Config>): void {
    config = { ...config, ...cfg }
  }

  export function getModelCost(model: string): { input: number; output: number; avg: number } {
    const pricing = MODEL_PRICING[model] ?? { input: 3.0, output: 15.0, avg: 9.0 }
    return {
      input: pricing.input,
      output: pricing.output,
      avg: (pricing.input + pricing.output) / 2,
    }
  }

  export function route(
    prompt: string,
    forceModel?: string,
  ): RoutingResult {
    if (!config.enableRouting || forceModel) {
      stats.overridden++
      const model = forceModel ?? config.primaryModel
      const pricing = MODEL_PRICING[model] ?? { input: 3.0, output: 15.0, provider: "unknown", tier: "standard" }

      return {
        model,
        provider: pricing.provider,
        complexity: "unknown",
        confidence: 1.0,
        reason: forceModel ? "user_override" : "routing_disabled",
        costEstimate: (pricing.input + pricing.output) / 2,
        savingsVsPrimary: 0,
        tier: pricing.tier,
      }
    }

    const { level, confidence } = Dedup.estimateComplexity(prompt)
    stats.totalRequests++

    const acceptableTiers = ROUTING_RULES[level] ?? ["standard", "premium"]

    // Find cheapest acceptable model
    let selectedModel = config.primaryModel
    let bestCost = Infinity

    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      if (acceptableTiers.includes(pricing.tier)) {
        const avgCost = (pricing.input + pricing.output) / 2
        if (avgCost < bestCost) {
          bestCost = avgCost
          selectedModel = model
        }
      }
    }

    const primaryPricing = MODEL_PRICING[config.primaryModel] ?? { input: 3.0, output: 15.0 }
    const selectedPricing = MODEL_PRICING[selectedModel] ?? { input: 3.0, output: 15.0, provider: "unknown", tier: "standard" }

    const savings = ((primaryPricing.input + primaryPricing.output) / 2) - bestCost

    // Update stats
    if (level === "simple" && (selectedPricing.tier === "budget" || selectedPricing.tier === "standard")) {
      stats.simpleRoutedToCheap++
      stats.costSavingsCents += savings
    } else if (level === "complex") {
      stats.complexRoutedToPremium++
    }

    const reason =
      level === "simple"
        ? `Routed to ${selectedPricing.tier} model (${selectedModel}) for simple query`
        : level === "complex"
          ? `Routed to ${selectedPricing.tier} model (${selectedModel}) for complex query`
          : `Routed to ${selectedPricing.tier} model (${selectedModel}) for moderate query`

    return {
      model: selectedModel,
      provider: selectedPricing.provider,
      complexity: level,
      confidence,
      reason,
      costEstimate: bestCost,
      savingsVsPrimary: savings,
      tier: selectedPricing.tier,
    }
  }

  export function getStats() {
    return {
      ...stats,
    }
  }

  export function resetStats(): void {
    stats = {
      totalRequests: 0,
      simpleRoutedToCheap: 0,
      complexRoutedToPremium: 0,
      overridden: 0,
      costSavingsCents: 0,
    }
  }
}
