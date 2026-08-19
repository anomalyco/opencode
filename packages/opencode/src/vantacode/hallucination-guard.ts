/**
 * Tool-bypass hallucination guard (VantaCode spec 3.3).
 *
 * Weaker / smaller local models frequently *narrate* an action ("I've edited the
 * file", "Done, ran the command") without ever emitting the tool call, then
 * invent the result. This module provides pure, dependency-free helpers to:
 *
 *   1. keep a per-turn execution log (tool called -> args -> real result),
 *   2. detect action-claiming language in assistant text, and
 *   3. decide whether a plain-text reply that claims an action but has no matching
 *      tool call in the same turn must be treated as a hallucination and retried.
 *
 * The philosophy is structural, not prompt-only: the caller must NEVER surface a
 * narrated action as fact. Tool output is only ever the tool's real return value.
 */

export interface ExecutionLogEntry {
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly ok: boolean
  readonly resultSummary?: string
  readonly at: number
}

/** Mutable per-turn log of tools actually executed. */
export class ExecutionLog {
  private readonly entries: ExecutionLogEntry[] = []

  record(entry: Omit<ExecutionLogEntry, "at">): void {
    this.entries.push({ ...entry, at: Date.now() })
  }

  get all(): ReadonlyArray<ExecutionLogEntry> {
    return this.entries
  }

  get count(): number {
    return this.entries.length
  }

  reset(): void {
    this.entries.length = 0
  }

  /** True if a tool whose name matches the predicate was actually run this turn. */
  ran(predicate: (tool: string) => boolean): boolean {
    return this.entries.some((entry) => predicate(entry.tool))
  }
}

/**
 * Phrases that assert an action was performed. Kept deliberately specific so we
 * don't flag hypotheticals ("I will edit...", "I could run..."). Each pattern is
 * paired with the tool category it implies so we can check the execution log.
 */
interface ClaimPattern {
  readonly regex: RegExp
  readonly category: "edit" | "shell" | "read" | "any"
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  // File edits / writes
  {
    regex: /\bI(?:'ve| have)\s+(?:edited|updated|modified|created|written|saved|added|removed|deleted)\b/i,
    category: "edit",
  },
  { regex: /\bthe file (?:now )?(?:contains|has been (?:updated|created|edited|modified|saved))\b/i, category: "edit" },
  { regex: /\bI\s+(?:edited|updated|modified|created|wrote|saved)\s+the\s+file\b/i, category: "edit" },
  { regex: /\bchanges?\s+(?:have been|were)\s+(?:applied|saved|written)\b/i, category: "edit" },
  { regex: /\bI(?:'ve| have)\s+(?:made|applied)\s+(?:the|these|those)\s+(?:changes|edits)\b/i, category: "edit" },
  // Shell / command execution
  { regex: /\bI(?:'ve| have)\s+(?:ran|run|executed|installed|built|compiled)\b/i, category: "shell" },
  { regex: /\b(?:ran|executed)\s+the\s+command\b/i, category: "shell" },
  { regex: /\bthe command (?:output|returned|produced|printed)\b/i, category: "shell" },
  { regex: /\bafter running\b.*\bthe (?:output|result) (?:is|was)\b/i, category: "shell" },
  // Reads presented as fact
  { regex: /\bthe (?:file|contents?) (?:reads?|shows?|looks? like)\b/i, category: "read" },
  // Generic completion claims
  { regex: /\b(?:done|completed|finished)[,.!:]\s*(?:I|the)\b/i, category: "any" },
]

export interface HallucinationVerdict {
  readonly hallucinated: boolean
  /** Which claim category triggered the verdict, if any. */
  readonly category?: ClaimPattern["category"]
  /** Human-readable reason for logging / user surfacing. */
  readonly reason?: string
  /** The matched claim snippet, for debugging. */
  readonly matched?: string
}

function categoryMatches(logTool: string, category: ClaimPattern["category"]): boolean {
  const tool = logTool.toLowerCase()
  if (category === "any") return true
  if (category === "edit") return /edit|write|patch|apply|multiedit|create/.test(tool)
  if (category === "shell") return /bash|shell|exec|run|command|terminal/.test(tool)
  if (category === "read") return /read|cat|view|grep|glob|list|ls/.test(tool)
  return false
}

/**
 * Decide whether an assistant reply is a bypass hallucination.
 *
 * @param text        the assistant's natural-language reply for this turn
 * @param log         the per-turn execution log
 * @param madeToolCall whether the model emitted ANY tool call this turn
 */
export function detectHallucination(text: string, log: ExecutionLog, madeToolCall: boolean): HallucinationVerdict {
  if (!text) return { hallucinated: false }
  for (const pattern of CLAIM_PATTERNS) {
    const match = pattern.regex.exec(text)
    if (!match) continue
    // The model claimed an action. Did a matching tool actually run this turn?
    const ranMatching = log.ran((tool) => categoryMatches(tool, pattern.category))
    if (ranMatching) return { hallucinated: false }
    // No matching execution -> hallucinated action (regardless of unrelated tool calls).
    return {
      hallucinated: true,
      category: pattern.category,
      matched: match[0],
      reason:
        `Model claimed it performed a ${pattern.category === "any" ? "task" : pattern.category} action ` +
        `("${match[0].trim()}") but no matching tool call ran this turn.`,
    }
  }
  return { hallucinated: false }
}

/** Stricter system reminder appended on retry after a detected hallucination. */
export const HALLUCINATION_RETRY_INSTRUCTION =
  "CRITICAL: You claimed to have performed an action without actually calling the required tool. " +
  "You are NOT allowed to describe file edits, command output, or file contents from memory or prediction. " +
  "You MUST call the appropriate tool (edit/write/bash/read) and wait for its real result BEFORE stating any outcome. " +
  "If a file edit is needed, call the edit tool now. If a command must run, call the bash tool now. " +
  "Do not narrate an action you did not actually take."

/** Stricter reminder when a model replied with prose but a tool call was expected. */
export const TOOL_REQUIRED_RETRY_INSTRUCTION =
  "This task requires using a tool. Respond by calling the appropriate tool with valid arguments, " +
  "not with a natural-language description. Do not simulate or predict the tool's output."

/**
 * Count how many turns in a row triggered a hallucination. Used to warn the user
 * that the selected model is unreliable for tool use.
 */
export class HallucinationStreak {
  private streak = 0
  private total = 0

  readonly unreliableModelWarning =
    "This model repeatedly claims to perform actions without calling tools. " +
    "It is unreliable for agentic tool use — try a larger or tool-tuned model " +
    "(e.g. qwen2.5-coder, qwen3-coder, llama3.1:8b+, mistral-nemo, hermes3)."

  record(hallucinated: boolean): void {
    this.total += hallucinated ? 1 : 0
    this.streak = hallucinated ? this.streak + 1 : 0
  }

  get current(): number {
    return this.streak
  }

  get totalCount(): number {
    return this.total
  }

  /** True once the model has hallucinated enough that we should warn the user. */
  shouldWarn(threshold = 3): boolean {
    return this.streak >= threshold
  }
}
