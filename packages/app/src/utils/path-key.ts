// Project identity key. Two worktrees are the same project only when their
// pathKeys match: the full normalized path, never the basename. This keeps
// same-name folders on different drives (c:/foo vs d:/foo) distinct while
// collapsing slash and trailing-slash variants (c:\foo vs c:/foo/).
//
// Normalization:
// - Windows drive and UNC paths have backslashes rewritten to forward slashes.
// - Trailing slashes are trimmed, except POSIX "/" and drive roots ("C:/"),
//   which keep one trailing slash so a root never collapses to "" or "C:".
// - Case is preserved; case-insensitive drive matching lives with callers
//   such as treePathWithin, not here.
export type PathKey = string & { _brand: "PathKey" }

const isDrive = (value: string) => {
  if (value.length !== 2) return false
  const code = value.charCodeAt(0)
  return value[1] === ":" && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
}

const trimTrailingSlashes = (value: string) => {
  for (let i = value.length - 1; i >= 0; i--) {
    if (value[i] !== "/") return value.slice(0, i + 1)
  }
  return ""
}

const isWindowsPath = (value: string) => value[1] === ":" || value.startsWith("\\\\")

// Compare with `pathKey(a) === pathKey(b)`. The stored `worktree` string keeps
// its original separators for display; only the comparison is normalized.
export const pathKey = (path: string) => {
  const value = isWindowsPath(path) ? path.replaceAll("\\", "/") : path
  const trimmed = trimTrailingSlashes(value)
  if (!trimmed && value.startsWith("/")) return "/" as PathKey
  if (isDrive(trimmed)) return `${trimmed}/` as PathKey
  return trimmed as PathKey
}
