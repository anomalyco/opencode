export * as ClaudeSystemPrompt from "./system-prompt.js"

import type { Options } from "@anthropic-ai/claude-agent-sdk"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

export const AGENT_OPTION = "claudeCodeAgent"
export const INSTRUCTIONS_OPTION = "claudeCodeInstructions"

const primary = {
  type: "preset",
  preset: "claude_code",
  // Agent changes must take effect when a process resumes the same native session.
  snapshot: false,
  append:
    "<runtime_info>You are running in OpenCode through the Claude Code harness. Mention this only when asked.</runtime_info>",
} satisfies Options["systemPrompt"]

export function make(role?: string, instructions?: string) {
  const blocks = [primary.append]
  if (role) blocks.push("# Agent role (from OpenCode)\n" + role)
  if (instructions) blocks.push(instructions)
  return { ...primary, append: blocks.join("\n\n") }
}

export function utility(prompt: LanguageModelV3Prompt) {
  const blocks = prompt.filter((message) => message.role === "system").map((message) => message.content)
  return blocks.join("\n\n") || "You are a text generation helper. Return only the requested output."
}
