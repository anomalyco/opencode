import path from "node:path"

export function configDirectories(config: string, cwd: string) {
  const directories: string[] = []
  for (let current = path.resolve(cwd); ; current = path.dirname(current)) {
    directories.push(path.join(current, ".opencode"))
    if (path.dirname(current) === current) break
  }
  return [...new Set([config, ...directories.reverse()])]
}
