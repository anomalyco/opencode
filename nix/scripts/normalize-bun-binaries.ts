import { lstat, mkdir, readdir, rm, symlink } from "fs/promises"
import { join, relative } from "path"

type PackageManifest = {
  name?: string
  bin?: string | Record<string, string>
}

const root = process.cwd()
const bunRoot = join(root, "node_modules/.bun")
const bunEntries = (await safeReadDir(bunRoot)).sort()
let rewritten = 0

for (const entry of bunEntries) {
  const modulesRoot = join(bunRoot, entry, "node_modules")
  if (!(await exists(modulesRoot))) {
    continue
  }
  const binRoot = join(modulesRoot, ".bin")
  await rm(binRoot, { recursive: true, force: true })
  await mkdir(binRoot, { recursive: true })

  const packageDirs = await collectPackages(modulesRoot)
  for (const packageDir of packageDirs) {
    const manifest = await readManifest(packageDir)
    if (!manifest) {
      continue
    }
    const binField = manifest.bin
    if (!binField) {
      continue
    }
    const seen = new Set<string>()
    if (typeof binField === "string") {
      const fallback = manifest.name ?? packageDir.split("/").pop()
      if (fallback) {
        await linkBinary(binRoot, fallback, packageDir, binField, seen)
      }
    } else {
      const entries = Object.entries(binField).sort((a, b) => a[0].localeCompare(b[0]))
      for (const [name, target] of entries) {
        await linkBinary(binRoot, name, packageDir, target, seen)
      }
    }
  }
}

console.log(`[normalize-bun-binaries] rewrote ${rewritten} links`)

async function collectPackages(modulesRoot: string) {
  const found: string[] = []
  const topLevel = (await safeReadDir(modulesRoot)).sort()
  for (const name of topLevel) {
    if (name === ".bin" || name === ".bun") {
      continue
    }
    const full = join(modulesRoot, name)
    if (!(await isDirectory(full))) {
      continue
    }
    if (name.startsWith("@")) {
      const scoped = (await safeReadDir(full)).sort()
      for (const child of scoped) {
        const scopedDir = join(full, child)
        if (await isDirectory(scopedDir)) {
          found.push(scopedDir)
        }
      }
      continue
    }
    found.push(full)
  }
  return found.sort()
}

async function readManifest(dir: string) {
  const file = Bun.file(join(dir, "package.json"))
  if (!(await file.exists())) {
    return null
  }
  const data = (await file.json()) as PackageManifest
  return data
}

async function linkBinary(binRoot: string, name: string, packageDir: string, target: string, seen: Set<string>) {
  if (!name || !target) {
    return
  }
  const normalizedName = normalizeBinName(name)
  if (seen.has(normalizedName)) {
    return
  }
  const resolved = join(packageDir, target)
  const script = Bun.file(resolved)
  if (!(await script.exists())) {
    return
  }
  seen.add(normalizedName)
  const destination = join(binRoot, normalizedName)
  const relativeTarget = relative(binRoot, resolved) || "."
  await rm(destination, { force: true })
  await symlink(relativeTarget, destination)
  rewritten++
}

async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string) {
  try {
    const info = await lstat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function safeReadDir(path: string) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

function normalizeBinName(name: string) {
  const slash = name.lastIndexOf("/")
  if (slash >= 0) {
    return name.slice(slash + 1)
  }
  return name
}
