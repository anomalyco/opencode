// Compare canonical paths for containment. On Windows, account for verbatim prefixes, short names and case-
// insensitive drive letters.
import nodePath from "node:path"
import { realpathSync } from "node:fs"

type PathModule = typeof nodePath

/** The real path of `file`, without a verbatim prefix; `file` resolved as it is where it cannot be read. */
export function real(file: string, platform: PathModule = nodePath) {
  const plain = stripVerbatim(file, platform)
  try {
    return stripVerbatim(realpathSync.native(plain), platform)
  } catch {
    return platform.resolve(plain)
  }
}

/** `\\?\C:\x` as `C:\x`, `\\?\UNC\server\share` as `\\server\share`; any other path as it is. */
export function stripVerbatim(file: string, platform: PathModule = nodePath) {
  if (platform.sep !== "\\") return file
  if (/^\\\\\?\\UNC\\/i.test(file)) return `\\\\${file.slice(8)}`
  if (/^\\\\\?\\[a-z]:/i.test(file)) return file.slice(4)
  return file
}

/** Whether `child` is `root` or inside it. Both should be real paths. */
export function inside(root: string, child: string, platform: PathModule = nodePath) {
  const relative = platform.relative(stripVerbatim(root, platform), stripVerbatim(child, platform))
  return (
    relative === "" ||
    (!platform.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${platform.sep}`))
  )
}
