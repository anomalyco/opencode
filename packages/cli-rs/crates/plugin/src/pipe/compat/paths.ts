// What the JS host compares a plugin's files by (carbon recheck-3): a real path, and containment by `path.relative`,
// as TS's `FSUtil.contains` decides it. On Windows `realpathSync.native` gives the long names (no 8.3 `RUNNER~1`) and
// the volume's own case, without the `\\?\` prefix a verbatim path has, and `path.win32.relative` ignores case, so a
// drive letter's case, a short name or a verbatim prefix on either side no longer reads as outside.
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
