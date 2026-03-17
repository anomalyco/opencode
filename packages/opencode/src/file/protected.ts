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
 * Protected directory utilities for privacy and security.
 *
 * Identifies system directories that should be excluded from file operations
 * to avoid triggering permission prompts (TCC on macOS) or accessing
 * sensitive user data.
 *
 * @example
 * ```typescript
 * const protectedNames = Protected.names()
 * const protectedPaths = Protected.paths()
 * ```
 */
export namespace Protected {
  /**
   * Returns directory basenames to skip when scanning the home directory.
   *
   * On macOS, returns directories like Music, Pictures, Downloads that trigger
   * TCC permission prompts. On Windows, returns common user directories.
   *
   * @returns A read-only set of directory names to skip
   */
  export function names(): ReadonlySet<string> {
    if (process.platform === "darwin") return new Set(DARWIN_HOME)
    if (process.platform === "win32") return new Set(WIN32_HOME)
    return new Set()
  }

  /**
   * Returns absolute paths that should never be watched, stated, or scanned.
   *
   * Includes sensitive system directories and user data folders that require
   * special permissions or contain private information.
   *
   * @returns An array of absolute paths to exclude from file operations
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
