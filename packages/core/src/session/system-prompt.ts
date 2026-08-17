export * as SessionSystemPrompt from "./system-prompt.js"

import PROMPT from "./runner/prompt/system.txt"

export function make(tools: string[]) {
  const instructions: string[] = []
  if (tools.includes("write")) {
    instructions.push(
      "- Use the write tool to create files or completely replace their content. Prefer using the edit tool for targeted changes.",
    )
  }
  if (tools.includes("edit")) {
    instructions.push(
      "- Use the edit tool for targeted changes to existing text files. It replaces the exact text in `oldString` with `newString`, and the values must differ. By default, `oldString` must occur exactly once. If it occurs multiple times, include more surrounding context to make it unique or set `replaceAll` to true to replace every occurrence.",
    )
  }
  // if (tools.includes("patch")) {
  //   // instructions.push(...)
  // }
  if (tools.includes("read")) {
    instructions.push("- Prefer using the read tool rather than shell commands like `cat`.")
  }
  return PROMPT.replace("${OPENCODE_TOOL_GUIDANCE}", instructions.join("\n"))
}
