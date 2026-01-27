import { Log } from "@/util/log"

export namespace TOON {
  const log = Log.create({ service: "toon" })

  export type Mode = "compact" | "balanced" | "verbose"

  export interface Options {
    mode: Mode
    preserveCode: boolean
  }

  /**
   * Transform natural language text to TOON format
   * Uses heuristic rules to create compact representations
   */
  export function serialize(text: string, options: Options): string {
    const { mode, preserveCode } = options

    // Preserve code blocks if configured
    const codeBlocks: string[] = []
    let processed = text

    if (preserveCode) {
      processed = text.replace(/```[\s\S]*?```/g, (match) => {
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`
        codeBlocks.push(match)
        return placeholder
      })
    }

    // Apply transformations based on mode
    switch (mode) {
      case "compact":
        processed = applyCompactRules(processed)
        break
      case "balanced":
        processed = applyBalancedRules(processed)
        break
      case "verbose":
        processed = applyVerboseRules(processed)
        break
    }

    // Restore code blocks
    if (preserveCode) {
      codeBlocks.forEach((block, i) => {
        processed = processed.replace(`__CODE_BLOCK_${i}__`, block)
      })
    }

    log.debug("toon.serialize", {
      originalLength: text.length,
      processedLength: processed.length,
      savings: ((1 - processed.length / text.length) * 100).toFixed(2) + "%",
    })

    return processed
  }

  /**
   * Compact mode: Maximum token reduction
   * - Remove articles (a, an, the)
   * - Abbreviate common words
   * - Use symbols for common operations
   */
  function applyCompactRules(text: string): string {
    return text
      // Remove articles
      .replace(/\b(a|an|the)\b/gi, "")
      // Common abbreviations
      .replace(/\bfunction\b/gi, "fn")
      .replace(/\breturn\b/gi, "ret")
      .replace(/\bvariable\b/gi, "var")
      .replace(/\bparameter\b/gi, "param")
      .replace(/\bconfiguration\b/gi, "config")
      .replace(/\bapplication\b/gi, "app")
      .replace(/\bdatabase\b/gi, "db")
      .replace(/\brepository\b/gi, "repo")
      // Compact whitespace
      .replace(/\s+/g, " ")
      .trim()
  }

  /**
   * Balanced mode: Moderate reduction with readability
   * - Selective abbreviations
   * - Preserve sentence structure
   */
  function applyBalancedRules(text: string): string {
    return text
      // Common technical abbreviations
      .replace(/\bfunction\b/gi, "fn")
      .replace(/\bparameter\b/gi, "param")
      .replace(/\bconfiguration\b/gi, "config")
      .replace(/\bapplication\b/gi, "app")
      .replace(/\bdatabase\b/gi, "db")
      // Normalize whitespace
      .replace(/\s+/g, " ")
      .trim()
  }

  /**
   * Verbose mode: Minimal transformation
   * - Only normalize whitespace
   */
  function applyVerboseRules(text: string): string {
    return text.replace(/\s+/g, " ").trim()
  }

  /**
   * Estimate token savings from TOON transformation
   * Uses rough approximation: 1 token ≈ 4 characters
   */
  export function estimateSavings(original: string, transformed: string): number {
    const originalTokens = Math.ceil(original.length / 4)
    const transformedTokens = Math.ceil(transformed.length / 4)
    return originalTokens - transformedTokens
  }

  /**
   * Calculate savings percentage
   */
  export function calculateSavingsPercentage(original: string, transformed: string): number {
    const originalTokens = Math.ceil(original.length / 4)
    const savedTokens = estimateSavings(original, transformed)
    return originalTokens > 0 ? (savedTokens / originalTokens) * 100 : 0
  }
}
