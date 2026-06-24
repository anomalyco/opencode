/**
 * Tools that are always safe and never reach the classifier — read-only or
 * metadata-only. Mirrors Claude Code's safe-tool allowlist.
 *
 * NOTE: ids must match ToolRegistry tool ids. Unknown-but-safe tools simply
 * fall through to the classifier (fail-safe direction).
 */
const SAFE_TOOLS = new Set<string>([
  // read-only file / search
  "read",
  "grep",
  "glob",
  "list",
  "lsp",
  // network read-only
  "websearch",
  // task/plan metadata
  "todoread",
  "todowrite",
  "todo",
])

export function isSafeAllowlisted(tool: string): boolean {
  return SAFE_TOOLS.has(tool)
}
