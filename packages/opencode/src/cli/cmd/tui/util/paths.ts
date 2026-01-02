import path from "path"

export function normalizePathFromDirectory(input: string | undefined, directory: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(directory, input) || "."
  }
  return input
}
