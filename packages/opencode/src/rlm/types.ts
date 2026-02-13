/**
 * RLM Types - TypeScript port of rlm/core/types.py
 *
 * Core type definitions for the Recursive Language Model system.
 */

// ============================================================
// Backend & Environment Types
// ============================================================

/** Supported LLM client backends */
export type ClientBackend =
  | "openai"
  | "portkey"
  | "openrouter"
  | "vercel"
  | "vllm"
  | "litellm"
  | "anthropic"
  | "azure_openai"
  | "gemini"

/** Supported execution environments */
export type EnvironmentType = "local"

// ============================================================
// Usage Tracking
// ============================================================

export interface ModelUsageSummary {
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
}

export interface UsageSummary {
  modelUsageSummaries: Record<string, ModelUsageSummary>
}

export function emptyUsageSummary(): UsageSummary {
  return { modelUsageSummaries: {} }
}

export function mergeUsageSummaries(a: UsageSummary, b: UsageSummary): UsageSummary {
  const merged = { ...a.modelUsageSummaries }
  for (const [model, usage] of Object.entries(b.modelUsageSummaries)) {
    if (merged[model]) {
      merged[model] = {
        totalCalls: merged[model].totalCalls + usage.totalCalls,
        totalInputTokens: merged[model].totalInputTokens + usage.totalInputTokens,
        totalOutputTokens: merged[model].totalOutputTokens + usage.totalOutputTokens,
      }
    } else {
      merged[model] = { ...usage }
    }
  }
  return { modelUsageSummaries: merged }
}

// ============================================================
// REPL & Iteration Types
// ============================================================

export interface RLMChatCompletion {
  rootModel: string
  prompt: string | Record<string, unknown>
  response: string
  usageSummary: UsageSummary
  executionTime: number
}

export interface REPLResult {
  stdout: string
  stderr: string
  locals: Record<string, unknown>
  executionTime: number
  rlmCalls: RLMChatCompletion[]
}

export function emptyREPLResult(): REPLResult {
  return {
    stdout: "",
    stderr: "",
    locals: {},
    executionTime: 0,
    rlmCalls: [],
  }
}

export interface CodeBlock {
  code: string
  result: REPLResult
}

export interface RLMIteration {
  prompt: unknown
  response: string
  codeBlocks: CodeBlock[]
  finalAnswer?: string
  iterationTime?: number
}

// ============================================================
// Metadata
// ============================================================

export interface RLMMetadata {
  rootModel: string
  maxDepth: number
  maxIterations: number
  backend: string
  backendKwargs: Record<string, unknown>
  environmentType: string
  environmentKwargs: Record<string, unknown>
  otherBackends?: string[]
}

// ============================================================
// Configuration
// ============================================================

export interface RLMConfig {
  /** Maximum iterations per completion (default 30) */
  maxIterations: number
  /** Maximum recursion depth (default 1) */
  maxDepth: number
  /** Current depth (default 0) */
  depth: number
  /** Custom system prompt override */
  customSystemPrompt?: string
  /** Enable verbose logging */
  verbose: boolean

}

export const DEFAULT_RLM_CONFIG: RLMConfig = {
  maxIterations: 30,
  maxDepth: 1,
  depth: 0,
  verbose: false,
}

// ============================================================
// Query Metadata (for system prompt construction)
// ============================================================

export interface QueryMetadata {
  contextLengths: number[]
  contextTotalLength: number
  contextType: "str" | "dict" | "list"
}

export function buildQueryMetadata(prompt: string | Record<string, unknown> | unknown[]): QueryMetadata {
  if (typeof prompt === "string") {
    return {
      contextLengths: [prompt.length],
      contextTotalLength: prompt.length,
      contextType: "str",
    }
  }
  if (Array.isArray(prompt)) {
    const lengths = prompt.map((item) => {
      if (typeof item === "string") return item.length
      if (typeof item === "object" && item !== null && "content" in item) {
        return String((item as Record<string, unknown>).content ?? "").length
      }
      try {
        return JSON.stringify(item).length
      } catch {
        return String(item).length
      }
    })
    return {
      contextLengths: lengths,
      contextTotalLength: lengths.reduce((a, b) => a + b, 0),
      contextType: "list",
    }
  }
  // dict/object
  const lengths: number[] = []
  for (const value of Object.values(prompt)) {
    if (typeof value === "string") {
      lengths.push(value.length)
    } else {
      try {
        lengths.push(JSON.stringify(value).length)
      } catch {
        lengths.push(String(value).length)
      }
    }
  }
  return {
    contextLengths: lengths,
    contextTotalLength: lengths.reduce((a, b) => a + b, 0),
    contextType: "dict",
  }
}
