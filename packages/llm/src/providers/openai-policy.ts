import type { ModelPolicy, ReasoningEffort, TextVerbosity } from "../schema"

export type PolicyInput = ModelPolicy | ConstructorParameters<typeof ModelPolicy>[0]
type PolicyObject = ConstructorParameters<typeof ModelPolicy>[0]

export interface OpenAIOptionsInput {
  readonly store?: boolean
  readonly promptCacheKey?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly reasoningSummary?: "auto"
  readonly includeEncryptedReasoning?: boolean
  readonly textVerbosity?: TextVerbosity
}

const mergeSection = <T extends Record<string, unknown>>(...items: ReadonlyArray<T | undefined>): T | undefined => {
  const result = Object.fromEntries(
    items.flatMap((item) => Object.entries(item ?? {}).filter((entry) => entry[1] !== undefined)),
  ) as T
  return Object.keys(result).length === 0 ? undefined : result
}

const mergePolicy = (...items: ReadonlyArray<PolicyInput | undefined>): PolicyObject => ({
  retention: mergeSection(...items.map((item) => item?.retention)),
  reasoning: mergeSection(...items.map((item) => item?.reasoning)),
  text: mergeSection(...items.map((item) => item?.text)),
  cache: mergeSection(...items.map((item) => item?.cache)),
  usage: mergeSection(...items.map((item) => item?.usage)),
})

const openAIOptionPolicy = (options: OpenAIOptionsInput | undefined): PolicyObject => ({
  retention: { store: options?.store },
  reasoning: {
    effort: options?.reasoningEffort,
    summary: options?.reasoningSummary,
    encryptedState: options?.includeEncryptedReasoning,
  },
  text: { verbosity: options?.textVerbosity },
  cache: { promptKey: options?.promptCacheKey },
})

export const gpt5DefaultPolicy = (
  modelID: string,
  options: { readonly textVerbosity?: boolean } = {},
): PolicyObject => {
  const id = modelID.toLowerCase()
  if (!id.includes("gpt-5") || id.includes("gpt-5-chat") || id.includes("gpt-5-pro")) return {}
  return {
    reasoning: { effort: "medium", summary: "auto" },
    text: {
      verbosity:
        options.textVerbosity === true && id.includes("gpt-5.") && !id.includes("codex") && !id.includes("-chat")
          ? "low"
          : undefined,
    },
  }
}

export const openAIDefaultPolicy = (
  modelID: string,
  options: { readonly textVerbosity?: boolean } = {},
): PolicyObject =>
  mergePolicy({ retention: { store: false } }, gpt5DefaultPolicy(modelID, options))

export const withOpenAIPolicy = <Options extends { readonly openai?: OpenAIOptionsInput; readonly policy?: PolicyInput }>(
  modelID: string,
  options: Options,
  defaults: { readonly textVerbosity?: boolean } = {},
): Omit<Options, "openai"> & { readonly id: string; readonly policy: PolicyObject } => {
  const { openai: _, ...rest } = options
  return {
    ...rest,
    id: modelID,
    policy: mergePolicy(openAIDefaultPolicy(modelID, defaults), rest.policy, openAIOptionPolicy(options.openai)),
  }
}
