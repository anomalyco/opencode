/**
 * RLM Parsing - TypeScript port of rlm/utils/parsing.py
 *
 * Utilities for extracting code blocks and detecting final answers
 * from LLM responses in the RLM loop.
 */

import type { REPLResult, RLMIteration } from "./types"

/**
 * Find REPL code blocks in text wrapped in triple backticks.
 * Matches ```repl\n...\n``` blocks.
 */
export function findCodeBlocks(text: string): string[] {
  const pattern = /```repl\s*\n([\s\S]*?)\n```/g
  const results: string[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    results.push(match[1].trim())
  }

  return results
}

/**
 * Find FINAL(...) or FINAL_VAR(...) statement in response.
 *
 * @param text - The response text to parse
 * @param executeCode - Optional function to execute code for FINAL_VAR retrieval
 * @returns The final answer string, or undefined if no pattern found
 */
export function findFinalAnswer(
  text: string,
  executeCode?: (code: string) => REPLResult | Promise<REPLResult>,
): string | undefined {
  // Check for FINAL_VAR pattern first - must be at start of line
  const finalVarPattern = /^\s*FINAL_VAR\((.*?)\)/m
  const varMatch = finalVarPattern.exec(text)
  if (varMatch) {
    const variableName = varMatch[1].trim().replace(/^["']|["']$/g, "")
    if (executeCode) {
      const result = executeCode(`console.log(FINAL_VAR("${variableName}"))`)
      if (result instanceof Promise) {
        // For sync contexts, we can't await — caller must handle
        return undefined
      }
      const answer = result.stdout.trim()
      return answer || result.stderr.trim() || ""
    }
    return undefined
  }

  // Check for FINAL pattern - must be at start of line
  // Use greedy matching to capture content with nested parentheses
  const finalPattern = /^\s*FINAL\(([\s\S]*)\)\s*$/m
  const finalMatch = finalPattern.exec(text)
  if (finalMatch) {
    return finalMatch[1].trim()
  }

  return undefined
}

/**
 * Async version of findFinalAnswer for environments with async executeCode.
 */
export async function findFinalAnswerAsync(
  text: string,
  executeCode?: (code: string) => Promise<REPLResult>,
): Promise<string | undefined> {
  // Check for FINAL_VAR pattern first
  const finalVarPattern = /^\s*FINAL_VAR\((.*?)\)/m
  const varMatch = finalVarPattern.exec(text)
  if (varMatch) {
    const variableName = varMatch[1].trim().replace(/^["']|["']$/g, "")
    if (executeCode) {
      const result = await executeCode(`console.log(FINAL_VAR("${variableName}"))`)
      const answer = result.stdout.trim()
      return answer || result.stderr.trim() || ""
    }
    return undefined
  }

  // Check for FINAL pattern
  const finalPattern = /^\s*FINAL\(([\s\S]*)\)\s*$/m
  const finalMatch = finalPattern.exec(text)
  if (finalMatch) {
    return finalMatch[1].trim()
  }

  return undefined
}

// ============================================================
// Iteration Formatting
// ============================================================

/**
 * Format an RLM iteration (including all code blocks) for the message history.
 * Truncates large execution results.
 */
export function formatIteration(
  iteration: RLMIteration,
  maxCharLength = 20000,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [{ role: "assistant", content: iteration.response }]

  for (const block of iteration.codeBlocks) {
    let result = formatExecutionResult(block.result)
    if (result.length > maxCharLength) {
      result = result.slice(0, maxCharLength) + `... + [${result.length - maxCharLength} chars...]`
    }

    messages.push({
      role: "user",
      content: `Code executed:\n\`\`\`javascript\n${block.code}\n\`\`\`\n\nREPL output:\n${result}`,
    })
  }

  return messages
}

/**
 * Format a REPLResult as a human-readable string.
 */
export function formatExecutionResult(result: REPLResult): string {
  const parts: string[] = []

  if (result.stdout) {
    parts.push(`\n${result.stdout}`)
  }

  if (result.stderr) {
    parts.push(`\n${result.stderr}`)
  }

  // Show key variables (excluding internal ones)
  const importantVars: string[] = []
  for (const [key, value] of Object.entries(result.locals)) {
    if (!key.startsWith("_") && !["__builtins__", "__name__", "__doc__"].includes(key)) {
      if (["string", "number", "boolean"].includes(typeof value) || Array.isArray(value) || (value && typeof value === "object")) {
        importantVars.push(key)
      }
    }
  }

  if (importantVars.length > 0) {
    parts.push(`REPL variables: [${importantVars.map((v) => `"${v}"`).join(", ")}]\n`)
  }

  return parts.length > 0 ? parts.join("\n\n") : "No output"
}
