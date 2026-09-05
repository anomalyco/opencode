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
  noProgressLimit: 10,
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
  /** false when --no-push was passed (queue mode: push completed branches) */
  push: boolean
  /** false when --no-eternal was passed (prompt mode: continue into backlog work on completion) */
  eternal: boolean
  /** queue mode: standing instruction repeated on every iteration */
  guidance?: string
  /** queue mode gate overrides; unset falls back to experimental.queue_gate */
  gateCwd?: string
  testCommand?: string
  verifyCommand?: string
}

const NUMERIC_FLAGS: Record<string, "interval" | "max" | "noProgressLimit"> = {
  "--interval": "interval",
  "-i": "interval",
  "--max": "max",
  "-n": "max",
  // Both spellings: the TUI has no yargs and never had the negation problem,
  // but the two surfaces must not drift on flag names.
  "--stall-limit": "noProgressLimit",
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
  let push = true
  let eternal = true
  let guidance: string | undefined
  let gateCwd: string | undefined
  let testCommand: string | undefined
  let verifyCommand: string | undefined

  // Flags that take a free-text value. Quoting is not available inside the
  // TUI's single-line `/loop …` string, so a value runs to the next token —
  // wrap multi-word commands in the config instead (experimental.queue_gate).
  const STRING_FLAGS: Record<string, "gateCwd" | "testCommand" | "verifyCommand"> = {
    "--gate-cwd": "gateCwd",
    "--test-command": "testCommand",
    "--verify-command": "verifyCommand",
  }

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
    if (token === "--no-push") {
      push = false
      continue
    }
    if (token === "--no-eternal") {
      eternal = false
      continue
    }
    // Guidance is prose, and the TUI's single-line form has no quoting, so it
    // takes the rest of the line rather than one token. It therefore has to
    // come last — which is also how it reads naturally.
    if (token === "--guidance") {
      const rest = tokens
        .slice(i + 1)
        .join(" ")
        .trim()
      if (rest === "") throw new LoopArgError("--guidance requires text")
      guidance = rest
      i = tokens.length
      continue
    }
    const stringField = STRING_FLAGS[token]
    if (stringField) {
      const raw = tokens[++i]
      if (raw === undefined) throw new LoopArgError(`${token} requires a value`)
      if (stringField === "gateCwd") gateCwd = raw
      if (stringField === "testCommand") testCommand = raw
      if (stringField === "verifyCommand") verifyCommand = raw
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
    push,
    eternal,
    guidance,
    interval,
    max,
    noProgressLimit,
    completionToken,
    queue,
    sync,
    gateCwd,
    testCommand,
    verifyCommand,
  }
}
