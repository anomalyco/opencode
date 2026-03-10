import path from "path"
import os from "os"

const home = os.homedir()

// macOS directories that trigger TCC (Transparency, Consent, and Control)
// permission prompts when accessed by a non-sandboxed process.
const DARWIN_NAMES = [
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

const WIN32_NAMES = ["AppData", "Downloads", "Desktop", "Documents", "Pictures", "Music", "Videos", "OneDrive"]

export namespace Protected {
  /** Directory basenames to skip when scanning the home directory. */
  export function names(): ReadonlySet<string> {
    if (process.platform === "darwin") return new Set(DARWIN_NAMES)
    if (process.platform === "win32") return new Set(WIN32_NAMES)
    return new Set()
  }

  /** Absolute paths that should never be watched, stated, or scanned. */
  export function paths(): string[] {
    if (process.platform === "darwin")
      return [
        ...DARWIN_NAMES.map((n) => path.join(home, n)),
        ...DARWIN_LIBRARY.map((n) => path.join(home, "Library", n)),
        ...DARWIN_ROOT,
      ]
    if (process.platform === "win32") return WIN32_NAMES.map((n) => path.join(home, n))
    return []
  }

  /** Returns true if `target` is inside (or equal to) any protected path. */
  export function contains(target: string): boolean {
    const resolved = path.resolve(target)
    for (const p of paths()) {
      if (resolved === p || resolved.startsWith(p + path.sep)) return true
    }
    return false
  }
}
