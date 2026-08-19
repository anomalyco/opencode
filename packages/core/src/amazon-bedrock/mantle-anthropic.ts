import { createAnthropic } from "@ai-sdk/anthropic"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import { AwsV4Signer } from "aws4fetch"

export interface BedrockMantleAnthropicSettings {
  /** AWS region for the Bedrock Mantle endpoint. Defaults to `AWS_REGION`, then `us-east-1`. */
  region?: string
  /** Override the computed `https://bedrock-mantle.<region>.api.aws/anthropic/v1` URL. */
  baseURL?: string
  /** Bedrock API key. When set, requests use bearer auth instead of SigV4. */
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
 * surfaces reject Anthropic model IDs. `@ai-sdk/anthropic` speaks the right
 * wire format but only authenticates with a key, so SigV4 signing happens in
 * `fetch` here to keep AWS credential-chain auth (profiles, SSO, IRSA) working.
 */
export function createBedrockMantleAnthropic(options: BedrockMantleAnthropicSettings = {}) {
  const region = options.region ?? process.env["AWS_REGION"] ?? "us-east-1"
  const apiKey = options.apiKey ?? process.env["AWS_BEARER_TOKEN_BEDROCK"]
  return createAnthropic({
    baseURL: options.baseURL ?? `https://bedrock-mantle.${region}.api.aws/anthropic/v1`,
    // Placeholder keeps the SDK's key check happy; signed requests drop the header.
    apiKey: apiKey ?? "sigv4",
    headers: options.headers,
    fetch: apiKey ? options.fetch : sigV4Fetch(region, options.credentialProvider, options.fetch),
  })
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
      // The AI SDK always sets an Anthropic API key header; SigV4 requests must not carry it.
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
