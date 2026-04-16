import { AccountServiceError, AccountTransportError } from "@/account"
import { ConfigMarkdown } from "@/config/markdown"
import { errorFormat } from "@/util/error"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { UI } from "./ui"

export function FormatError(input: unknown) {
  if (MCP.Failed.isInstance(input))
    return `MCP server "${input.data.name}" failed. Note, opencode does not support MCP authentication yet.`
  if (input instanceof AccountTransportError || input instanceof AccountServiceError) {
    return input.message
  }
  if (Provider.ModelNotFoundError.isInstance(input)) {
    const { providerID, modelID, suggestions } = input.data
    return [
      `Model not found: ${providerID}/${modelID}`,
      ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      `Try: \`opencode models\` to list available models`,
      `Or check your config (opencode.json) provider/model names`,
    ].join("\n")
  }
  if (Provider.InitError.isInstance(input)) {
    return `Failed to initialize provider "${input.data.providerID}". Check credentials and configuration.`
  }
  if (Config.JsonError.isInstance(input)) {
    return (
      `Config file at ${input.data.path} is not valid JSON(C)` + (input.data.message ? `: ${input.data.message}` : "")
    )
  }
  if (Config.ConfigDirectoryTypoError.isInstance(input)) {
    return `Directory "${input.data.dir}" in ${input.data.path} is not valid. Rename the directory to "${input.data.suggestion}" or remove it. This is a common typo.`
  }
  if (ConfigMarkdown.FrontmatterError.isInstance(input)) {
    return input.data.message
  }
  if (Config.InvalidError.isInstance(input))
    return [
      `Configuration is invalid${input.data.path && input.data.path !== "config" ? ` at ${input.data.path}` : ""}` +
        (input.data.message ? `: ${input.data.message}` : ""),
      ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")

  if (UI.CancelledError.isInstance(input)) return ""
}

export function FormatUnknownError(input: unknown): string {
  return errorFormat(input)
}
