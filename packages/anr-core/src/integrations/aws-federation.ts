/**
 * AWS Identity Federation for Cognito OIDC tokens
 * Uses Cognito Identity Pool to exchange tokens for AWS credentials
 */

import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from "@aws-sdk/client-cognito-identity"
import type { ANRConfig } from "../config/types"

export interface AWSCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration?: Date
}

export async function exchangeTokenForAWSCredentials(idToken: string, config: ANRConfig): Promise<AWSCredentials> {
  if (!config.identityPoolId) {
    throw new Error("Identity pool ID not configured")
  }

  const region = config.awsRegion || "us-east-2"
  const govcloud = region.startsWith("us-gov-")
  // Bun resolves some AWS SDK CJS modules differently across platforms, causing
  // loadConfig() to appear as a Symbol instead of a function for options like
  // accountIdEndpointMode and authSchemePreference. Supplying these explicitly
  // prevents the SDK from calling loadConfig() for those paths at all.
  const clientConfig: any = {
    region,
    accountIdEndpointMode: "disabled",
    authSchemePreference: [],
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(govcloud && { useFipsEndpoint: true }),
  }
  const client = new CognitoIdentityClient(clientConfig)

  try {
    // Step 1: Get identity ID using the ID token
    // Provider name must match the JWT issuer (always amazonaws.com, even in GovCloud)
    const providerName = `cognito-idp.${region}.amazonaws.com/${config.cognitoUserPoolId}`

    const idResponse = await client.send(
      new GetIdCommand({
        IdentityPoolId: config.identityPoolId,
        Logins: {
          [providerName]: idToken,
        },
      }),
    )

    if (!idResponse.IdentityId) {
      throw new Error("Failed to get identity ID from Cognito Identity Pool")
    }

    // Step 2: Get credentials for the identity
    const credsResponse = await client.send(
      new GetCredentialsForIdentityCommand({
        IdentityId: idResponse.IdentityId,
        Logins: {
          [providerName]: idToken,
        },
      }),
    )

    if (!credsResponse.Credentials) {
      throw new Error("Failed to get credentials from Cognito Identity Pool")
    }

    return {
      accessKeyId: credsResponse.Credentials.AccessKeyId || "",
      secretAccessKey: credsResponse.Credentials.SecretKey || "",
      sessionToken: credsResponse.Credentials.SessionToken || "",
      expiration: credsResponse.Credentials.Expiration,
    }
  } catch (error) {
    console.error("❌ Token exchange failed:", error)
    throw error
  }
}
