import { Config } from "../config/config"
import { MCP } from "../mcp"
import { UI } from "./ui"
import { SystemPrompt } from "../session/system.ts"

export function FormatError(input: unknown) {
  if (MCP.Failed.isInstance(input))
    return `MCP server "${input.data.name}" failed. Note, opencode does not support MCP authentication yet.`
  if (Config.JsonError.isInstance(input)) return `Config file at ${input.data.path} is not valid JSON`
  if (Config.InvalidError.isInstance(input))
    return [
      `Config file at ${input.data.path} is invalid`,
      ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")
  if (SystemPrompt.PromptResolveError.isInstance(input))
    return `Failed to resolve prompt for: "${input.data.name}" for the reference: "${input.data.reference}"
${input.data.error}`

  if (UI.CancelledError.isInstance(input)) return ""
}
