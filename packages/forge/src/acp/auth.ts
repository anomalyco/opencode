import type { AuthMethod } from "@agentclientprotocol/sdk"
import type { ACPClient } from "./client"
import { AuthenticationRequiredError, ACP_ERROR_CODES } from "./types"

/**
 * Manages authentication flows for ACP agents
 *
 * Handles the complexity of:
 * - Optional authenticate() method (some agents like Claude Code don't implement it)
 * - Multiple error formats (custom class vs JSON-RPC error codes)
 * - Extracting user-friendly instructions from auth metadata
 */
export class ACPAuthManager {
  /**
   * Attempts to authenticate with an agent
   *
   * Some agents (like Claude Code) don't implement the authenticate() method
   * and rely on external authentication (e.g., `claude /login`). This method
   * gracefully handles that case by catching "not implemented" errors.
   *
   * @param client - The ACP client instance
   * @param authMethods - Available authentication methods from initialize response
   * @param onSelectMethod - Callback to prompt user to select an auth method
   * @returns Success status and the auth method used
   */
  static async attemptAuth(
    client: ACPClient.Instance,
    authMethods: AuthMethod[],
    onSelectMethod: (methods: AuthMethod[]) => Promise<AuthMethod | null>,
  ): Promise<{ success: boolean; method?: AuthMethod }> {
    if (authMethods.length === 0) {
      return { success: true }
    }

    // Prompt user to select auth method
    const selectedMethod = await onSelectMethod(authMethods)
    if (!selectedMethod) {
      throw new Error("Authentication cancelled by user")
    }

    try {
      await client.authenticate(selectedMethod.id)
      return { success: true, method: selectedMethod }
    } catch (error: unknown) {
      // Graceful fallback for agents that don't implement authenticate()
      const isNotImplemented =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === ACP_ERROR_CODES.INTERNAL_ERROR &&
        "data" in error &&
        typeof error.data === "object" &&
        error.data !== null &&
        "details" in error.data &&
        typeof error.data.details === "string" &&
        error.data.details.includes("not implemented")

      if (isNotImplemented) {
        // Agent doesn't support protocol auth - will be validated during createSession
        return { success: true, method: selectedMethod }
      }

      // Real authentication error - bubble it up
      throw error
    }
  }

  /**
   * Checks if an error is authentication-related
   *
   * Detects auth errors from two different sources:
   * 1. AuthenticationRequiredError (custom class thrown by our client)
   * 2. JSON-RPC error with code -32000 (thrown by agent subprocess)
   *
   * @param error - The error to check
   * @returns Object with isAuthError flag and optional instruction
   */
  static isAuthError(error: unknown): {
    isAuthError: boolean
    instruction?: string
  } {
    // Check for custom error class
    if (error instanceof AuthenticationRequiredError) {
      return {
        isAuthError: true,
        instruction: error.authMethods[0]?.description ?? undefined,
      }
    }

    // Check for JSON-RPC error code -32000
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === ACP_ERROR_CODES.AUTH_REQUIRED
    ) {
      return { isAuthError: true }
    }

    return { isAuthError: false }
  }

  /**
   * Formats a user-friendly authentication error message
   *
   * @param agentName - Name of the agent requiring authentication
   * @param instruction - Optional instruction from auth method or error
   * @param authMethod - Optional auth method with description
   * @returns Formatted message for display to user
   */
  static formatAuthMessage(
    agentName: string,
    instruction?: string,
    authMethod?: AuthMethod
  ): string {
    const defaultMsg = "Please authenticate and try again."
    const methodDesc = authMethod?.description ?? instruction ?? defaultMsg
    return `${agentName} requires authentication. ${methodDesc}`
  }
}
