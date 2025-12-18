import type { Credentials } from "@/credentials"

/**
 * Type guard to check if a secret is an OAuth secret with a refresh token.
 */
export function isOAuthSecretWithRefresh(secret: Credentials.Secret): secret is Credentials.OAuthSecret {
    return (
        typeof secret === "object" &&
        secret !== null &&
        "accessToken" in secret &&
        "refreshToken" in secret &&
        typeof (secret as any).refreshToken === "string" &&
        (secret as any).refreshToken.length > 0
    )
}

/**
 * Type guard to check if a secret is an OAuth secret (may or may not have refresh token).
 */
export function isOAuthSecret(secret: Credentials.Secret): secret is Credentials.OAuthSecret {
    return typeof secret === "object" && secret !== null && "accessToken" in secret
}

/**
 * Type guard to check if a secret is an API key secret.
 */
export function isApiSecret(secret: Credentials.Secret): secret is Credentials.ApiSecret {
    return typeof secret === "object" && secret !== null && "apiKey" in secret
}
