/**
 * Ralph Wiggum Plugin for OpenCode
 * Implements the Ralph Wiggum technique for iterative, self-referential AI development loops.
 *
 * Based on: https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
 *
 * Usage:
 *   ralph-loop "Your task here" --max 10 --promise "DONE"
 *   ralph-loop "Your task here" --max 10 --promise "DONE" --state-file /custom/path.json
 *   ralph-loop "Your task here" --no-state  # Disable state file
 *
 * The loop will:
 * 1. Execute the prompt
 * 2. Continue iterating until max iterations OR completion promise is found
 * 3. Feed the SAME original prompt back each iteration
 * 4. Show iteration count in system message
 * 5. Write state to ~/.config/opencode/state/ralph-wiggum.json (or custom path) for verification
 */

import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"

// Default state file path
const DEFAULT_STATE_DIR = join(homedir(), ".config", "opencode", "state")
const DEFAULT_STATE_FILE = join(DEFAULT_STATE_DIR, "ralph-wiggum.json")

type RalphState = {
  active: boolean
  prompt: string
  promise?: string
  max?: number
  iterations: number
  stateFile: string | null
  startedAt: string
  lastUpdatedAt: string
  status: "running" | "completed" | "cancelled" | "max_reached"
}

const state: Record<string, RalphState> = {}

/**
 * Ensure directory exists for state file
 */
function ensureDir(filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
  } catch {
    // Ignore errors
  }
}

/**
 * Clean up existing state file on start
 */
function cleanupExistingStateFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Write state to file for external verification
 */
function writeStateFile(sessionID: string, s: RalphState): void {
  if (!s.stateFile) return
  try {
    ensureDir(s.stateFile)
    const stateData = {
      sessionID,
      active: s.active,
      prompt: s.prompt,
      promise: s.promise || null,
      iterations: s.iterations,
      max: s.max ?? null,
      remaining: s.max != null ? s.max - s.iterations : null,
      startedAt: s.startedAt,
      lastUpdatedAt: new Date().toISOString(),
      status: s.status,
    }
    writeFileSync(s.stateFile, JSON.stringify(stateData, null, 2))
  } catch {
    // Silently ignore write errors
  }
}

/**
 * Write final state when loop ends
 */
function writeFinalState(sessionID: string, s: RalphState): void {
  if (!s.stateFile) return
  s.lastUpdatedAt = new Date().toISOString()
  writeStateFile(sessionID, s)
}

/**
 * Tokenize a string respecting quoted strings.
 * Handles both single and double quotes, preserving content within quotes as single tokens.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inQuote) {
      if (char === inQuote) {
        // End of quoted section
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      // Start of quoted section
      inQuote = char
    } else if (char === " " || char === "\t") {
      // Whitespace outside quotes - token boundary
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }

  // Don't forget the last token
  if (current) {
    tokens.push(current)
  }

  return tokens
}

// Parse arguments from command invocation
// Supports: ralph-loop "prompt text with spaces" --max 5 --promise "DONE" --state-file /tmp/ralph.json --no-state
function parseArgs(args: string): {
  prompt: string
  maxIterations: number
  completionPromise?: string
  stateFile: string | null
} {
  const tokens = tokenize(args.trim())
  const promptParts: string[] = []
  let maxIterations = 10
  let completionPromise: string | undefined
  let stateFile: string | null = DEFAULT_STATE_FILE
  let noState = false

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === "--max" || token === "--max-iterations") {
      maxIterations = parseInt(tokens[++i] || "10", 10)
    } else if (token === "--promise" || token === "--completion-promise") {
      completionPromise = tokens[++i]
    } else if (token === "--state-file" || token === "--state") {
      stateFile = tokens[++i] || DEFAULT_STATE_FILE
    } else if (token === "--no-state") {
      noState = true
    } else {
      // Accumulate as prompt
      promptParts.push(token)
    }
    i++
  }

  return {
    prompt: promptParts.join(" ") || "Continue working on the task",
    maxIterations,
    completionPromise,
    stateFile: noState ? null : stateFile,
  }
}

/**
 * Check if the assistant's response contains the completion promise.
 * Looks for <promise>TEXT</promise> pattern where TEXT matches the expected promise.
 */
function checkCompletionPromise(text: string | undefined, expectedPromise: string | undefined): boolean {
  if (!text || !expectedPromise) return false

  // Look for <promise>TEXT</promise> pattern
  const promiseRegex = /<promise>([\s\S]*?)<\/promise>/gi
  const matches = text.matchAll(promiseRegex)

  for (const match of matches) {
    const promiseText = match[1].trim()
    if (promiseText === expectedPromise) {
      return true
    }
  }

  return false
}

