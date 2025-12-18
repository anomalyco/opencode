import type { AuthOuathResult, Hooks } from "@opencode-ai/plugin"
import type { Credentials } from "@/credentials"

export type ProviderAuthMethod = NonNullable<Hooks["auth"]>["methods"][number]

export type RotateDecision = {
  rotatable: boolean
  isAuthExpired?: boolean
  cooldownMs?: number
  reason: string
}

export type PrepareRequestArgs = {
  url: URL
  headers: Headers
  request: Request
  secret: Credentials.Secret
}

export interface ProviderAuthAdapter {
  providerId: string

  authMethods(): ProviderAuthMethod[]

  /**
   * Optional request transformation hook for subscription auth.
   * Implementations may mutate `url` and `headers` in-place.
   */
  prepareRequest?(args: PrepareRequestArgs): void

  /**
   * Apply authentication for inference calls.
   * Implementations should mutate `headers` in-place (e.g. set Authorization).
   */
  applyAuth(headers: Headers, secret: Credentials.Secret): void

  /**
   * If supported, refresh an OAuth credential.
   * Returns the updated secret fields to persist.
   */
  refresh?(secret: Credentials.Secret): Promise<Credentials.Secret>

  /**
   * Classify a response as rotatable (rate limit, quota exhausted, etc).
   */
  classifyResponse?(response: Response): Promise<RotateDecision> | RotateDecision
}

export function isOAuthSuccessResult(
  result: Awaited<ReturnType<AuthOuathResult["callback"]>>,
): result is { type: "success"; access: string; refresh: string; expires: number; provider?: string } {
  return result.type === "success" && "access" in result && "refresh" in result && "expires" in result
}
