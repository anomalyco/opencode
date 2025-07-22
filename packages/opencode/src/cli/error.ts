import { Config } from "../config/config"
import { MCP } from "../mcp"
import { UI } from "./ui"
import { Server } from "../server/server"

export function FormatError(input: unknown) {
  if (MCP.Failed.isInstance(input))
    return `MCP server "${input.data.name}" failed. Note, opencode does not support MCP authentication yet.`
  if (Config.JsonError.isInstance(input)) return `Config file at ${input.data.path} is not valid JSON`
  if (Config.InvalidError.isInstance(input))
    return [
      `Config file at ${input.data.path} is invalid`,
      ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")

  if (UI.CancelledError.isInstance(input)) return ""

  if (Server.ServerStartError.isInstance(input)) {
    return input.data.message
  }
}
