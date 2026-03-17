import z from "zod"

import { runPromiseInstance } from "@/effect/runtime"
import { fn } from "@/util/fn"
import * as S from "./auth-service"
import { ProviderID } from "./schema"

/**
 * Provider authentication utilities for managing OAuth and authorization flows.
 *
 * This namespace provides functions to retrieve available authentication methods,
 * initiate authorization requests, and handle OAuth callbacks.
 *
 * @example
 * ```typescript
 * // Get available auth methods for a provider
 * const methods = await ProviderAuth.methods()
 *
 * // Initiate authorization
 * const auth = await ProviderAuth.authorize({ providerID: "openai", method: 0 })
 * ```
 */
export namespace ProviderAuth {
  export const Method = S.Method
  export type Method = S.Method

  /**
   * Retrieves all available authentication methods across configured providers.
   *
   * @returns Promise resolving to an array of authentication methods
   */
  export async function methods() {
    return runPromiseInstance(S.ProviderAuthService.use((service) => service.methods()))
  }

  export const Authorization = S.Authorization
  export type Authorization = S.Authorization

  /**
   * Initiates an authorization request for a specific provider using the specified method.
   *
   * @param input - Authorization parameters
   * @param input.providerID - The provider identifier (e.g., "openai", "anthropic")
   * @param input.method - The authentication method index to use
   * @returns Promise resolving to authorization details or undefined
   */
  export const authorize = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> =>
      runPromiseInstance(S.ProviderAuthService.use((service) => service.authorize(input))),
  )

  /**
   * Handles the OAuth callback after user authorization.
   *
   * @param input - Callback parameters
   * @param input.providerID - The provider identifier
   * @param input.method - The authentication method index
   * @param input.code - The OAuth authorization code (optional)
   * @returns Promise resolving to the authorization result
   */
  export const callback = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => runPromiseInstance(S.ProviderAuthService.use((service) => service.callback(input))),
  )

  export import OauthMissing = S.OauthMissing
  export import OauthCodeMissing = S.OauthCodeMissing
  export import OauthCallbackFailed = S.OauthCallbackFailed
}
