import { lstat, mkdir, readdir, rm, symlink } from "fs/promises"
import { join, relative } from "path"

type SemverLike = {
  valid: (value: string) => string | null
  rcompare: (left: string, right: string) => number
}

type Entry = {
  dir: string
  version: string
  label: string
}

const root = process.cwd()
const bunRoot = join(root, "node_modules/.bun")
const linkRoot = join(bunRoot, "node_modules")
const directories = (await readdir(bunRoot)).sort()
const versions = new Map<string, Entry[]>()

for (const entry of directories) {
  const full = join(bunRoot, entry)
  const info = await lstat(full)
  if (!info.isDirectory()) {
    continue
  }
  const marker = entry.lastIndexOf("@")
  if (marker <= 0) {
    continue
  }
  const slug = entry.slice(0, marker).replace(/\+/g, "/")
  const version = entry.slice(marker + 1)
  const list = versions.get(slug) ?? []
  list.push({ dir: full, version, label: entry })
  versions.set(slug, list)
}

const semverModule = (await import(join(bunRoot, "node_modules/semver"))) as
  | SemverLike
  | {
      default: SemverLike
    }
const semver = "default" in semverModule ? semverModule.default : semverModule
const selections = new Map<string, Entry>()

for (const [slug, list] of versions) {
  list.sort((a, b) => {
    const left = semver.valid(a.version)
    const right = semver.valid(b.version)
    if (left && right) {
      const delta = semver.rcompare(left, right)
      if (delta !== 0) {
        return delta
      }
    }
    if (left && !right) {
      return -1
    }
    if (!left && right) {
      return 1
    }
    return b.version.localeCompare(a.version)
  })
  selections.set(slug, list[0])
}

await rm(linkRoot, { recursive: true, force: true })
await mkdir(linkRoot, { recursive: true })

const rewrites: string[] = []

for (const [slug, entry] of Array.from(selections.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
  const parts = slug.split("/")
  const leaf = parts.pop()
  if (!leaf) {
    continue
  }
  const parent = join(linkRoot, ...parts)
  await mkdir(parent, { recursive: true })
  const linkPath = join(parent, leaf)
  const desired = join(entry.dir, "node_modules", slug)
  const relativeTarget = relative(parent, desired)
  const resolved = relativeTarget.length === 0 ? "." : relativeTarget
  await rm(linkPath, { recursive: true, force: true })
  await symlink(resolved, linkPath)
  rewrites.push(slug + " -> " + resolved)
}

rewrites.sort()
console.log("[canonicalize-node-modules] rebuilt", rewrites.length, "links")
for (const line of rewrites.slice(0, 20)) {
  console.log("  ", line)
}
if (rewrites.length > 20) {
  console.log("  ...")
}
