/**
 * Auto-routing logic for determining if input should go to shell or agent.
 * Uses `command -v` (POSIX standard) to check if the first token is a valid command.
 */

import { Shell } from "@/shell/shell"
import path from "path"

/**
 * Shell reserved words that are valid shell syntax but never standalone commands.
 * `command -v` reports these as found, but they only make sense inside compound
 * constructs (if/then/fi, for/do/done, etc.) — never as the first token of a
 * standalone invocation. When a user types "do we have X" or "if anyone knows",
 * they mean natural language, not shell.
 */
const SHELL_RESERVED_WORDS = new Set([
  "do",
  "done",
  "then",
  "else",
  "elif",
  "fi",
  "esac",
  "in",
  "select",
  "function",
  "coproc",
  "{",
  "}",
  "!",
  "[[",
])

/**
 * Common English words that always route to agent. These are conversational
 * responses, affirmations, and casual words that users type when talking to
 * an AI assistant. Some of these (yes, nice, cancel) exist as real commands
 * but are almost never used standalone intentionally.
 *
 * Kept in sync with lacyshell lib/core/constants.sh LACY_AGENT_WORDS.
 */
const AGENT_WORDS = new Set([
  // affirmations
  "yes",
  "yeah",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
  "alright",
  "absolutely",
  "definitely",
  "certainly",
  "indeed",
  "correct",
  "right",
  "exactly",
  "perfect",
  "agreed",
  "affirmative",
  "totally",
  "clearly",
  "obviously",
  "lgtm",
  // negations
  "no",
  "nope",
  "nah",
  "never",
  "wrong",
  "disagree",
  // gratitude
  "thanks",
  "thank",
  "thx",
  "ty",
  "cheers",
  "appreciated",
  // reactions
  "great",
  "good",
  "nice",
  "cool",
  "awesome",
  "amazing",
  "wonderful",
  "brilliant",
  "excellent",
  "fantastic",
  "sweet",
  "neat",
  "beautiful",
  "gorgeous",
  "impressive",
  "incredible",
  "outstanding",
  "superb",
  "marvelous",
  "magnificent",
  "stellar",
  "phenomenal",
  "terrific",
  "splendid",
  "fine",
  "solid",
  "dope",
  "sick",
  "fire",
  "lit",
  "rad",
  "legit",
  // greetings/closings
  "hey",
  "hi",
  "hello",
  "howdy",
  "sup",
  "yo",
  "bye",
  "goodbye",
  "cya",
  "later",
  // conversational
  "please",
  "sorry",
  "pardon",
  "hmm",
  "huh",
  "wow",
  "whoa",
  "oops",
  "ugh",
  "yikes",
  "damn",
  "dang",
  "shoot",
  "welp",
  "well",
  "anyway",
  "anyways",
  "regardless",
  "meanwhile",
  "honestly",
  "basically",
  "literally",
  "actually",
  "really",
  "seriously",
  "obviously",
  "hopefully",
  "unfortunately",
  "apparently",
  "supposedly",
  "probably",
  "maybe",
  "perhaps",
  "possibly",
  // action/intent
  "stop",
  "hold",
  "pause",
  "cancel",
  "abort",
  "skip",
  "continue",
  "proceed",
  "next",
  "again",
  "redo",
  "undo",
  "retry",
  "explain",
  "elaborate",
  "clarify",
  "summarize",
  "describe",
  "show",
  "tell",
  "why",
  "how",
  "what",
  "when",
  "where",
  "who",
  "which",
  // question words
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
])

/**
 * Check if input should be routed to shell based on first token being a valid command.
 * Used in Auto mode to intelligently route between shell and agent.
 */
export async function shouldRouteToShell(input: string): Promise<boolean> {
  const trimmed = input.trim()
  if (!trimmed) return false

  const firstToken = extractFirstToken(trimmed)
  if (!firstToken) return false

  const lower = firstToken.toLowerCase()

  // Reserved words pass `command -v` but are never valid standalone commands
  if (SHELL_RESERVED_WORDS.has(lower)) return false

  // Common English words always route to agent
  if (AGENT_WORDS.has(lower)) return false

  return commandExists(firstToken)
}

/**
 * Extract the first token (command name) from input.
 * Handles basic quoting for quoted command names.
 */
function extractFirstToken(input: string): string | null {
  if (!input) return null

  // Handle quoted strings at start
  if (input.startsWith('"')) {
    const end = input.indexOf('"', 1)
    if (end > 0) return input.slice(1, end)
  }
  if (input.startsWith("'")) {
    const end = input.indexOf("'", 1)
    if (end > 0) return input.slice(1, end)
  }

  // Split on whitespace and return first token
  const spaceIndex = input.search(/\s/)
  if (spaceIndex === -1) return input
  return input.slice(0, spaceIndex)
}

/**
 * Check if a command exists using the user's preferred shell.
 * This checks builtins, functions, aliases, and executables.
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const shellPath = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shellPath, ".exe") : path.basename(shellPath)
    ).toLowerCase()

    // Escape single quotes for safe shell interpolation in POSIX shells
    const escaped = `'${cmd.replace(/'/g, "'\\''")}'`

    let args: string[]
    if (shellName === "cmd") {
      args = ["/c", `where ${cmd} >nul 2>nul || help ${cmd} >nul 2>nul`]
    } else if (shellName === "powershell" || shellName === "pwsh") {
      args = ["-NoProfile", "-Command", `if (Get-Command "${cmd}" -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`]
    } else {
      // Use login shell for POSIX shells to catch aliases from .zshrc/.bash_profile
      args = ["-l", "-c", `command -v ${escaped}`]
    }

    const { exited } = Bun.spawn([shellPath, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const exitCode = await exited
    return exitCode === 0
  } catch {
    return false
  }
}
