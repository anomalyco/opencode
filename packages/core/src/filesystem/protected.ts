import os from "os"
import path from "path"

const home = os.homedir()

// path.relative compares case-insensitively on Windows, where `c:\Users\Name` is the same home.
export function isHome(directory: string) {
  return path.relative(home, directory) === ""
}

const DARWIN_HOME = [
  "Music",
  "Pictures",
  "Movies",
  "Downloads",
  "Desktop",
  "Documents",
  "Public",
  "Applications",
  "Library",
]

const WIN32_HOME = ["AppData", "Downloads", "Desktop", "Documents", "Pictures", "Music", "Videos", "OneDrive"]

/** Directory basenames to skip when scanning the home directory. */
export function names(): ReadonlySet<string> {
  if (process.platform === "darwin") return new Set(DARWIN_HOME)
  if (process.platform === "win32") return new Set(WIN32_HOME)
  return new Set()
}

export * as Protected from "./protected.js"
