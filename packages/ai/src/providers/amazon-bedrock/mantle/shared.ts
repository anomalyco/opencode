import type { ProviderPackage } from "../../../provider-package.js"
import { Provider } from "../../../provider.js"
import { BedrockAuth, type Credentials } from "../../../protocols/utils/bedrock-auth.js"
import { ProviderConfigurationError, ProviderID } from "../../../schema/index.js"
import type { AnthropicMessages } from "../../../protocols/anthropic-messages.js"
import type { OpenAIProviderOptionsInput } from "../../openai-options.js"

export type Settings<Options = OpenAIProviderOptionsInput> = ProviderPackage.Settings &
  Options & {
    /** Bedrock API key. Falls back to `AWS_BEARER_TOKEN_BEDROCK`; bearer auth takes precedence over SigV4. */
    readonly apiKey?: string
    /** `sigv4` ignores `apiKey` fallbacks from the environment; `bearer` requires a token. */
    readonly auth?: "bearer" | "sigv4"
    /**
     * Mantle serves each model under one path prefix and rejects it on the others. Responses and Chat default to
     * `https://bedrock-mantle.<region>.api.aws/v1`, which serves open-weight models such as `openai.gpt-oss-120b`.
     * Others, including GPT models such as `openai.gpt-5.4`, need `.../openai/v1`; each AWS model card lists the base
     * URL under Programmatic Access. Messages defaults to `.../anthropic/v1`.
     */
    readonly baseURL?: string
    /** Static SigV4 credentials. When omitted the AWS default credential chain resolves them per request. */
    readonly credentials?: Credentials
    /** Shared config profile for the default credential chain. */
    readonly profile?: string
    readonly region?: string
    readonly topP?: number
  }

export type MessagesSettings = Settings<AnthropicMessages.ProviderOptionsInput>

const id = ProviderID.make("amazon-bedrock")

type Connection = Pick<Settings, "apiKey" | "auth" | "credentials" | "profile" | "region" | "topP">

const signing = { service: "bedrock-mantle", name: "Bedrock Mantle" }

/** Mantle's URL for a region, under `prefix` (`/anthropic` for Messages). */
export const baseURL = (region: string, prefix = "") => `https://bedrock-mantle.${region}.api.aws${prefix}/v1`

export const region = BedrockAuth.resolveRegion({})

/** What every Mantle API shares. */
export const shared = {
  id,
  auth: Provider.custom(BedrockAuth.resolveAuth({}, region, signing)),
} satisfies Omit<Provider.Input<[]>, "apis">

/** Region, auth and generation settings. `prefix` is the API's path prefix the region's URL resolves under. */
export const settings = (prefix = "") =>
  ({
    keys: ["apiKey", "auth", "credentials", "profile", "region", "topP"],
    patch: (values: Connection) => {
      if (values.auth === "bearer" && values.apiKey === undefined && process.env.AWS_BEARER_TOKEN_BEDROCK === undefined)
        throw new ProviderConfigurationError({
          provider: id,
          message: "Amazon Bedrock Mantle bearer auth requires apiKey",
        })
      if (values.auth === "sigv4" && values.apiKey !== undefined)
        throw new ProviderConfigurationError({
          provider: id,
          message: "Amazon Bedrock Mantle SigV4 auth does not accept apiKey",
        })
      const resolved = BedrockAuth.resolveRegion(values)
      return {
        baseURL: baseURL(resolved, prefix),
        auth: BedrockAuth.resolveAuth(values, resolved, { ...signing, mode: values.auth }),
        options: values.topP === undefined ? undefined : { topP: values.topP },
      }
    },
  }) satisfies Provider.SettingsHook
