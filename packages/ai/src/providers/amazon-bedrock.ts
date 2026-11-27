import type { ProviderPackage } from "../provider-package.js"
import { Provider } from "../provider.js"
import { BedrockConverse } from "../protocols/bedrock-converse.js"
import { BedrockAuth, type Credentials } from "../protocols/utils/bedrock-auth.js"
import { ProviderConfigurationError, ProviderID } from "../schema/index.js"

export type Settings = ProviderPackage.Settings &
  BedrockConverse.OptionsInput & {
    /** Bedrock API key. Falls back to `AWS_BEARER_TOKEN_BEDROCK`; bearer auth takes precedence over SigV4. */
    readonly apiKey?: string
    /** `sigv4` ignores `apiKey` fallbacks from the environment; `bearer` requires a token. */
    readonly auth?: "bearer" | "sigv4"
    /** Override the computed `https://bedrock-runtime.<region>.amazonaws.com` URL. */
    readonly baseURL?: string
    /** Static SigV4 credentials. When omitted the AWS default credential chain resolves them per request. */
    readonly credentials?: Credentials
    /** Shared config profile for the default credential chain. */
    readonly profile?: string
    /** AWS region. Falls back to `credentials.region`, `AWS_REGION`, `AWS_DEFAULT_REGION`, then `us-east-1`. */
    readonly region?: string
    readonly topP?: number
  }

const id = ProviderID.make("amazon-bedrock")

type Connection = Pick<Settings, "apiKey" | "auth" | "credentials" | "profile" | "region" | "topP">

const baseURL = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`

const connection = (values: Connection): Provider.Patch => {
  if (values.auth === "bearer" && values.apiKey === undefined && process.env.AWS_BEARER_TOKEN_BEDROCK === undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Amazon Bedrock bearer auth requires apiKey",
    })
  if (values.auth === "sigv4" && values.apiKey !== undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Amazon Bedrock SigV4 auth does not accept apiKey",
    })
  const region = BedrockAuth.resolveRegion(values)
  return {
    baseURL: baseURL(region),
    auth: BedrockAuth.resolveAuth(values, region, { mode: values.auth }),
    options: values.topP === undefined ? undefined : { topP: values.topP },
  }
}

const region = BedrockAuth.resolveRegion({})

export const amazonBedrock = Provider.make({
  id,
  baseURL: baseURL(region),
  auth: Provider.custom(BedrockAuth.resolveAuth({}, region)),
  apis: [BedrockConverse.api.configure({ metadataKey: "bedrock" })],
  settings: { keys: ["apiKey", "auth", "credentials", "profile", "region", "topP"], patch: connection },
})

export const model = Provider.entrypoint<Settings, BedrockConverse.OptionsInput>(amazonBedrock)
