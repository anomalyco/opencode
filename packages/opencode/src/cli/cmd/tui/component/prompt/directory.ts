import path from "path"

function relative(target: string, cwd: string) {
  const home = process.env.HOME
  if (home && target.startsWith(home + path.sep)) return "~/" + path.relative(home, target)
  if (home && target === home) return "~"
  const result = path.relative(cwd, target)
  if (!result) return target
  return result
}

function absoluteInput(input: string) {
  const query = input.trim()
  if (!query) return false
  if (query === "~") return false
  if (query.startsWith("~/") || query.startsWith("~\\")) return false
  return path.isAbsolute(query)
}

export function directoryPath(target: string, cwd: string, query: string) {
  if (absoluteInput(query)) return path.normalize(target)
  return relative(target, cwd)
}
