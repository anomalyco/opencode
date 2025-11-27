import { createHash } from "crypto"
import { Log } from "../util/log"

export namespace CacheOptimizer {
  const log = Log.create({ service: "cache-optimizer" })

  /**
   * Normalize whitespace to maximize cache hits
   * - Trim leading/trailing whitespace
   * - Collapse multiple spaces to single space
   * - Normalize line endings to \n
   */
  function normalizeWhitespace(text: string): string {
    return (
      text
        .trim()
        // Normalize line endings
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        // Collapse multiple spaces
        .replace(/ +/g, " ")
        // Collapse multiple newlines (keep max 2)
        .replace(/\n{3,}/g, "\n\n")
    )
  }

  /**
   * Canonicalize file paths to maximize cache hits
   * - Convert absolute paths to relative
   * - Normalize path separators to /
   * - Remove user-specific paths like /Users/username/
   */
  function canonicalizePaths(text: string, workspaceRoot?: string): string {
    let result = text

    // Normalize path separators
    result = result.replace(/\\/g, "/")

    // Remove common user-specific path prefixes
    const userPrefixes = [
      /\/Users\/[^/]+\//g, // macOS
      /\/home\/[^/]+\//g, // Linux
      /C:\/Users\/[^/]+\//gi, // Windows
    ]

    for (const prefix of userPrefixes) {
      result = result.replace(prefix, "~/")
    }

    // If workspace root provided, make paths relative
    if (workspaceRoot) {
      const normalizedRoot = workspaceRoot.replace(/\\/g, "/")
      result = result.replace(new RegExp(normalizedRoot, "g"), ".")
    }

    return result
  }

  /**
   * Remove non-deterministic metadata
   * - Timestamps
   * - UUIDs (session IDs, message IDs)
   * - Random numbers
   * - Current date/time references
   */
  function removeNonDeterministic(text: string): string {
    let result = text

    // Remove ISO 8601 timestamps
    result = result.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g, "<TIMESTAMP>")

    // Remove Unix timestamps (10 or 13 digits)
    result = result.replace(/\b\d{10,13}\b/g, "<TIMESTAMP>")

    // Remove UUIDs (common formats)
    result = result.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")

    // Remove session/message ID patterns (common in our system)
    result = result.replace(/\b(session|message|id)_[a-z0-9]+/gi, "<ID>")

    // Remove "X minutes/hours/days ago" references
    result = result.replace(/\b\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi, "<TIME_AGO>")

    return result
  }

  /**
   * Hash prompt to create cache key
   */
  function hashPrompt(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 16)
  }

  /**
   * Optimize prompt for maximum cache hit rate
   */
  export function optimize(input: {
    prompt: string
    workspaceRoot?: string
    preserveTimestamps?: boolean
  }): {
    optimized: string
    original: string
    cacheKey: string
    transformations: string[]
  } {
    const transformations: string[] = []
    let result = input.prompt

    // Step 1: Normalize whitespace
    const beforeWhitespace = result
    result = normalizeWhitespace(result)
    if (result !== beforeWhitespace) {
      transformations.push("whitespace_normalized")
    }

    // Step 2: Canonicalize paths
    if (input.workspaceRoot) {
      const beforePaths = result
      result = canonicalizePaths(result, input.workspaceRoot)
      if (result !== beforePaths) {
        transformations.push("paths_canonicalized")
      }
    }

    // Step 3: Remove non-deterministic data (unless preserving timestamps)
    if (!input.preserveTimestamps) {
      const beforeNonDet = result
      result = removeNonDeterministic(result)
      if (result !== beforeNonDet) {
        transformations.push("nondeterministic_removed")
      }
    }

    // Step 4: Generate cache key
    const cacheKey = hashPrompt(result)

    if (transformations.length > 0) {
      log.debug("prompt optimized for cache", {
        cacheKey,
        transformations,
        originalLength: input.prompt.length,
        optimizedLength: result.length,
      })
    }

    return {
      optimized: result,
      original: input.prompt,
      cacheKey,
      transformations,
    }
  }

  /**
   * Check if two prompts would produce the same cache key
   */
  export function wouldMatch(prompt1: string, prompt2: string, workspaceRoot?: string): boolean {
    const opt1 = optimize({ prompt: prompt1, workspaceRoot })
    const opt2 = optimize({ prompt: prompt2, workspaceRoot })
    return opt1.cacheKey === opt2.cacheKey
  }

  /**
   * Analyze cache potential for a set of prompts
   */
  export function analyzeCachePotential(prompts: string[], workspaceRoot?: string) {
    const cacheKeys = new Map<string, number>()
    let totalTransformations = 0

    for (const prompt of prompts) {
      const result = optimize({ prompt, workspaceRoot })
      const count = cacheKeys.get(result.cacheKey) ?? 0
      cacheKeys.set(result.cacheKey, count + 1)
      totalTransformations += result.transformations.length
    }

    const uniqueKeys = cacheKeys.size
    const totalPrompts = prompts.length
    const duplicatePrompts = totalPrompts - uniqueKeys
    const cacheHitRate = duplicatePrompts / totalPrompts

    return {
      totalPrompts,
      uniquePrompts: uniqueKeys,
      duplicatePrompts,
      potentialCacheHitRate: cacheHitRate,
      averageTransformations: totalTransformations / totalPrompts,
      topCacheKeys: Array.from(cacheKeys.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([key, count]) => ({ cacheKey: key, count })),
    }
  }
}
