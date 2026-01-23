import { DEFAULT_SERVER_URL } from "./constants"

/**
 * Get OpenCode server URL for browser mode.
 *
 * Priority:
 * 1. VITE_OPENCODE_SERVER_URL environment variable
 * 2. Default port (4096)
 *
 * Does NOT auto-discover or scan ports.
 * If the server is running on a different port, use VITE_OPENCODE_SERVER_URL.
 */
export function getServerUrl(): string {
  // Check environment variable
  const envUrl = import.meta.env.VITE_OPENCODE_SERVER_URL
  if (envUrl) {
    console.log(`[OpenCode] Using server URL from env: ${envUrl}`)
    return envUrl
  }

  // Use default
  console.log(`[OpenCode] Using default server URL: ${DEFAULT_SERVER_URL}`)
  return DEFAULT_SERVER_URL
}
