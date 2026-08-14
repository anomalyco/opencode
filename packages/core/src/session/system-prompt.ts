export * as SessionSystemPrompt from "./system-prompt.js"

import PROMPT from "./runner/prompt/system.txt"

const TOOL_INSTRUCTIONS = new Map<string, string>()
const OPENCODE_INSTRUCTIONS = ""

export function make(tools: string[]) {
  return PROMPT.replace("${OPENCODE_TOOL_INSTRUCTIONS}", () =>
    tools.flatMap((tool) => TOOL_INSTRUCTIONS.get(tool) ?? []).join("\n\n"),
  ).replace("${OPENCODE_INSTRUCTIONS}", () => OPENCODE_INSTRUCTIONS)
}
