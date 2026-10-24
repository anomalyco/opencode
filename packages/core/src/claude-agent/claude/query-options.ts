export * as ClaudeQueryOptions from "./query-options.js"

import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider"
import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { ToolHooks } from "../tools/hooks.js"
import type { PendingTools } from "../tools/pending.js"
import { ToolServer } from "../tools/server.js"
import type { ClaudeIO } from "./io.js"

// Claude Code features that duplicate opencode's. opencode's version wins (README.md, "Claude Code features turned off").
const ISOLATION_ENV = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  DISABLE_AUTO_COMPACT: "1",
  CLAUDE_CODE_ENABLE_AWAY_SUMMARY: "0",
  ENABLE_TOOL_SEARCH: "false",
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
  // Raised so opencode's own truncation applies instead
  MAX_MCP_OUTPUT_TOKENS: "200000",
  // Skips OAuth, so the subscription would not be used
  CLAUDE_CODE_SIMPLE: undefined,
  // A shell-level effort override would take precedence over OpenCode's live effort settings.
  CLAUDE_CODE_EFFORT_LEVEL: undefined,
}

export function base(input: { executable: string; io: ClaudeIO.Interface }): Options {
  return {
    pathToClaudeCodeExecutable: input.executable,
    spawnClaudeCodeProcess: input.io.spawn,
    env: { ...input.io.env(), ...ISOLATION_ENV },
    settingSources: [],
    settings: { disableAllHooks: true },
    // Without summaries, OpenCode has no reasoning text to display
    thinking: { type: "adaptive", display: "summarized" },
    strictMcpConfig: true,
    skills: [],
    tools: [],
    permissionMode: "dontAsk",
    allowedTools: ["mcp__opencode__*"],
    verbatimPrompts: true,
  }
}

export function session(input: {
  readonly executable: string
  readonly io: ClaudeIO.Interface
  readonly directory: string
  readonly model: string
  readonly effort?: Options["effort"]
  readonly maxOutputTokens?: number
  readonly system: NonNullable<Options["systemPrompt"]>
  readonly tools: readonly LanguageModelV3FunctionTool[]
  readonly pending: PendingTools.Interface
  // Side calls run without saving a transcript
  readonly persist: boolean
  readonly resume?: string
}): Options {
  const options: Options = {
    ...base(input),
    cwd: input.directory,
    model: input.model,
    effort: input.effort,
    systemPrompt: input.system,
    includePartialMessages: true,
    persistSession: input.persist,
    hooks: ToolHooks.make(input.pending),
    mcpServers: {},
  }
  if (input.maxOutputTokens !== undefined) {
    options.env = { ...options.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(input.maxOutputTokens) }
  }
  if (input.tools.length > 0) options.mcpServers = { opencode: ToolServer.make(input.tools, input.pending) }
  if (input.resume !== undefined) {
    options.resume = input.resume
    return options
  }
  options.sessionId = crypto.randomUUID()
  return options
}