export default async function ralphWiggum(input: {
  client: any
  project: string
  worktree: string
  directory: string
  serverUrl: string
  $: any
}) {
  return {
    command: {
      "ralph-loop": {
        description:
          "Start a self-referential Ralph loop. Usage: ralph-loop <prompt> --max <iterations> --promise <text> --state-file <path>",
        template: `You are now in a Ralph Wiggum iterative development loop.

The user wants you to work on the following task iteratively:
$ARGUMENTS

Instructions:
1. Work on the task step by step
2. After each iteration, the loop will automatically continue
3. The loop will stop when max iterations is reached OR you output <promise>TEXT</promise> where TEXT matches the completion promise
4. Focus on making progress with each iteration
5. When you believe the task is complete, output <promise>COMPLETION_PROMISE_TEXT</promise>

Begin working on the task now.`,
      },
      "cancel-ralph": {
        description: "Cancel the active Ralph loop",
        template: "The Ralph loop has been cancelled. Stop the current iteration.",
      },
      "ralph-status": {
        description: "Show the current Ralph loop status",
        template: "Show the current Ralph loop status for this session.",
      },
    },

    tool: {
      "cancel-ralph": {
        description: "Cancel the active Ralph loop for the current session",
        args: {},
        async execute(_args: {}, ctx: any) {
          const sessionID = ctx.sessionID
          const s = state[sessionID]
          if (s) {
            s.status = "cancelled"
            s.active = false
            writeFinalState(sessionID, s)
            delete state[sessionID]
            return "Ralph loop cancelled"
          }
          return "No active Ralph loop to cancel"
        },
      },
      "ralph-status": {
        description: "Get the current Ralph loop status for the session",
        args: {},
        async execute(_args: {}, ctx: any) {
          const sessionID = ctx.sessionID
          const s = state[sessionID]
          if (!s?.active) {
            return "No active Ralph loop"
          }
          const remaining = s.max != null ? s.max - s.iterations : "unlimited"
          return JSON.stringify(
            {
              active: s.active,
              prompt: s.prompt,
              promise: s.promise || "none",
              iterations: s.iterations,
              max: s.max ?? "unlimited",
              remaining,
              stateFile: s.stateFile || "none",
              startedAt: s.startedAt,
              status: s.status,
            },
            null,
            2,
          )
        },
      },
    },

    // Hook: Listen for command execution to set up the loop state
    async ["event"](input: { event: any }): Promise<void> {
      const event = input.event
      if (event?.type === "command.executed" && event?.properties?.name === "ralph-loop") {
        const sessionID = event.properties.sessionID
        const args = parseArgs(event.properties.arguments || "")
        const now = new Date().toISOString()

        // Clean up existing state file on start
        if (args.stateFile) {
          cleanupExistingStateFile(args.stateFile)
        }

        state[sessionID] = {
          active: true,
          prompt: args.prompt,
          promise: args.completionPromise,
          max: args.maxIterations,
          iterations: 0,
          stateFile: args.stateFile,
          startedAt: now,
          lastUpdatedAt: now,
          status: "running",
        }
        // Write initial state
        writeStateFile(sessionID, state[sessionID])
      }
    },

    // Hook: session.stop - called just before the session loop exits (SYNCHRONOUS)
    // Modifies output.stop to control whether the loop should continue
    ["session.stop"](
      hookInput: { sessionID: string; step: number; lastAssistantText?: string },
      output: { stop: boolean; prompt?: string; systemMessage?: string },
    ): void {
      const s = state[hookInput.sessionID]
      if (!s?.active) {
        return // No active loop, let it stop
      }

      s.iterations++
      s.lastUpdatedAt = new Date().toISOString()

      // Check for completion promise in assistant's response
      if (checkCompletionPromise(hookInput.lastAssistantText, s.promise)) {
        s.status = "completed"
        s.active = false
        writeFinalState(hookInput.sessionID, s)
        delete state[hookInput.sessionID]
        output.stop = true
        return
      }

      // Check max iterations
      if (s.max != null && s.iterations >= s.max) {
        s.status = "max_reached"
        s.active = false
        writeFinalState(hookInput.sessionID, s)
        delete state[hookInput.sessionID]
        output.stop = true
        return
      }

      // Continue the loop - feed back the SAME original prompt
      output.stop = false
      output.prompt = s.prompt

      // Write state update
      writeStateFile(hookInput.sessionID, s)

      // Add system message with iteration info
      const promiseHint = s.promise ? ` | To complete: output <promise>${s.promise}</promise>` : ""
      output.systemMessage = `[Ralph iteration ${s.iterations + 1}/${s.max ?? "∞"}${promiseHint}]`
    },
  }
}
