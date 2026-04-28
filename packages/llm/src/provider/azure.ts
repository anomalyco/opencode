import { ProviderResolver } from "../provider-resolver"
import { ProviderID } from "../schema"

export const id = ProviderID.make("azure")

const stringOption = (options: Record<string, unknown>, key: string) => {
  const value = options[key]
  if (typeof value === "string" && value.trim() !== "") return value
  return undefined
}

const baseURL = (options: Record<string, unknown>) => {
  const resource = stringOption(options, "resourceName")
  if (!resource) return undefined
  return `https://${resource}.openai.azure.com/openai/v1`
}

export const resolver = ProviderResolver.define({
  id,
  resolve: (input) =>
    ProviderResolver.make(id, input.options.useCompletionUrls === true ? "openai-chat" : "openai-responses", {
      baseURL: baseURL(input.options),
      queryParams: { "api-version": stringOption(input.options, "apiVersion") ?? "v1" },
    }),
})

export * as Azure from "./azure"
