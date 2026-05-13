import { NamedError } from "@opencode-ai/core/util/error"
import { errorFormat } from "@/util/error"

interface ErrorLike {
  name?: string
  _tag?: string
  message?: string
  data?: Record<string, unknown>
}

type ConfigIssue = { message: string; path: string[] }

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function isTaggedError(error: unknown, tag: string): boolean {
  return isRecord(error) && error._tag === tag
}

function configData(input: unknown, tag: string): Record<string, unknown> | undefined {
  if (!isRecord(input)) return undefined
  if (input.name === tag && isRecord(input.data)) return input.data
  if (input._tag === tag) return input
  return undefined
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? input[key] : undefined
}

function configIssues(input: Record<string, unknown>): ConfigIssue[] {
  return Array.isArray(input.issues)
    ? input.issues.filter((issue): issue is ConfigIssue => {
        if (!isRecord(issue)) return false
        return (
          typeof issue.message === "string" &&
          Array.isArray(issue.path) &&
          issue.path.every((x) => typeof x === "string")
        )
      })
    : []
}

export function FormatError(input: unknown) {
  // CliError: domain failure surfaced from an effectCmd handler via fail("...")
  if (isTaggedError(input, "CliError")) {
    const data = input as ErrorLike & { exitCode?: number }
    if (data.exitCode != null) process.exitCode = data.exitCode
    return data.message ?? ""
  }

  // MCPFailed: { name: string }
  if (NamedError.hasName(input, "MCPFailed")) {
    return `MCP server "${(input as ErrorLike).data?.name}" failed. Note, opencode does not support MCP authentication yet.`
  }

  // AccountServiceError, AccountTransportError: TaggedErrorClass
  if (isTaggedError(input, "AccountServiceError") || isTaggedError(input, "AccountTransportError")) {
    return (input as ErrorLike).message ?? ""
  }

  // ProviderModelNotFoundError: { providerID: string, modelID: string, suggestions?: string[] }
  if (NamedError.hasName(input, "ProviderModelNotFoundError")) {
    const data = (input as ErrorLike).data
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions.filter((x) => typeof x === "string") : []
    return [
      `Model not found: ${data?.providerID}/${data?.modelID}`,
      ...(suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      `Try: \`opencode models\` to list available models`,
      `Or check your config (opencode.json) provider/model names`,
    ].join("\n")
  }

  // ProviderInitError: { providerID: string }
  if (NamedError.hasName(input, "ProviderInitError")) {
    return `Failed to initialize provider "${(input as ErrorLike).data?.providerID}". Check credentials and configuration.`
  }

  // ConfigJsonError: { path: string, message?: string }
  const configJson = configData(input, "ConfigJsonError")
  if (configJson) {
    const message = stringField(configJson, "message")
    return `Config file at ${stringField(configJson, "path")} is not valid JSON(C)` + (message ? `: ${message}` : "")
  }

  // ConfigDirectoryTypoError: { dir: string, path: string, suggestion: string }
  const configDirectoryTypo = configData(input, "ConfigDirectoryTypoError")
  if (configDirectoryTypo) {
    return `Directory "${stringField(configDirectoryTypo, "dir")}" in ${stringField(configDirectoryTypo, "path")} is not valid. Rename the directory to "${stringField(configDirectoryTypo, "suggestion")}" or remove it. This is a common typo.`
  }

  // ConfigFrontmatterError: { message: string }
  const configFrontmatter = configData(input, "ConfigFrontmatterError")
  if (configFrontmatter) {
    return stringField(configFrontmatter, "message") ?? ""
  }

  // ConfigInvalidError: { path?: string, message?: string, issues?: Array<{ message: string, path: string[] }> }
  const configInvalid = configData(input, "ConfigInvalidError")
  if (configInvalid) {
    const path = stringField(configInvalid, "path")
    const message = stringField(configInvalid, "message")
    const issues = configIssues(configInvalid)
    return [
      `Configuration is invalid${path && path !== "config" ? ` at ${path}` : ""}` + (message ? `: ${message}` : ""),
      ...issues.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")),
    ].join("\n")
  }

  // UICancelledError: user cancelled an interactive CLI prompt
  if (isTaggedError(input, "UICancelledError") || NamedError.hasName(input, "UICancelledError")) {
    return ""
  }
}

export function FormatUnknownError(input: unknown): string {
  return errorFormat(input)
}
