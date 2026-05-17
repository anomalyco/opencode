import { AppFileSystem } from "@opencode-ai/core/filesystem"

export function directoryVariants(input: string | undefined) {
  if (!input) return []
  const values = new Set<string>()
  values.add(input)

  const resolved = resolveDirectory(input)
  values.add(resolved)

  if (process.platform !== "win32") return [...values]

  values.add(input.replaceAll("\\", "/"))
  values.add(resolved.replaceAll("\\", "/"))
  return [...values]
}

export function sameDirectory(a: string | undefined, b: string | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  const values = new Set(directoryVariants(a))
  return directoryVariants(b).some((value) => values.has(value))
}

function resolveDirectory(input: string) {
  try {
    return AppFileSystem.resolve(input)
  } catch {
    return input
  }
}
