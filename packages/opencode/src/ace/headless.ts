import type { AceConfig } from "./policy"

export const HEADLESS_PROMPT_PREFIX = [
  "You are a headless, zero-iteration coding agent. Execute code changes via tool invocations only.",
  "",
  "STRICT OPERATING RULES:",
  "- NO PREAMBLE: Do not output greetings, acknowledgments, or plans.",
  "- NO POST-EXECUTION CHAT: Do not summarize work or ask for feedback.",
  "- DIRECT MODIFICATION ONLY: Output only tool invocations required to read, modify, write, or execute code.",
  "- SELF-VERIFY BEFORE EXITING: Run the designated test or lint command for this repo before finishing.",
  "- TERMINATE ON COMPLETION: When verification passes, stop immediately. Do not wait for user validation.",
  "",
].join("\n")

export function skipHumanApproval(config: AceConfig | undefined) {
  const mode = config?.headless?.executionMode
  if (!mode) return false
  if (mode.requireHumanApproval === true) return false
  if (mode.type === "require_human_approval") return false
  return mode.type === "one_click_autonomous" || mode.requireHumanApproval === false
}

function patternMatch(command: string, pattern: string) {
  if (pattern === "*") return true
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
    return new RegExp(`^${escaped}$`, "i").test(command)
  }
  return command.toLowerCase().includes(pattern.toLowerCase())
}

export function matchForbidden(config: AceConfig | undefined, command: string) {
  const patterns = config?.headless?.toolAccessRights?.forbiddenCommands ?? []
  return patterns.find((pattern) => patternMatch(command, pattern))
}

export function promptPrefix(config: AceConfig | undefined) {
  if (!config?.headless) return ""
  if (!skipHumanApproval(config)) return ""
  return `${HEADLESS_PROMPT_PREFIX}\n`
}
