// Shared between the CLI (`opencode loop`) and the TUI (`/loop`) so the two
// surfaces cannot drift on flag names or defaults. The CLI declares the same
// flags via yargs (which parses `opencode loop "<prompt>" --max 5` for us),
// but reads its defaults from LoopArgDefaults below; the TUI has no
// arg-parsing library for a single `/loop <rest of line>` string, so it
// calls parseLoopArgs directly.
export const LoopArgDefaults = {
  maxIterations: 10,
  noProgressLimit: 3,
} as const

export interface ParsedLoopArgs {
  prompt: string
  interval?: number
  max: number
  noProgressLimit: number
}

const FLAGS: Record<string, keyof Omit<ParsedLoopArgs, "prompt">> = {
  "--interval": "interval",
  "-i": "interval",
  "--max": "max",
  "-n": "max",
  "--no-progress-limit": "noProgressLimit",
}

export class LoopArgError extends Error {}

/**
 * Parses `<prompt text> [--interval <sec>] [--max <n>] [--no-progress-limit <n>]`.
 * Flags may appear anywhere in the string; everything else is joined back
 * together (in order) to form the prompt.
 */
export function parseLoopArgs(input: string): ParsedLoopArgs {
  const tokens = input.trim().length > 0 ? input.trim().split(/\s+/) : []
  const promptParts: string[] = []
  let interval: number | undefined
  let max: number = LoopArgDefaults.maxIterations
  let noProgressLimit: number = LoopArgDefaults.noProgressLimit

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const field = FLAGS[token]
    if (!field) {
      promptParts.push(token)
      continue
    }
    const raw = tokens[++i]
    const value = raw !== undefined ? Number(raw) : NaN
    if (raw === undefined || Number.isNaN(value)) {
      throw new LoopArgError(`${token} requires a numeric value`)
    }
    if (field === "interval") interval = value
    if (field === "max") max = value
    if (field === "noProgressLimit") noProgressLimit = value
  }

  return {
    prompt: promptParts.join(" ").trim(),
    interval,
    max,
    noProgressLimit,
  }
}
