/**
 * Kimi K2.6 Context Optimizer
 *
 * Maximizes utilization of Kimi's 256K context window for coding tasks.
 * Smart allocation strategy:
 * - 40% codebase context (102K tokens)
 * - 30% conversation history (76K tokens)
 * - 20% tool results (51K tokens)
 * - 10% output generation (25K tokens)
 */

import { Effect, Schema } from "effect"

export const KIMI_MAX_CONTEXT = 256_000
export const KIMI_OUTPUT_RESERVE = 25_000
export const KIMI_USABLE_CONTEXT = KIMI_MAX_CONTEXT - KIMI_OUTPUT_RESERVE

export const ContextAllocation = Schema.Struct({
  codebase: Schema.Number,
  history: Schema.Number,
  tools: Schema.Number,
})

export type ContextAllocation = typeof ContextAllocation.Type

export const DEFAULT_ALLOCATION: ContextAllocation = {
  codebase: 0.40,
  history: 0.30,
  tools: 0.20,
}

/**
 * Calculate token allocation for Kimi models.
 */
export const allocate = (
  totalTokens: number = KIMI_USABLE_CONTEXT,
  allocation: ContextAllocation = DEFAULT_ALLOCATION,
): {
  codebaseTokens: number
  historyTokens: number
  toolTokens: number
  availableTokens: number
} => ({
  codebaseTokens: Math.floor(totalTokens * allocation.codebase),
  historyTokens: Math.floor(totalTokens * allocation.history),
  toolTokens: Math.floor(totalTokens * allocation.tools),
  availableTokens: totalTokens,
})

/**
 * Optimize file selection for codebase context.
 * Prioritizes:
 * 1. Recently modified files
 * 2. Files in current working directory
 * 3. Files referenced in conversation
 * 4. Important config files (package.json, tsconfig, etc.)
 */
export const selectRelevantFiles = (
  files: Array<{ path: string; content: string; lastModified?: Date }>,
  maxTokens: number,
  workingDirectory: string,
): Array<{ path: string; content: string }> => {
  // Sort by relevance score
  const scored = files.map((file) => ({
    ...file,
    score: calculateRelevanceScore(file, workingDirectory),
  }))

  scored.sort((a, b) => b.score - a.score)

  const selected: Array<{ path: string; content: string }> = []
  let usedTokens = 0

  for (const file of scored) {
    const tokens = estimateTokens(file.content)
    if (usedTokens + tokens <= maxTokens) {
      selected.push({ path: file.path, content: file.content })
      usedTokens += tokens
    }
  }

  return selected
}

/**
 * Calculate relevance score for a file.
 */
const calculateRelevanceScore = (
  file: { path: string; content: string; lastModified?: Date },
  workingDirectory: string,
): number => {
  let score = 0

  // Important config files
  const configPatterns = [
    /package\.json$/,
    /tsconfig\.json$/,
    /\.config\./,
    /README/,
    /AGENTS\.md$/,
  ]
  if (configPatterns.some((pattern) => pattern.test(file.path))) {
    score += 50
  }

  // Files in working directory
  if (file.path.startsWith(workingDirectory)) {
    score += 30
  }

  // Recently modified (within last hour)
  if (file.lastModified) {
    const age = Date.now() - file.lastModified.getTime()
    if (age < 3600000) score += 20
    else if (age < 86400000) score += 10
  }

  // Source code files
  if (/\.(ts|tsx|js|jsx|py|rs|go)$/.test(file.path)) {
    score += 15
  }

  return score
}

/**
 * Estimate token count for text.
 * Rough approximation: 1 token ≈ 4 characters for English,
 * 1 token ≈ 2 characters for Chinese.
 */
export const estimateTokens = (text: string): number => {
  let tokens = 0
  for (const char of text) {
    // CJK characters (Chinese, Japanese, Korean)
    if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(char)) {
      tokens += 0.5
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

/**
 * Create optimized system prompt for Kimi K2.6.
 */
export const createSystemPrompt = (options: {
  projectName?: string
  language?: string
  framework?: string
  contextSize?: "small" | "medium" | "large"
} = {}): string => {
  const { projectName, language, framework, contextSize = "large" } = options

  const basePrompt = `You are Kimi K2.6, an advanced AI coding assistant with a ${KIMI_MAX_CONTEXT.toLocaleString()} token context window.
You have deep understanding of code, can reason through complex problems, and maintain context across long conversations.

Key capabilities:
- Analyze and modify large codebases with full context
- Provide detailed reasoning for complex architectural decisions
- Understand and work with multiple programming languages
- Process images and visual content (when using vision model)
- Execute tools and commands to help with development tasks`

  const contextPrompt = contextSize === "large"
    ? "\nYou have access to extensive codebase context. Use it to provide detailed, accurate responses."
    : ""

  const projectPrompt = projectName
    ? `\nCurrent project: ${projectName}`
    : ""

  const techPrompt = language || framework
    ? `\nTech stack: ${[language, framework].filter(Boolean).join(", ")}`
    : ""

  return `${basePrompt}${contextPrompt}${projectPrompt}${techPrompt}

Guidelines:
1. Always explain your reasoning before making changes
2. Consider the full context of the project when suggesting modifications
3. Ask clarifying questions when requirements are ambiguous
4. Provide multiple solution options when appropriate
5. Highlight potential risks or edge cases in your suggestions`
}
