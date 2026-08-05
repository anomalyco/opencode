// Shared between the CLI (`opencode loop`) and the TUI (`/loop`) so the two
// surfaces cannot drift on flag names or defaults. The CLI declares the same
// flags via yargs (which parses `opencode loop "<prompt>" --max 5` for us),
// but reads its defaults from LoopArgDefaults below; the TUI has no
// arg-parsing library for a single `/loop <rest of line>` string, so it
// calls parseLoopArgs directly.
// Mirrors the server-side defaults in packages/opencode/src/loop/loop.ts —
// these two must be kept in step by hand (the server cannot import the SDK).
export const LoopArgDefaults = {
  maxIterations: 50,
  noProgressLimit: 3,
  intervalSeconds: 2,
  completionToken: "<promise>COMPLETE</promise>",
} as const

export interface ParsedLoopArgs {
  prompt: string
  interval?: number
  max: number
  noProgressLimit: number
  completionToken?: string
  /** true when --queue was passed; the prompt tokens are then change slugs */
  queue: boolean
  /** true when --sync was passed (queue mode: specsync completed changes) */
  sync: boolean
}

const NUMERIC_FLAGS: Record<string, "interval" | "max" | "noProgressLimit"> = {
  "--interval": "interval",
  "-i": "interval",
  "--max": "max",
  "-n": "max",
  "--no-progress-limit": "noProgressLimit",
}

export class LoopArgError extends Error {}

/**
 * Parses `<prompt text> [--interval <sec>] [--max <n>] [--no-progress-limit <n>]
 * [--completion-token <word>]`. Flags may appear anywhere in the string;
 * everything else is joined back together (in order) to form the prompt.
 */
export function parseLoopArgs(input: string): ParsedLoopArgs {
  const tokens = input.trim().length > 0 ? input.trim().split(/\s+/) : []
  const promptParts: string[] = []
  let interval: number | undefined
  let max: number = LoopArgDefaults.maxIterations
  let noProgressLimit: number = LoopArgDefaults.noProgressLimit
  let completionToken: string | undefined
  let queue = false
  let sync = false

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === "--queue") {
      queue = true
      continue
    }
    if (token === "--sync") {
      sync = true
      continue
    }
    if (token === "--completion-token") {
      const raw = tokens[++i]
      if (raw === undefined) throw new LoopArgError(`${token} requires a value`)
      completionToken = raw
      continue
    }
    const field = NUMERIC_FLAGS[token]
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
    completionToken,
    queue,
    sync,
  }
}
