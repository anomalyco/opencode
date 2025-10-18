import { Config } from "../config/config"
import { MCP } from "../mcp"
import { UI } from "./ui"

export function FormatError(input: unknown) {
  if (MCP.Failed.isInstance(input))
    return `MCP server "${input.data.name}" failed. Note, opencode does not support MCP authentication yet.`
  if (Config.JsonError.isInstance(input)) {
    return (
      `Config file at ${input.data.path} is not valid JSON(C)` + (input.data.message ? `: ${input.data.message}` : "")
    )
  }
  if (Config.DirectoryError.isInstance(input))
    return `Directory "${input.data.dir}" in ${input.data.path} is not valid. Did you mean "${input.data.suggestion}"?`
  if (Config.InvalidError.isInstance(input))
    return [
      `Config file at ${input.data.path} is invalid` + (input.data.message ? `: ${input.data.message}` : ""),
      ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")

  if (UI.CancelledError.isInstance(input)) return ""
}
