import { ProviderPlugins as CoreProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { GithubCopilotPlugin } from "./github-copilot"

export const ProviderPlugins = [
  ...CoreProviderPlugins,
  GithubCopilotPlugin,
]
