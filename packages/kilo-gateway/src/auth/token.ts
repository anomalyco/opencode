/**
 * Parse KiloCode URL from token
 * Some tokens contain encoded base URL information
 */
export function getKiloUrlFromToken(defaultUrl: string, token: string): string {
  // If token contains URL information, extract it
  // This is a simplified version - adjust based on actual token format
  if (!token) return defaultUrl

  try {
    // Check if token has URL prefix (format: "url:base64token")
    const parts = token.split(":")
    if (parts.length > 1 && parts[0].startsWith("http")) {
      return parts[0]
    }
  } catch (e) {
    // If parsing fails, return default
  }

  return defaultUrl
}

/**
 * Validate KiloCode token format
 */
export function isValidKilocodeToken(token: string): boolean {
  if (!token || typeof token !== "string") return false

  // Basic validation - adjust based on actual token requirements
  return token.length > 10
}

/**
 * Get API key from options or environment
 */
export function getApiKey(options: { kilocodeToken?: string; apiKey?: string }): string | undefined {
  return options.kilocodeToken ?? options.apiKey
}
