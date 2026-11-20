import { realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { Global } from "@opencode/util/global"

/** OpenCode's temp directory, canonical name first, so a symlinked temp path (macOS's /var is /private/var) matches. */
export async function tempRoots(tmp = Global.Path.tmp): Promise<readonly string[]> {
  const canonical = await realpath(tmp).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") return undefined
    const parent = await realpath(dirname(tmp)).catch(() => undefined)
    return parent ? join(parent, basename(tmp)) : undefined
  })
  return canonical && canonical !== tmp ? [canonical, tmp] : [canonical ?? tmp]
}

/** Both the name and its resolved target must be within the same workspace. Compare physical names exactly,
 * even on Windows: individual NTFS directories can be case sensitive. */
export async function workspaceTarget(file: string, roots: readonly string[]) {
  const candidates = roots.filter((root) => {
    const child = relative(root, file)
    return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)
  })
  if (!candidates.length) return
  const [target, directories] = await Promise.all([realpath(file), Promise.all(candidates.map((root) => realpath(root)))])
  const href = pathToFileURL(target).href
  return directories.some((root) => {
    const base = pathToFileURL(root).href
    return href === base || href.startsWith(`${base.replace(/\/$/, "")}/`)
  }) ? target : undefined
}
