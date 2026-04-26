import { ProviderRoute } from "../provider-route"

export const id = "github-copilot"

export const shouldUseResponsesApi = (modelID: string) => {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

export const provider = ProviderRoute.define({
  id,
  route: (input) => ProviderRoute.make(id, shouldUseResponsesApi(input.modelID) ? "openai-responses" : "openai-chat"),
})

export const route = provider.route

export * as GitHubCopilot from "./github-copilot"
