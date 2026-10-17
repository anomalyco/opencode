import path from "node:path"
import { stat } from "node:fs/promises"

// Lowest priority first at each level, matching core config discovery.
const projectRoots = [path.join(".agents", "opencode"), ".opencode"]

export function configDirectories(config: string, cwd: string) {
  return [...new Set([config, ...ancestors(cwd).flatMap(projectRootsIn)])]
}

export function projectConfigDirectories(project: string, cwd: string) {
  const directories = ancestors(cwd)
  return directories.slice(directories.indexOf(path.resolve(project))).flatMap(projectRootsIn)
}

function projectRootsIn(directory: string) {
  return projectRoots.map((root) => path.join(directory, root))
}

export async function localProjectDirectory(cwd: string) {
  const directories = ancestors(cwd)
  const repositories = await Promise.all(
    directories.map((directory) =>
      Promise.all(
        [".git", ".hg"].map((name) =>
          stat(path.join(directory, name)).then(
            () => true,
            (error) => (isMissingPath(error) ? false : Promise.reject(error)),
          ),
        ),
      ).then((matches) => matches.some(Boolean)),
    ),
  )
  return directories.findLast((_, index) => repositories[index]) ?? path.resolve(cwd)
}

export function isMissingPath(error: unknown) {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? error.code : undefined
  return code === "ENOENT" || code === "ENOTDIR"
}

function ancestors(cwd: string) {
  const directories: string[] = []
  for (let current = path.resolve(cwd); ; current = path.dirname(current)) {
    directories.push(current)
    if (path.dirname(current) === current) break
  }
  return directories.reverse()
}
