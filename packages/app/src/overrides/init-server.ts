/**
 * Initialize default server URL in localStorage
 */

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"
const DEFAULT_SERVER_URL = "https://vibe.laterdev.com/opencode-api"

export function initDefaultServer() {
  if (typeof localStorage === "undefined") return

  try {
    // Only set if not already configured
    const existing = localStorage.getItem(DEFAULT_SERVER_URL_KEY)
    if (!existing) {
      localStorage.setItem(DEFAULT_SERVER_URL_KEY, DEFAULT_SERVER_URL)
      console.log(`[init-server] Set default server to: ${DEFAULT_SERVER_URL}`)
    } else {
      console.log(`[init-server] Default server already set to: ${existing}`)
    }
  } catch (error) {
    console.error("[init-server] Failed to set default server:", error)
  }
}
