/**
 * Auto-routing logic for determining if input should go to shell or agent.
 * Uses fast synchronous checks (builtins + which) to avoid spawning a shell
 * on every keystroke. Aliases are loaded once in the background at startup.
 */

import { Shell } from "@/shell/shell"
import { which } from "@/util/which"
import { spawn as nodeSpawn } from "node:child_process"
import path from "path"

/**
 * Shell builtins that are always valid commands regardless of PATH.
 * Covers bash and zsh builtins.
 */
const SHELL_BUILTINS = new Set([
  // POSIX / bash builtins
  "alias", "bg", "bind", "break", "builtin", "caller", "cd", "command",
  "compgen", "complete", "compopt", "continue", "declare", "dirs", "disown",
  "echo", "enable", "eval", "exec", "exit", "export", "false", "fc", "fg",
  "getopts", "hash", "help", "history", "jobs", "kill", "let", "local",
  "logout", "mapfile", "popd", "printf", "pushd", "pwd", "read", "readarray",
  "readonly", "return", "set", "shift", "shopt", "source", "suspend",
  "test", "times", "trap", "true", "type", "typeset", "ulimit", "umask",
  "unalias", "unset", "wait",
  // zsh-specific builtins
  "autoload", "bindkey", "cap", "clone", "compctl", "disable", "echotc",
  "echoti", "emulate", "functions", "getcap", "getln", "integer", "limit",
  "log", "noglob", "print", "pushln", "r", "sched", "setcap", "setopt",
  "stat", "ttyctl", "unfunction", "unhash", "unlimit", "unsetopt", "vared",
  "whence", "where", "zcompile", "zformat", "zle", "zmodload", "zparseopts",
  "zprof", "zpty", "zregexparse", "zsocket", "zstyle", "ztcp",
])

/**
 * User aliases loaded from the interactive shell, cached as a resolved Set.
 * Starts loading eagerly at module load so it's ready before first use.
 * Non-blocking: commandExists() checks this synchronously if already settled.
 */
let _aliases: Set<string> | null = null

;(async () => {
  try {
    const shellPath = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shellPath, ".exe") : path.basename(shellPath)
    ).toLowerCase()

    if (shellName === "cmd" || shellName === "powershell" || shellName === "pwsh") {
      _aliases = new Set()
      return
    }

    // Use -i so .zshrc/.bashrc is sourced (many rc files guard with [[ -o interactive ]]).
    // Run detached (setsid) so the child has no controlling terminal — this prevents
    // interactive zsh from calling tcsetattr and corrupting the TUI's raw terminal mode.
    //
    // Emit aliases then a sentinel then function names so both can be parsed
    // from a single shell invocation.
    let dumpCmd: string
    if (shellName === "zsh") {
      dumpCmd = "alias 2>/dev/null; echo __FNAMES__; print -l ${(k)functions} 2>/dev/null || true"
    } else if (shellName === "bash") {
      dumpCmd = "shopt -s expand_aliases 2>/dev/null || true; alias 2>/dev/null; echo __FNAMES__; declare -F 2>/dev/null | awk '{print $3}'"
    } else {
      dumpCmd = "alias 2>/dev/null; echo __FNAMES__"
    }

    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const proc = nodeSpawn(shellPath, ["-l", "-i", "-c", dumpCmd], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, TERM: "dumb" },
      })
      proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk))
      proc.on("close", () => resolve())
      proc.on("error", reject)
    })
    const output = Buffer.concat(chunks).toString()

    const known = new Set<string>()
    let inFunctions = false
    for (const line of output.split("\n")) {
      if (line === "__FNAMES__") {
        inFunctions = true
        continue
      }
      if (inFunctions) {
        const name = line.trim()
        if (name) known.add(name)
      } else {
        // bash: `alias ..='cd ..'`   zsh: `..='cd ..'`
        const match = line.match(/^(?:alias\s+)?([^=\s]+)=/)
        if (match) known.add(match[1])
      }
    }
    _aliases = known
  } catch {
    _aliases = new Set()
  }
})()

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

  return Promise.resolve(commandExists(firstToken))
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
 * Check if a command exists without spawning a shell.
 * Checks (in order): alias cache, builtins, PATH executables.
 */
function commandExists(cmd: string): boolean {
  // Alias cache: populated eagerly at startup, available after first load
  if (_aliases !== null && _aliases.has(cmd)) return true

  // Shell builtins (cd, echo, export, etc.)
  if (SHELL_BUILTINS.has(cmd)) return true

  // PATH executables (synchronous, no shell spawn)
  if (which(cmd) !== null) return true

  return false
}
