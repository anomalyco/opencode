export * as ClaudeIO from "./io.js"

import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { spawn } from "child_process"
import path from "path"
import { which } from "../../../../util/which.js"
import { ClaudeFork } from "./fork.js"
import { ClaudeSDK } from "./sdk.js"

// Everything that reaches outside opencode. Tests swap it for a fake `claude`.
export interface Interface {
  // Undefined uses the SDK's own spawn
  readonly spawn?: Options["spawnClaudeCodeProcess"]
  readonly which: () => string | undefined
  // Before our isolation settings
  readonly env: () => Record<string, string | undefined>
  readonly sessionExists: (sessionID: string) => Promise<boolean>
  readonly fork: (sessionID: string, messageID: string) => Promise<ClaudeFork.Result | undefined>
  readonly remove: (sessionID: string) => Promise<void>
}

export const real: Interface = {
  which: () => process.env.OPENCODE_CLAUDE_PATH || which("claude") || undefined,
  spawn: process.platform === "win32" ? spawnWindows : undefined,
  env: () => process.env,
  sessionExists: async (sessionID) => {
    const { getSessionInfo } = await ClaudeSDK.load()
    return (await getSessionInfo(sessionID)) !== undefined
  },
  fork: ClaudeFork.create,
  remove: async (sessionID) => {
    const { deleteSession } = await ClaudeSDK.load()
    await deleteSession(sessionID)
  },
}

// Windows cannot start a batch file without a shell, and npm installs `claude` only as one. Run it through the command
// interpreter so an npm install keeps working, including the copy Claude Code updates itself.
function spawnWindows(options: Parameters<NonNullable<Options["spawnClaudeCodeProcess"]>>[0]) {
  const stdio = {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }
  if (!isBatchFile(options.command)) return spawn(options.command, options.args, stdio)
  return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", batchCommand(options.command, options.args)], {
    ...stdio,
    // Every argument is quoted below, so cmd.exe must not quote the command line again.
    windowsVerbatimArguments: true,
  })
}

// cmd.exe drops the first and last quote of a quoted `/c` command line, so the whole line is wrapped once more. Each
// argument is quoted the way CommandLineToArgvW reads it back, which also keeps cmd.exe metacharacters literal.
export function batchCommand(command: string, args: readonly string[]) {
  return `"${[command, ...args].map(quoteArgument).join(" ")}"`
}

function isBatchFile(file: string) {
  const extension = path.win32.extname(file).toLowerCase()
  return extension === ".cmd" || extension === ".bat"
}

function quoteArgument(argument: string) {
  let quoted = '"'
  let backslashes = 0
  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1
      continue
    }
    quoted += character === '"' ? `${"\\".repeat(backslashes * 2 + 1)}"` : "\\".repeat(backslashes) + character
    backslashes = 0
  }
  return `${quoted}${"\\".repeat(backslashes * 2)}"`
}
