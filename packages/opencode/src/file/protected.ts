import path from "path"
import os from "os"
import { Filesystem } from "@/util"

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

/** Directory basenames to skip when scanning the home directory. */
export function names(): ReadonlySet<string> {
  if (process.platform === "darwin") return new Set(DARWIN_HOME)
  if (process.platform === "win32") return new Set(WIN32_HOME)
  return new Set()
}

/** Absolute paths that should never be watched, stated, or scanned. */
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

export function workspace() {
  return [".git", ".opencode"]
}

function uniq(input: string[]) {
  return [...new Set(input.filter(Boolean))].toSorted((a, b) => a.localeCompare(b))
}

async function gitdir(file: string) {
  const text = await Filesystem.readText(file).catch(() => "")
  const match = /^\s*gitdir:\s*(.+)\s*$/m.exec(text)
  if (!match?.[1]) return
  return path.resolve(path.dirname(file), match[1])
}

export async function resolve(root: string, input = workspace()) {
  const out: string[] = []
  for (const item of input) {
    const next = path.isAbsolute(item) ? path.normalize(item) : path.resolve(root, item)
    out.push(next)
    if (path.basename(next) !== ".git") continue
    const stat = Filesystem.stat(next)
    if (!stat?.isFile()) continue
    const dir = await gitdir(next)
    if (dir) out.push(dir)
  }
  return uniq(out)
}

export * as Protected from "./protected"
