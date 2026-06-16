import path from "path"

/**
 * fff's home/root scanning walks UP from `basePath` toward `$HOME` and the
 * filesystem root to pull surrounding files into the index. That is useful
 * from inside a project, but when the working directory already is `$HOME`
 * (or an ancestor of it, or the filesystem root) the walk degenerates into a
 * full-tree content index of the entire home directory and pegs the CPU
 * (see #32511). Skip the upward scan for those degenerate roots.
 */
export function shouldScanUpward(directory: string, home: string): boolean {
  const dir = path.resolve(directory)
  const resolvedHome = path.resolve(home)
  if (dir === path.parse(dir).root) return false
  if (dir === resolvedHome) return false
  const withSep = dir.endsWith(path.sep) ? dir : dir + path.sep
  if (resolvedHome.startsWith(withSep)) return false
  return true
}
