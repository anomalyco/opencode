import path from "path"

export function projectName(project?: { canonical: string; name?: string }, fallback = "") {
  const canonical = project?.canonical ?? fallback
  const paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(canonical) ? path.win32 : path.posix
  if (paths.parse(canonical).root === canonical) return fallback ? paths.basename(fallback) : undefined
  return project?.name || paths.basename(canonical)
}
