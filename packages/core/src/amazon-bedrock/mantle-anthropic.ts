import { AnthropicMessagesLanguageModel } from "@ai-sdk/anthropic/internal"
import { withoutTrailingSlash, type FetchFunction } from "@ai-sdk/provider-utils"
import { AwsV4Signer } from "aws4fetch"

export interface BedrockMantleAnthropicSettings {
  /** AWS region for the Bedrock Mantle endpoint. Defaults to `AWS_REGION`, then `us-east-1`. */
  region?: string
  /** Override the computed `https://bedrock-mantle.<region>.api.aws/anthropic/v1` URL. */
  baseURL?: string
  /** Bedrock API key. When set, requests authenticate with the `x-api-key` header instead of SigV4. Mantle accepts either. */
  apiKey?: string
  headers?: Record<string, string>
  /** AWS credential provider used for SigV4 signing when no API key is set. */
  credentialProvider?: () => PromiseLike<{
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }>
  fetch?: FetchFunction
}

/**
 * Anthropic Messages API on the `bedrock-mantle` endpoint.
 *
 * Mantle serves Claude models at `/anthropic/v1/messages` rather than the
 * `bedrock-runtime` `/model/{id}/invoke` path, and its OpenAI-compatible
 * surfaces reject Anthropic model IDs. `@ai-sdk/amazon-bedrock/anthropic` cannot
 * serve it either: it hardcodes the `bedrock-runtime` `/model/{id}/invoke` URL and
 * moves the model ID into an `anthropic_version` body field.
 *
 * `@ai-sdk/anthropic` speaks the right wire format, and Mantle accepts its
 * `x-api-key` header, but it cannot use the AWS credential chain, so SigV4
 * signing happens in `fetch` here to keep profile, SSO and IRSA auth working.
 *
 * The model comes from `@ai-sdk/anthropic/internal` rather than `createAnthropic`
 * because `supportsNativeStructuredOutput` and `supportsStrictTools` exist only on
 * the model config, not on `AnthropicProviderSettings`. `@ai-sdk/google-vertex/anthropic`
 * builds its model the same way.
 */
export function createBedrockMantleAnthropic(options: BedrockMantleAnthropicSettings = {}) {
  const region = options.region ?? process.env["AWS_REGION"] ?? "us-east-1"
  const apiKey = options.apiKey ?? process.env["AWS_BEARER_TOKEN_BEDROCK"]
  const languageModel = (modelId: string) =>
    new AnthropicMessagesLanguageModel(modelId, {
      provider: "anthropic.messages",
      baseURL: withoutTrailingSlash(options.baseURL) ?? `https://bedrock-mantle.${region}.api.aws/anthropic/v1`,
      headers: {
        "anthropic-version": "2023-06-01",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
        ...options.headers,
      },
      fetch: apiKey ? options.fetch : sigV4Fetch(region, options.credentialProvider ?? envCredentials(), options.fetch),
      // Same URL sources `createAnthropic` allows.
      supportedUrls: () => ({ "image/*": [/^https?:\/\/.*$/], "application/pdf": [/^https?:\/\/.*$/] }),
      // Mantle rejects `output_config.format` with a 400, so structured outputs
      // have to take the SDK's `json` tool path instead.
      supportsNativeStructuredOutput: false,
      // Mantle also rejects a tool-level `strict` field (`tools.0.custom.strict`),
      // so let the SDK warn about strict tools rather than forwarding it.
      supportsStrictTools: false,
    })
  return {
    specificationVersion: "v3" as const,
    languageModel,
    chat: languageModel,
    messages: languageModel,
  }
}

function sigV4Fetch(
  region: string,
  credentials: BedrockMantleAnthropicSettings["credentialProvider"],
  next: FetchFunction = fetch,
): FetchFunction {
  return Object.assign(
    async (input: Parameters<FetchFunction>[0], init: Parameters<FetchFunction>[1]) => {
      if (!credentials)
        throw new Error("Bedrock Mantle requires either an API key or AWS credentials for SigV4 signing")
      const resolved = await credentials()
      const headers = new Headers(init?.headers)
      // A caller may set `headers["x-api-key"]` explicitly; a SigV4 request must not
      // present a competing credential, so drop it before signing.
      headers.delete("x-api-key")
      const signed = await new AwsV4Signer({
        url: input.toString(),
        method: init?.method ?? "POST",
        headers: [...headers],
        body: init?.body as string,
        region,
        accessKeyId: resolved.accessKeyId,
        secretAccessKey: resolved.secretAccessKey,
        sessionToken: resolved.sessionToken,
        service: "bedrock-mantle",
      }).sign()
      return next(signed.url, { ...init, headers: signed.headers })
    },
    { preconnect: fetch.preconnect },
  )
}

/** Static env credentials, for direct consumers of this module that inject no credential provider. */
function envCredentials(): BedrockMantleAnthropicSettings["credentialProvider"] {
  const accessKeyId = process.env["AWS_ACCESS_KEY_ID"]
  const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"]
  if (!accessKeyId || !secretAccessKey) return undefined
  return async () => ({ accessKeyId, secretAccessKey, sessionToken: process.env["AWS_SESSION_TOKEN"] })
}
