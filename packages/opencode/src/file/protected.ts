import path from "path"
import os from "os"

const home = os.homedir()

// macOS directories that trigger TCC (Transparency, Consent, and Control)
// permission prompts when accessed by a non-sandboxed process.
const DARWIN_HOME = [
  // Media
  "Music",
  "Pictures",
  "Movies",
  // User-managed folders synced via iCloud / subject to TCC
  "Downloads",
  "Desktop",
  "Documents",
  // Other system-managed
  "Public",
  "Applications",
  "Library",
]

const DARWIN_LIBRARY = [
  "Application Support/AddressBook",
  "Calendars",
  "Mail",
  "Messages",
  "Safari",
  "Cookies",
  "Application Support/com.apple.TCC",
  "PersonalizationPortrait",
  "Metadata/CoreSpotlight",
  "Suggestions",
]

const DARWIN_ROOT = ["/.DocumentRevisions-V100", "/.Spotlight-V100", "/.Trashes", "/.fseventsd"]

const WIN32_HOME = ["AppData", "Downloads", "Desktop", "Documents", "Pictures", "Music", "Videos", "OneDrive"]

/**
 * Protected directory utilities for platform-specific sensitive paths.
 *
 * Provides functions to identify directories that should be excluded from
 * file watching, scanning, and other operations due to privacy concerns
 * or system restrictions (TCC on macOS).
 *
 * @example
 * ```typescript
 * const names = Protected.names() // Set of protected directory names
 * const paths = Protected.paths() // Array of absolute protected paths
 * ```
 */
export namespace Protected {
  /**
   * Returns a set of directory basenames to skip when scanning the home directory.
   *
   * Platform-specific: returns macOS protected directories on Darwin,
   * Windows home directories on Win32, or empty set on other platforms.
   *
   * @returns Readonly set of protected directory names
   */
  export function names(): ReadonlySet<string> {
    if (process.platform === "darwin") return new Set(DARWIN_HOME)
    if (process.platform === "win32") return new Set(WIN32_HOME)
    return new Set()
  }

  /**
   * Returns absolute paths that should never be watched, stated, or scanned.
   *
   * These paths include system directories and user data folders that trigger
   * permission prompts (TCC on macOS) or contain sensitive information.
   *
   * @returns Array of absolute paths to protected directories
   */
  export function paths(): string[] {
    if (process.platform === "darwin")
      return [
        ...DARWIN_HOME.map((n) => path.join(home, n)),
        ...DARWIN_LIBRARY.map((n) => path.join(home, "Library", n)),
        ...DARWIN_ROOT,
      ]
    if (process.platform === "win32") return WIN32_HOME.map((n) => path.join(home, n))
    return []
  }
}
