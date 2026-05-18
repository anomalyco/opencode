import type { ProviderOptions, ReasoningEffort, TextVerbosity } from "../schema"
import { mergeProviderOptions } from "../schema"

export interface OpenAIOptionsInput {
  readonly [key: string]: unknown
  readonly store?: boolean
  readonly promptCacheKey?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly reasoningSummary?: "auto"
  readonly includeEncryptedReasoning?: boolean
  readonly textVerbosity?: TextVerbosity
}

export type OpenAIProviderOptionsInput = ProviderOptions & {
  readonly openai?: OpenAIOptionsInput
}

const definedEntries = (input: Record<string, unknown>) =>
  Object.entries(input).filter((entry) => entry[1] !== undefined)

const openAIProviderOptions = (options: OpenAIOptionsInput | undefined): ProviderOptions | undefined => {
  const openai = Object.fromEntries(
    definedEntries({
      store: options?.store,
      promptCacheKey: options?.promptCacheKey,
      reasoningEffort: options?.reasoningEffort,
      reasoningSummary: options?.reasoningSummary,
      includeEncryptedReasoning: options?.includeEncryptedReasoning,
      textVerbosity: options?.textVerbosity,
    }),
  )
  if (Object.keys(openai).length === 0) return undefined
  return { openai }
}

export const gpt5DefaultOptions = (
  modelID: string,
  options: { readonly textVerbosity?: boolean } = {},
): ProviderOptions | undefined => {
  const id = modelID.toLowerCase()
  if (!id.includes("gpt-5") || id.includes("gpt-5-chat") || id.includes("gpt-5-pro")) return undefined
  return openAIProviderOptions({
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    textVerbosity:
      options.textVerbosity === true && id.includes("gpt-5.") && !id.includes("codex") && !id.includes("-chat")
        ? "low"
        : undefined,
  })
}

export const openAIDefaultOptions = (
  modelID: string,
  options: { readonly textVerbosity?: boolean } = {},
): ProviderOptions | undefined =>
  mergeProviderOptions(openAIProviderOptions({ store: false }), gpt5DefaultOptions(modelID, options))

export const withOpenAIOptions = <Options extends { readonly providerOptions?: OpenAIProviderOptionsInput }>(
  modelID: string,
  options: Options,
  defaults: { readonly textVerbosity?: boolean } = {},
): Options & { readonly id: string; readonly providerOptions?: ProviderOptions } => {
  return {
    ...options,
    id: modelID,
    providerOptions: mergeProviderOptions(openAIDefaultOptions(modelID, defaults), options.providerOptions),
  }
}

export * as OpenAIProviderOptions from "./openai-options"
