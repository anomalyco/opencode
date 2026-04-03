import { Log } from "@/util/log"

export namespace TOON {
  const log = Log.create({ service: "toon" })

  export type Mode = "compact" | "balanced" | "verbose"

  export interface Options {
    mode: Mode
    preserveCode: boolean
    enableDuplicateDetection?: boolean
  }

  // Phase 1: Abbreviation Dictionary
  const abbreviations = {
    verbs: {
      implement: "impl",
      initialize: "init",
      validate: "val",
      process: "proc",
      execute: "exec",
      create: "crt",
      delete: "del",
      update: "upd",
      retrieve: "ret",
      generate: "gen",
      transform: "xfm",
      convert: "conv",
      configure: "cfg",
      optimize: "opt",
      analyze: "ana",
      evaluate: "eval",
      calculate: "calc",
      determine: "det",
      establish: "est",
      maintain: "maint",
    },
    nouns: {
      interface: "iface",
      component: "comp",
      service: "svc",
      controller: "ctrl",
      middleware: "mw",
      repository: "repo",
      database: "db",
      application: "app",
      configuration: "cfg",
      parameter: "param",
      variable: "var",
      function: "fn",
      method: "meth",
      property: "prop",
      attribute: "attr",
      element: "elem",
      object: "obj",
      instance: "inst",
      module: "mod",
      package: "pkg",
    },
    adjectives: {
      important: "imp",
      required: "req",
      optional: "opt",
      temporary: "tmp",
      permanent: "perm",
      primary: "prim",
      secondary: "sec",
      internal: "int",
      external: "ext",
      public: "pub",
    },
    domain: {
      authentication: "auth",
      authorization: "authz",
      encryption: "enc",
      compression: "comp",
      serialization: "ser",
      deserialization: "deser",
      validation: "val",
      verification: "ver",
      notification: "notif",
      transaction: "txn",
    },
  }

  // Phase 2: Conjunction and Preposition Rules
  const conjunctionRules = [
    { pattern: /\band\b/gi, replacement: "&" },
    { pattern: /\bor\b/gi, replacement: "|" },
    { pattern: /\bis\s+a\b/gi, replacement: "is" },
    { pattern: /\bis\s+an\b/gi, replacement: "is" },
    { pattern: /\bwith\s+the\b/gi, replacement: "with" },
    { pattern: /\bfrom\s+the\b/gi, replacement: "from" },
  ]

  // Phase 3: Symbol Substitution Rules (only in compact mode)
  const symbolRules = [
    { pattern: /\breturns?\b/gi, replacement: "→" },
    { pattern: /\bequals?\b/gi, replacement: "=" },
    { pattern: /\bgreater\s+than\s+or\s+equal\b/gi, replacement: ">=" },
    { pattern: /\bless\s+than\s+or\s+equal\b/gi, replacement: "<=" },
    { pattern: /\bgreater\s+than\b/gi, replacement: ">" },
    { pattern: /\bless\s+than\b/gi, replacement: "<" },
  ]

  /**
   * Transform natural language text to TOON format
   * Uses heuristic rules to create compact representations
   */
  export function serialize(text: string, options: Options): string {
    const { mode, preserveCode, enableDuplicateDetection } = options

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

    // Apply duplicate detection if enabled
    if (enableDuplicateDetection) {
      processed = collapseDuplicates(processed)
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
      savings: `${((1 - processed.length / text.length) * 100).toFixed(2)}%`,
    })

    return processed
  }

  function applyAbbreviations(text: string, categories: (keyof typeof abbreviations)[]): string {
    let result = text
    for (const category of categories) {
      const dict = abbreviations[category]
      for (const [word, abbr] of Object.entries(dict)) {
        result = result.replace(new RegExp(`\\b${word}\\b`, "gi"), abbr)
      }
    }
    return result
  }

  function applyConjunctions(text: string): string {
    let result = text
    for (const rule of conjunctionRules) {
      result = result.replace(rule.pattern, rule.replacement)
    }
    return result
  }

  function applySymbols(text: string): string {
    let result = text
    for (const rule of symbolRules) {
      result = result.replace(rule.pattern, rule.replacement)
    }
    return result
  }

  // Phase 5: Duplicate Detection
  interface DuplicateMap {
    phrases: Map<string, number>
    markers: Map<number, string>
  }

  function detectDuplicates(text: string): DuplicateMap {
    const sentences = text.split(/[.!?;]\s+/).filter((s) => s.trim())
    const phrases = new Map<string, number>()
    const markers = new Map<number, string>()

    for (let i = 0; i < sentences.length; i++) {
      const normalized = sentences[i]
        .toLowerCase()
        .trim()
        .replace(/[.!?;]+$/, "")
        .replace(/__code_block_\d+__/g, " ")
        .replace(/\s+/g, " ")
        .trim()

      if (!normalized) continue

      if (phrases.has(normalized)) {
        const firstIndex = phrases.get(normalized)
        if (firstIndex !== undefined) {
          markers.set(i, `[dup:${firstIndex}]`)
        }
      } else {
        phrases.set(normalized, i)
      }
    }

    return { phrases, markers }
  }

  function collapseDuplicates(text: string): string {
    const duplicates = detectDuplicates(text)

    if (duplicates.markers.size === 0) {
      return text
    }

    const sentences = text.split(/[.!?;]\s+/).filter((s) => s.trim())
    const result: string[] = []

    for (let i = 0; i < sentences.length; i++) {
      const marker = duplicates.markers.get(i)
      if (marker) {
        result.push(marker)
      } else {
        result.push(sentences[i])
      }
    }

    return result.join(". ")
  }

  /**
   * Compact mode: Maximum token reduction
   * - Remove articles (a, an, the)
   * - Abbreviate common words
   * - Use symbols for common operations
   */
  function applyCompactRules(text: string): string {
    let result = text
    // Apply all abbreviation categories
    result = applyAbbreviations(result, ["verbs", "nouns", "adjectives", "domain"])
    // Apply conjunctions
    result = applyConjunctions(result)
    // Apply symbols
    result = applySymbols(result)
    // Remove articles
    result = result.replace(/\b(a|an|the)\b/gi, "")
    // Compact whitespace
    result = result.replace(/\s+/g, " ").trim()
    return result
  }

  /**
   * Balanced mode: Moderate reduction with readability
   * - Selective abbreviations
   * - Preserve sentence structure
   */
  function applyBalancedRules(text: string): string {
    let result = text
    // Apply selective abbreviations (nouns and domain)
    result = applyAbbreviations(result, ["nouns", "domain"])
    // Normalize whitespace
    result = result.replace(/\s+/g, " ").trim()
    return result
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
