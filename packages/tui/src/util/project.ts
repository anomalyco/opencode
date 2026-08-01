import path from "path"

export function projectName(project?: { canonical: string; name?: string }, fallback = "") {
  const canonical = project?.canonical ?? fallback
  if (canonical === "/") return fallback ? path.basename(fallback) : undefined
  return project?.name || path.basename(canonical)
}
