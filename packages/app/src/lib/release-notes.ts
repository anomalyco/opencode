import { CURRENT_RELEASE } from "@/components/dialog-release-notes"

const STORAGE_KEY = "opencode:last-seen-version"

// ============================================================================
// DEV MODE: Set this to true to always show the release notes modal on startup
// Set to false for production behavior (only shows after updates)
// ============================================================================
const DEV_ALWAYS_SHOW_RELEASE_NOTES = true

/**
 * Check if release notes should be shown
 * Returns true if:
 * - DEV_ALWAYS_SHOW_RELEASE_NOTES is true (for development)
 * - OR the current version is newer than the last seen version
 */
export function shouldShowReleaseNotes(): boolean {
  if (DEV_ALWAYS_SHOW_RELEASE_NOTES) {
    console.log("[ReleaseNotes] DEV mode: always showing release notes")
    return true
  }

  const lastSeen = localStorage.getItem(STORAGE_KEY)
  if (!lastSeen) {
    // First time user - show release notes
    return true
  }

  // Compare versions - show if current is newer
  return CURRENT_RELEASE.version !== lastSeen
}

/**
 * Mark the current release notes as seen
 * Call this when the user closes the release notes modal
 */
export function markReleaseNotesSeen(): void {
  localStorage.setItem(STORAGE_KEY, CURRENT_RELEASE.version)
}

/**
 * Get the current version
 */
export function getCurrentVersion(): string {
  return CURRENT_RELEASE.version
}

/**
 * Reset the seen status (useful for testing)
 */
export function resetReleaseNotesSeen(): void {
  localStorage.removeItem(STORAGE_KEY)
}
