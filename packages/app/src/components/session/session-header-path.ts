export function resolveOpenPathTarget(input: { projectDirectory: string; selectedFilePath?: string }) {
  if (!input.projectDirectory) return ""

  const selected = input.selectedFilePath?.trim()
  if (!selected) return input.projectDirectory
  if (selected.startsWith("/") || selected.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(selected)) return selected

  const root = input.projectDirectory.replace(/[\\/]+$/, "")
  const child = selected.replace(/^[\\/]+/, "")
  if (!root) return `/${child}`
  return `${root}/${child}`
}
