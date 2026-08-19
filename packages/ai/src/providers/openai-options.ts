import { mergeProviderOptions, type ProviderOptions } from "../schema/index.js"
import type { OpenResponsesOptionsInput } from "./open-responses-options.js"
import type { Options } from "../protocols/utils/open-responses-options.js"

export type { OpenAIResponseIncludable, OpenAIServiceTier } from "../protocols/utils/openai-options.js"

export type OpenAIOptionsInput = OpenResponsesOptionsInput
export type OpenAIConfigOptions = Options

export type OpenAIProviderOptionsInput = OpenAIOptionsInput

export const gpt5DefaultOptions = (
  modelID: string,
  options: { readonly textVerbosity?: boolean } = {},
): ProviderOptions | undefined => {
  const id = modelID.toLowerCase()
  if (!id.includes("gpt-5") || id.includes("gpt-5-chat") || id.includes("gpt-5-pro")) return undefined
  return {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    // GPT-5 reasoning models are configured stateless (`store: false`) by
    // `openAIDefaultOptions` below, so the only way a follow-up turn can
    // carry reasoning state is via the encrypted reasoning include. Without
    // this, callers using the default model facade get reasoning summaries
    // they cannot replay statelessly.
    include: ["reasoning.encrypted_content"],
    textVerbosity:
      options.textVerbosity === true && id.includes("gpt-5.") && !id.includes("codex") && !id.includes("-chat")
        ? "low"
        : undefined,
  }
}

export const openAIDefaultOptions = (
  modelID: string,
  options: { readonly textVerbosity?: boolean } = {},
): ProviderOptions | undefined => mergeProviderOptions({ store: false }, gpt5DefaultOptions(modelID, options))

export const withOpenAIOptions = <Options extends { readonly providerOptions?: OpenAIProviderOptionsInput }>(
  modelID: string,
  options: Options,
  defaults: { readonly textVerbosity?: boolean } = {},
): Omit<Options, "providerOptions"> & { readonly providerOptions?: ProviderOptions } => {
  return {
    ...options,
    providerOptions: mergeProviderOptions(openAIDefaultOptions(modelID, defaults), options.providerOptions),
  }
}

export * as OpenAIProviderOptions from "./openai-options.js"
