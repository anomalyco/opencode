/**
 * Auto-routing logic for determining if input should go to shell or agent.
 * Uses `command -v` (POSIX standard) to check if the first token is a valid command.
 */

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
 * Check if input should be routed to shell based on first token being a valid command.
 * Used in Auto mode to intelligently route between shell and agent.
 */
export async function shouldRouteToShell(input: string): Promise<boolean> {
  const trimmed = input.trim()
  if (!trimmed) return false

  const firstToken = extractFirstToken(trimmed)
  if (!firstToken) return false

  // Reserved words pass `command -v` but are never valid standalone commands
  if (SHELL_RESERVED_WORDS.has(firstToken)) return false

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
 * Check if a command exists using `command -v` (POSIX standard).
 * This checks builtins, functions, aliases, and executables in PATH.
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    // Escape single quotes for safe shell interpolation
    const escaped = `'${cmd.replace(/'/g, "'\\''")}'`
    const { exited } = Bun.spawn(["sh", "-c", `command -v ${escaped}`], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const exitCode = await exited
    return exitCode === 0
  } catch {
    return false
  }
}
