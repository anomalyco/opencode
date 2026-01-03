import { ConfigMarkdown } from "@/config/markdown"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Provider } from "../provider/provider"
import { t } from "../i18n"
import { UI } from "./ui"

export function FormatError(input: unknown) {
  if (MCP.Failed.isInstance(input)) return t("error.mcp_server_failed", { name: input.data.name })
  if (Provider.ModelNotFoundError.isInstance(input)) {
    const { providerID, modelID, suggestions } = input.data
    return [
      t("error.model_not_found", { provider: providerID, model: modelID }),
      ...(Array.isArray(suggestions) && suggestions.length
        ? [t("error.model_did_you_mean", { suggestions: suggestions.join(", ") })]
        : []),
      t("error.model_try_list"),
      t("error.model_check_config"),
    ].join("\n")
  }
  if (Provider.InitError.isInstance(input)) {
    return t("error.provider_init_failed", { provider: input.data.providerID })
  }
  if (Config.JsonError.isInstance(input)) {
    return (
      t("error.config_invalid_json", { path: input.data.path }) + (input.data.message ? `: ${input.data.message}` : "")
    )
  }
  if (Config.ConfigDirectoryTypoError.isInstance(input)) {
    return t("error.config_directory_typo", {
      dir: input.data.dir,
      path: input.data.path,
      suggestion: input.data.suggestion,
    })
  }
  if (ConfigMarkdown.FrontmatterError.isInstance(input)) {
    return t("error.frontmatter_parse_failed", { path: input.data.path }) + `\n${input.data.message}`
  }
  if (Config.InvalidError.isInstance(input))
    return [
      (input.data.path && input.data.path !== "config"
        ? t("error.config_invalid_at", { path: input.data.path })
        : t("error.config_invalid")) + (input.data.message ? `: ${input.data.message}` : ""),
      ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")

  if (UI.CancelledError.isInstance(input)) return ""
}

export function FormatUnknownError(input: unknown): string {
  if (input instanceof Error) {
    return input.stack ?? `${input.name}: ${input.message}`
  }

  if (typeof input === "object" && input !== null) {
    try {
      const json = JSON.stringify(input, null, 2)
      if (json && json !== "{}") return json
    } catch {}
  }

  return String(input)
}
