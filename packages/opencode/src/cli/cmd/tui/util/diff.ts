/**
 * Diff utility functions for TUI display
 */

/**
 * Parse unified diff format to extract line statistics
 * @param diff - Unified diff string
 * @returns Object with added and removed line counts
 * @example
 * parseDiffStats(`
 *   --- a/file.ts
 *   +++ b/file.ts
 *   @@ -1,3 +1,5 @@
 *    const x = 1
 *   +const y = 2
 *   +const z = 3
 * `)
 * // Returns: { added: 2, removed: 0 }
 */
export function parseDiffStats(diff: string): { added: number; removed: number } {
  const lines = diff.split("\n")
  let added = 0
  let removed = 0

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++
    else if (line.startsWith("-") && !line.startsWith("---")) removed++
  }

  return { added, removed }
}

/**
 * Format diff statistics for display
 * @param stats - Object with added and removed line counts
 * @returns Formatted string like "+5 lines" or "+5, -3 lines"
 * @example
 * formatDiffStats({ added: 5, removed: 3 }) // "+5, -3 lines"
 * formatDiffStats({ added: 0, removed: 3 }) // "-3 lines"
 */
export function formatDiffStats(stats: { added: number; removed: number }): string {
  const parts: string[] = []
  if (stats.added > 0) parts.push(`+${stats.added}`)
  if (stats.removed > 0) parts.push(`-${stats.removed}`)

  if (parts.length === 0) return "0 lines"
  return parts.join(", ") + " lines"
}
