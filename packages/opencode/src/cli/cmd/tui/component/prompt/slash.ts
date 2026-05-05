export function getLocalSlashCommand(input: string, hasSlash: (name: string) => boolean) {
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return
  if (trimmed.includes(" ") || trimmed.includes("\n")) return

  const name = trimmed.slice(1)
  if (!name) return

  return hasSlash(name) ? name : undefined
}