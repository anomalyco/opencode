const HEDGES = [
  "maybe",
  "perhaps",
  "possibly",
  "might",
  "i think",
  "i'm not sure",
  "i am not sure",
  "not sure",
  "unsure",
  "i believe",
  "i suspect",
  "probably",
  "likely",
  "could be",
  "may be",
  "tends to",
  "seems to",
  "appears to",
  "assuming that",
  "let's assume",
  "lets assume",
  "suppose that",
  "hypothetically",
]

const stripNonProse = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^>.*$/gm, " ")

const HEDGE_PATTERNS = HEDGES.map((phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
  return new RegExp(`\\b${escaped}\\b`, "i")
})

export const containsHedge = (text: string): boolean => {
  const prose = stripNonProse(text)
  return HEDGE_PATTERNS.some((pattern) => pattern.test(prose))
}

export const extractHedges = (text: string): readonly string[] => {
  const prose = stripNonProse(text)
  const matched: string[] = []
  for (let i = 0; i < HEDGE_PATTERNS.length; i++) {
    if (HEDGE_PATTERNS[i]!.test(prose)) {
      matched.push(HEDGES[i]!)
    }
  }
  return matched
}

export const hedgeScore = (text: string): number => {
  const hedges = extractHedges(text)
  if (hedges.length === 0) return 0
  const words = stripNonProse(text).trim().split(/\s+/).filter(Boolean).length
  if (words === 0) return 0
  const density = hedges.length / Math.max(words / 10, 1)
  return Math.min(1, Math.round(density * 100) / 100)
}

export const MUTATIVE_TOOLS = new Set([
  "write",
  "edit",
  "apply_patch",
  "todowrite",
])

export const isMutativeTool = (toolName: string): boolean => MUTATIVE_TOOLS.has(toolName)

const DESTRUCTIVE_CMD_PATTERNS = [
  /\brm\s+(-[rfRF]+\s+|--recursive\b)/,
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\b/,
  /\bgit\s+(reset\s+--hard|clean\s+-[fdxFDX]+|checkout\s+--|restore\s+)/,
  /\b(dd\s+if=|mkfs|fdisk|parted)\b/,
  /\b(kill\s+-9|pkill\s+-9)\b/,
  /\b(drop\s+table|drop\s+database|truncate\s+table)\b/i,
]

export const isDestructiveCommand = (command: string): boolean => {
  const normalized = command.trim()
  return DESTRUCTIVE_CMD_PATTERNS.some((pattern) => pattern.test(normalized))
}

export const shouldRedTeam = (
  toolName: string,
  toolArgs: unknown,
  contextText: string,
): boolean => {
  if (isMutativeTool(toolName)) return true

  if (toolName === "bash") {
    const cmd =
      typeof toolArgs === "object" && toolArgs !== null && "command" in toolArgs
        ? String((toolArgs as { command: unknown }).command)
        : ""
    if (isDestructiveCommand(cmd)) return true
    if (containsHedge(contextText)) return true
    return false
  }

  if (containsHedge(contextText)) {
    const readOnlyTools = new Set(["read", "grep", "glob", "read-filesystem", "websearch", "webfetch"])
    if (!readOnlyTools.has(toolName)) return true
  }

  return false
}

export interface HeuristicVerdict {
  readonly survives: boolean
  readonly critique?: string
}

export const heuristicAttack = (
  toolName: string,
  toolArgs: unknown,
  contextText: string,
): HeuristicVerdict => {
  if (toolName === "bash") {
    const cmd =
      typeof toolArgs === "object" && toolArgs !== null && "command" in toolArgs
        ? String((toolArgs as { command: unknown }).command).trim()
        : ""
    if (/\brm\s+(-rf|-r|-f)\s+(\/|\*|~\/?)\s*$/i.test(cmd)) {
      return {
        survives: false,
        critique: `Dangerous wildcard or root deletion detected in bash command: "${cmd}". Operation blocked.`,
      }
    }
    if (/\bgit\s+reset\s+--hard\b/i.test(cmd) && containsHedge(contextText)) {
      return {
        survives: false,
        critique: `Hard git reset proposed under epistemic uncertainty ("${extractHedges(contextText).join(", ")}"). High risk of unrecoverable data loss.`,
      }
    }
  }

  if (toolName === "write" || toolName === "edit") {
    const pathVal =
      typeof toolArgs === "object" && toolArgs !== null && "path" in toolArgs
        ? String((toolArgs as { path: unknown }).path).trim()
        : ""
    if (pathVal === "/" || pathVal === "." || pathVal === "") {
      return {
        survives: false,
        critique: `Invalid target path "${pathVal}" for ${toolName}. Operation blocked.`,
      }
    }
  }

  return { survives: true }
}

