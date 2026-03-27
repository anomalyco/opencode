import path from "path"

export function safePath(base: string, userInput: string): string | null {
  const clean = userInput.replace(/\0/g, "")
  const resolvedBase = path.resolve(base)
  const joined = path.resolve(base, clean)
  if (!joined.startsWith(resolvedBase + path.sep) && joined !== resolvedBase) {
    return null
  }
  return joined
}
