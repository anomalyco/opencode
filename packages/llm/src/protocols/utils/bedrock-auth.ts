import { AwsV4Signer } from "aws4fetch"
import { Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { Auth, type AuthInput } from "../../route/auth"
import { ProviderShared } from "../shared"

/**
 * AWS credentials for SigV4 signing. Bedrock also supports Bearer API key auth,
 * which provider facades configure as route auth instead of SigV4. STS-vended
 * credentials should be refreshed by the consumer (rebuild the model) before
 * they expire; the route does not refresh.
 */
export interface Credentials {
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

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

/** Sign the exact JSON bytes with SigV4 using credentials configured on the route. */
export const sigV4 = (credentials: Credentials | undefined) =>
  Auth.custom((input: AuthInput) => {
    return Effect.gen(function* () {
      if (!credentials) {
        return yield* ProviderShared.invalidRequest(
          "Bedrock Converse requires either route bearer auth or AWS credentials configured on the route",
        )
      }
      const headersForSigning = Headers.set(input.headers, "content-type", "application/json")
      const signed = yield* signRequest({
        url: input.url,
        body: input.body,
        headers: headersForSigning,
        credentials,
      })
      return Headers.setAll(headersForSigning, signed)
    })
  })

/** Bedrock route auth defaults to SigV4 and expects credentials from route configuration. */
export const auth = sigV4(undefined)

export * as BedrockAuth from "./bedrock-auth"
