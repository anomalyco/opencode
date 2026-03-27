import path from "path"

export function safePath(base: string, userInput: string): string | null {
  if (userInput.includes("\0")) return null
  const resolvedBase = path.resolve(base)
  const joined = path.resolve(base, userInput)
  if (!joined.startsWith(resolvedBase + path.sep) && joined !== resolvedBase) {
    return null
  }
  return joined
}
