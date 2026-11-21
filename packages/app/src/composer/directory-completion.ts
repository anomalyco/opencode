import { pickerAbsolutePath, pickerRoot } from "@/workspaces/selection/domain"

// The TUI's `/cd` completion (`packages/tui/src/prompt/directory-completion.ts`) on browser-safe paths: list the
// directory the typed path is in, and keep the path as typed (`~/`, `/`, `../` or relative to the session).
export function directoryCompletionSearch(query: string, directory: string, home: string) {
  if (query === "~") return { directory: home, prefix: "~/", query: "" }

  if (query.startsWith("~/")) return scoped(query.slice(2), home, "~/")

  if (/^(?:\.\.\/)*\.\.$/.test(query))
    return { directory: pickerAbsolutePath(query, directory), prefix: query + "/", query: "" }

  if (query.startsWith("/")) return scoped(query.slice(1), pickerRoot(directory) || "/", "/")

  return scoped(query, directory, "")
}

export type DirectoryCompletionSearch = ReturnType<typeof directoryCompletionSearch>

/** The typed path itself, listed first when it names a directory with nothing left to match (`~`, `..`). */
export function directoryCompletionExact(value: string, search: DirectoryCompletionSearch) {
  if (!value || !search.prefix || search.query) return

  return value
}

/** Prefix match on the name; hidden directories wait for a typed `.`. */
export function directoryCompletionMatches(name: string, query: string) {
  if (!query && name.startsWith(".")) return false

  return name.toLowerCase().startsWith(query.toLowerCase())
}

function scoped(query: string, root: string, prefix: string) {
  const separator = query.lastIndexOf("/")

  if (separator === -1) return { directory: root, prefix, query }
  const parent = query.slice(0, separator + 1)

  return { directory: pickerAbsolutePath(parent, root), prefix: prefix + parent, query: query.slice(separator + 1) }
}
