/**
 * Derives the aTLS connection status from provider options and message error state.
 *
 * A provider is aTLS-capable if it has "policyFile" or "policy" in its options.
 * If the message completed without error, the aTLS handshake succeeded (the
 * ai-provider throws on failed attestation). If there's an error, the connection
 * or attestation may have failed.
 *
 * @param providerOptions - the provider's options from config (may contain policyFile/policy)
 * @param hasError - whether the message had an error
 */
export function getAtlsStatus(
  providerOptions: Record<string, unknown> | undefined,
  hasError: boolean,
): "connected" | "error" | null {
  const isAtls = !!(providerOptions?.policyFile || providerOptions?.policy)
  if (!isAtls) return null
  return hasError ? "error" : "connected"
}

/**
 * Returns a security indicator based on the aTLS connection status.
 *
 * @param atlsStatus - null if provider doesn't support aTLS,
 *   "connected"/"error" from getAtlsStatus()
 * @param hasError - whether the message had an error
 */
export function getSecurityIndicator(
  atlsStatus: "connected" | "error" | "idle" | null,
  hasError: boolean,
) {
  // No aTLS support or no connection attempted yet → no indicator
  if (atlsStatus === null || atlsStatus === "idle") {
    return { label: "", status: "none" as const }
  }

  // aTLS connected and no error → secure
  if (atlsStatus === "connected" && !hasError) {
    return { label: "🔐 Secure Model ", status: "secure" as const }
  }

  // aTLS error or message error → insecure
  return { label: "⚠ Insecure ", status: "error" as const }
}
