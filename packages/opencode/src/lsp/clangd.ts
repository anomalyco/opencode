import fs from "fs/promises"
import path from "path"

async function pathExists(p: string): Promise<boolean> {
  try {
    const stats = await fs.stat(p)
    return stats.isFile()
  } catch {
    return false
  }
}

async function findCMakeBuildDirs(root: string): Promise<string[]> {
  const dirs: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    if (await pathExists(path.join(dir, "CMakeCache.txt"))) {
      dirs.push(dir)
    }
  }
  return dirs
}

export async function findCompileCommandsDir(root: string): Promise<string | undefined> {
  const cmakeDirs = await findCMakeBuildDirs(root)
  for (const dir of cmakeDirs) {
    if (await pathExists(path.join(dir, "compile_commands.json"))) {
      return dir
    }
  }

  if (await pathExists(path.join(root, "compile_commands.json"))) {
    return root
  }

  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(root, entry.name, "compile_commands.json")
    if (await pathExists(candidate)) {
      return path.join(root, entry.name)
    }
  }

  return undefined
}
