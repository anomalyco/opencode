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
  const client = new CognitoIdentityClient({
    region,
    // Bun can trip on node-config-provider loadConfig in some mixed SDK graphs.
    // Setting this explicitly avoids that runtime path.
    accountIdEndpointMode: "disabled",
    ...(govcloud && { useFipsEndpoint: true }),
  })

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
