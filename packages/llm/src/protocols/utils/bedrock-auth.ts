import { AwsV4Signer } from "aws4fetch"
import { Effect, Option, Schema } from "effect"
import { Headers } from "effect/unstable/http"
import { Auth, type AuthInput } from "../../route/auth"
import type { LLMRequest } from "../../schema"
import { ProviderShared } from "../shared"

/**
 * AWS credentials for SigV4 signing. Bedrock also supports Bearer API key auth
 * via `model.apiKey`, which bypasses SigV4 signing. STS-vended credentials
 * should be refreshed by the consumer (rebuild the model) before they expire;
 * the route does not refresh.
 */
export interface Credentials {
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

const NativeCredentials = Schema.Struct({
  accessKeyId: Schema.String,
  secretAccessKey: Schema.String,
  region: Schema.optional(Schema.String),
  sessionToken: Schema.optional(Schema.String),
})

const decodeNativeCredentials = Schema.decodeUnknownOption(NativeCredentials)

export const region = (request: LLMRequest) => {
  const fromNative = request.model.native?.aws_region
  if (typeof fromNative === "string" && fromNative !== "") return fromNative
  return (
    decodeNativeCredentials(request.model.native?.aws_credentials).pipe(
      Option.map((credentials) => credentials.region),
      Option.getOrUndefined,
    ) ?? "us-east-1"
  )
}

const credentialsFromInput = (request: LLMRequest): Credentials | undefined =>
  decodeNativeCredentials(request.model.native?.aws_credentials).pipe(
    Option.map((creds) => ({ ...creds, region: creds.region ?? region(request) })),
    Option.getOrUndefined,
  )

const signRequest = (input: {
  readonly url: string
  readonly body: string
  readonly headers: Headers.Headers
  readonly credentials: Credentials
}) =>
  Effect.tryPromise({
    try: async () => {
      const signed = await new AwsV4Signer({
        url: input.url,
        method: "POST",
        headers: Object.entries(input.headers),
        body: input.body,
        region: input.credentials.region,
        accessKeyId: input.credentials.accessKeyId,
        secretAccessKey: input.credentials.secretAccessKey,
        sessionToken: input.credentials.sessionToken,
        service: "bedrock",
      }).sign()
      return Object.fromEntries(signed.headers.entries())
    },
    catch: (error) =>
      ProviderShared.invalidRequest(
        `Bedrock Converse SigV4 signing failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
  })

/**
 * Bedrock auth. `model.apiKey` (Bedrock's newer Bearer API key auth) wins if
 * set; otherwise sign the exact JSON bytes with SigV4 using credentials from
 * `model.native.aws_credentials`.
 */
export const auth = Auth.custom((input: AuthInput) => {
  if (input.request.model.apiKey) return Auth.toEffect(Auth.bearer())(input)
  return Effect.gen(function* () {
    const credentials = credentialsFromInput(input.request)
    if (!credentials) {
      return yield* ProviderShared.invalidRequest(
        "Bedrock Converse requires either model.apiKey or AWS credentials in model.native.aws_credentials",
      )
    }
    const headersForSigning = Headers.set(input.headers, "content-type", "application/json")
    const signed = yield* signRequest({ url: input.url, body: input.body, headers: headersForSigning, credentials })
    return Headers.setAll(headersForSigning, signed)
  })
})

export const nativeCredentials = (native: Record<string, unknown> | undefined, credentials: Credentials | undefined) =>
  credentials
    ? {
        ...native,
        aws_credentials: credentials,
        aws_region: credentials.region,
      }
    : native

export * as BedrockAuth from "./bedrock-auth"
