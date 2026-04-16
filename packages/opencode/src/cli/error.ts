import { errorFormat } from "@/util/error"

// Error name constants to avoid importing heavy modules
const ERROR_NAMES = {
  MCP_FAILED: "MCPFailed",
  ACCOUNT_TRANSPORT: "AccountTransportError",
  ACCOUNT_SERVICE: "AccountServiceError",
  PROVIDER_MODEL_NOT_FOUND: "ProviderModelNotFoundError",
  PROVIDER_INIT: "ProviderInitError",
  CONFIG_JSON: "ConfigJsonError",
  CONFIG_DIR_TYPO: "ConfigConfigDirectoryTypoError",
  CONFIG_MARKDOWN_FRONTMATTER: "ConfigMarkdownFrontmatterError",
  CONFIG_INVALID: "ConfigInvalidError",
  UI_CANCELLED: "UICancelledError",
} as const

function isNamedError(input: unknown, name: string): boolean {
  return input instanceof Error && input.name === name
}

function getErrorData(input: unknown): Record<string, any> | undefined {
  if (input instanceof Error && "data" in input) {
    return (input as any).data
  }
  return undefined
}

export function FormatError(input: unknown) {
  // MCP.Failed
  if (isNamedError(input, ERROR_NAMES.MCP_FAILED)) {
    const data = getErrorData(input)
    return `MCP server "${data?.name}" failed. Note, opencode does not support MCP authentication yet.`
  }

  // Account errors
  if (isNamedError(input, ERROR_NAMES.ACCOUNT_TRANSPORT) || isNamedError(input, ERROR_NAMES.ACCOUNT_SERVICE)) {
    return (input as Error).message
  }

  // Provider.ModelNotFoundError
  if (isNamedError(input, ERROR_NAMES.PROVIDER_MODEL_NOT_FOUND)) {
    const data = getErrorData(input)
    const { providerID, modelID, suggestions } = data ?? {}
    return [
      `Model not found: ${providerID}/${modelID}`,
      ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      `Try: \`opencode models\` to list available models`,
      `Or check your config (opencode.json) provider/model names`,
    ].join("\n")
  }

  // Provider.InitError
  if (isNamedError(input, ERROR_NAMES.PROVIDER_INIT)) {
    const data = getErrorData(input)
    return `Failed to initialize provider "${data?.providerID}". Check credentials and configuration.`
  }

  // Config.JsonError
  if (isNamedError(input, ERROR_NAMES.CONFIG_JSON)) {
    const data = getErrorData(input)
    return `Config file at ${data?.path} is not valid JSON(C)` + (data?.message ? `: ${data.message}` : "")
  }

  // Config.ConfigDirectoryTypoError
  if (isNamedError(input, ERROR_NAMES.CONFIG_DIR_TYPO)) {
    const data = getErrorData(input)
    return `Directory "${data?.dir}" in ${data?.path} is not valid. Rename the directory to "${data?.suggestion}" or remove it. This is a common typo.`
  }

  // ConfigMarkdown.FrontmatterError
  if (isNamedError(input, ERROR_NAMES.CONFIG_MARKDOWN_FRONTMATTER)) {
    return (input as Error).message
  }

  // Config.InvalidError
  if (isNamedError(input, ERROR_NAMES.CONFIG_INVALID)) {
    const data = getErrorData(input)
    const path = data?.path && data.path !== "config" ? ` at ${data.path}` : ""
    const message = data?.message ? `: ${data.message}` : ""
    const issues = data?.issues?.map((issue: any) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []
    return [`Configuration is invalid${path}${message}`, ...issues].join("\n")
  }

  // UI.CancelledError
  if (isNamedError(input, ERROR_NAMES.UI_CANCELLED)) return ""
}

export function FormatUnknownError(input: unknown): string {
  return errorFormat(input)
}
