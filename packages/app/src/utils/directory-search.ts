/**
 * Utilities for directory search functionality.
 * Used by DialogSelectDirectory to combine known projects with search results.
 */

/**
 * Joins a base path with a relative path, handling slashes.
 */
export function joinPath(base: string | undefined, rel: string): string {
  const b = (base ?? "").replace(/[\\/]+$/, "")
  const r = rel.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
  if (!b) return r
  if (!r) return b
  return b + "/" + r
}

/**
 * Converts an absolute path to a display path with ~ for home.
 */
export function displayPath(full: string, home: string | undefined): string {
  if (!home) return full
  if (full === home) return "~"
  if (full.startsWith(home + "/") || full.startsWith(home + "\\")) {
    return "~" + full.slice(home.length)
  }
  return full
}

/**
 * Normalizes a search query, handling ~ prefix and home directory prefix.
 */
export function normalizeQuery(query: string, home: string | undefined): string {
  if (!query) return query
  if (query.startsWith("~/")) return query.slice(2)

  if (home) {
    const lc = query.toLowerCase()
    const hc = home.toLowerCase()
    if (lc === hc || lc.startsWith(hc + "/") || lc.startsWith(hc + "\\")) {
      return query.slice(home.length).replace(/^[\\/]+/, "")
    }
  }

  return query
}

/**
 * Converts absolute project paths to relative paths from home.
 */
export function projectsToRelative(projects: { worktree?: string }[], home: string | undefined): string[] {
  return projects
    .map((p) => p.worktree)
    .filter((w): w is string => !!w)
    .map((w) => {
      if (home && (w.startsWith(home + "/") || w.startsWith(home + "\\"))) {
        return w.slice(home.length + 1)
      }
      return w
    })
}

/**
 * Filters projects by a search query (case-insensitive partial match).
 */
export function filterProjects(projects: string[], query: string): string[] {
  if (!query) return projects
  const lowerQuery = query.toLowerCase()
  return projects.filter((p) => p.toLowerCase().includes(lowerQuery))
}

/**
 * Combines known projects with search results, deduplicating and prioritizing projects.
 */
export function combineResults(projects: string[], searchResults: string[], limit: number = 50): string[] {
  const combined = [...projects]
  for (const dir of searchResults) {
    if (!combined.includes(dir)) {
      combined.push(dir)
    }
  }
  return combined.slice(0, limit)
}
