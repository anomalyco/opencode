import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"
import { openAIDefaultOptions, type OpenAIProviderOptionsInput } from "../openai-options.js"

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
    readonly organization?: string
    readonly project?: string
    readonly queryParams?: Readonly<Record<string, string>>
  }

/** What every OpenAI API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "openai",
  baseURL: "https://api.openai.com/v1",
  auth: Provider.apiKey("OPENAI_API_KEY"),
  settings: {
    keys: ["organization", "project", "queryParams"],
    patch: (values: Pick<Settings, "organization" | "project" | "queryParams">) => {
      const headers = {
        ...(values.organization === undefined ? {} : { "OpenAI-Organization": values.organization }),
        ...(values.project === undefined ? {} : { "OpenAI-Project": values.project }),
      }
      return { headers: Object.keys(headers).length === 0 ? undefined : headers, query: values.queryParams }
    },
  },
} satisfies Omit<Provider.Input<[]>, "apis">

/** Stateless defaults, plus reasoning summaries and encrypted reasoning for GPT-5 family models. */
export const options = (modelID: string) => ({ providerOptions: openAIDefaultOptions(modelID) })
