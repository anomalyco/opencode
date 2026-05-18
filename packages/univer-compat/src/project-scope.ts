/** Paths that authenticate but do not read/write project-scoped Univer blob state. */
export function isUniverCompatProjectOptionalPath(path: string): boolean {
  if (path === "/universer-api/user/session-ticket") return true
  if (path.startsWith("/universer-api/authz/")) return true
  if (path.startsWith("/universer-api/license/")) return true
  if (path === "/universer-api/comb/connect") return true
  return false
}
