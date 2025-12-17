import { TextField } from "@opencode-ai/ui/text-field"
import { Logo } from "@opencode-ai/ui/logo"
import { Component } from "solid-js"
import { usePlatform } from "@/context/platform"
import { Icon } from "@opencode-ai/ui/icon"

export type InitError = {
  name: string
  data: Record<string, unknown>
}

function formatError(error: InitError | undefined): string {
  if (!error) return "Unknown error"

  const data = error.data
  switch (error.name) {
    case "MCPFailed":
      return `MCP server "${data.name}" failed. Note, opencode does not support MCP authentication yet.`
    case "ProviderModelNotFoundError": {
      const { providerID, modelID, suggestions } = data as {
        providerID: string
        modelID: string
        suggestions?: string[]
      }
      return [
        `Model not found: ${providerID}/${modelID}`,
        ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
        `Check your config (opencode.json) provider/model names`,
      ].join("\n")
    }
    case "ProviderInitError":
      return `Failed to initialize provider "${data.providerID}". Check credentials and configuration.`
    case "ConfigJsonError":
      return `Config file at ${data.path} is not valid JSON(C)` + (data.message ? `: ${data.message}` : "")
    case "ConfigDirectoryTypoError":
      return `Directory "${data.dir}" in ${data.path} is not valid. Rename the directory to "${data.suggestion}" or remove it. This is a common typo.`
    case "ConfigFrontmatterError":
      return `Failed to parse frontmatter in ${data.path}:\n${data.message}`
    case "ConfigInvalidError": {
      const issues = Array.isArray(data.issues)
        ? data.issues.map(
            (issue: { message: string; path: string[] }) => "↳ " + issue.message + " " + issue.path.join("."),
          )
        : []
      return [`Config file at ${data.path} is invalid` + (data.message ? `: ${data.message}` : ""), ...issues].join(
        "\n",
      )
    }
    case "UnknownError":
      return String(data.message)
    default:
      return data.message ? String(data.message) : JSON.stringify(data, null, 2)
  }
}

interface ErrorPageProps {
  error: InitError | undefined
}

export const ErrorPage: Component<ErrorPageProps> = (props) => {
  const platform = usePlatform()
  console.log("ErrorPage", props.error)
  return (
    <div class="relative flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center">
      <div class="w-2/3 max-w-3xl flex flex-col items-center justify-center gap-8">
        <Logo class="h-8 w-auto text-text-strong" />
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">Something went wrong</h1>
          <p class="text-sm text-text-weak">An error occurred while loading the application.</p>
        </div>
        <TextField
          value={formatError(props.error)}
          readOnly
          copyable
          multiline
          class="max-h-96 w-full font-mono text-xs no-scrollbar whitespace-pre"
          label="Error Details"
          hideLabel
        />
        <div class="flex items-center justify-center gap-1">
          Please report this error to the OpenCode team
          <button
            type="button"
            class="flex items-center text-text-interactive-base gap-1"
            onClick={() => platform.openLink("https://opencode.ai/desktop-feedback")}
          >
            <div>on Discord</div>
            <Icon name="discord" class="text-text-interactive-base" />
          </button>
        </div>
      </div>
    </div>
  )
}
