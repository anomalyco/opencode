import { realpath, stat } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { fileURLWithin } from "./policy"

/** Resolve again at each authority boundary. A path checked when displayed may no longer name the same file. */
export async function workspaceFile(file: string, roots: readonly string[]) {
  if (!fileURLWithin(file, roots)) return

  try {
    const [target, directories] = await Promise.all([realpath(fileURLToPath(file)), Promise.all(roots.map((root) => realpath(root)))])
    const href = pathToFileURL(target).href

    // Exact filesystem spelling matters even on Windows: individual NTFS directories can be case sensitive.
    if (!directories.some((root) => href.startsWith(`${pathToFileURL(root).href.replace(/\/$/, "")}/`))) return
    const info = await stat(target)

    // Hard links are regular workspace entries (also used by package managers); do not reject by link count.
    return info.isFile() ? { path: target, href, size: info.size } : undefined
  } catch {
    // Missing, unreadable, malformed or replaced between lookups: no file grant.
    return undefined
  }
}
