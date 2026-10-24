export * as ClaudeIO from "./io.js"

import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { which } from "../../util/which.js"
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
