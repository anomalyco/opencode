export const ClaudeACPProviderID = "claude-acp"

export const ClaudeACPCommands = [
  ["compact", "<instructions>", "Summarize the current conversation context"],
  ["config", "key=value", "Update Claude Code configuration"],
  ["context", "", "Show current context usage"],
  ["debug", "[issue description]", "Enable debug logging for this session"],
  ["effort", "[low|medium|high|max]", "Set Claude Code reasoning effort"],
  ["fast", "[on|off]", "Toggle Claude Code fast mode"],
  ["goal", "", "Set a goal for Claude Code"],
  ["heapdump", "", "Dump the JavaScript heap"],
  ["init", "", "Initialize CLAUDE.md guidance"],
  ["insights", "", "Analyze Claude Code sessions"],
  ["model", "[model]", "Switch the Claude Code model"],
  ["reload-skills", "", "Reload Claude Code skills"],
  ["review", "[pr number]", "Review a pull request"],
  ["security-review", "", "Review changes for security issues"],
  ["team-onboarding", "", "Create teammate onboarding guidance"],
  ["usage", "", "Show session usage"],
  ["usage-credits", "", "Configure usage credits"],
  ["extra-usage", "", "Alias for usage credits"],
] as const

const commands = new Set<string>(ClaudeACPCommands.map(([name]) => name))

export function isClaudeACPCommand(input: string) {
  return commands.has(input.replace(/^\//, "").split(/\s/, 1)[0])
}

export function claudeACPFooter(metadata: Record<string, unknown> | undefined) {
  const state = metadata?.claudeACP
  if (!state || typeof state !== "object" || !("config" in state)) return []
  const config = state.config
  if (!config || typeof config !== "object") return []
  const effort = "effort" in config ? config.effort : undefined
  const fast = "fast" in config ? config.fast : undefined
  return [...(typeof effort === "string" && effort !== "default" ? [effort] : []), ...(fast === "on" ? ["fast"] : [])]
}
