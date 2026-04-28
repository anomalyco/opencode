import { ProviderResolver } from "../provider-resolver"
import { ProviderID } from "../schema"

export const id = ProviderID.make("github-copilot")

export const shouldUseResponsesApi = (modelID: string) => {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

export const resolver = ProviderResolver.define({
  id,
  resolve: (input) =>
    ProviderResolver.make(id, shouldUseResponsesApi(input.modelID) ? "openai-responses" : "openai-chat", { auth: "bearer" }),
})

export * as GitHubCopilot from "./github-copilot"
