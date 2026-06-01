import { lstat, mkdir, readdir, rm, symlink } from "fs/promises"
import { join, relative } from "path"

type Entry = {
  dir: string
  version: string
}

async function isDirectory(path: string) {
  try {
    const info = await lstat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

const isValidSemver = (v: string) => Bun.semver.satisfies(v, "x.x.x")

const root = process.cwd()
const bunRoot = join(root, "node_modules/.bun")
const linkRoot = join(bunRoot, "node_modules")
const directories = (await readdir(bunRoot)).sort()

const versions = new Map<string, Entry[]>()

for (const entry of directories) {
  const full = join(bunRoot, entry)
  if (!(await isDirectory(full))) {
    continue
  }
  const parsed = parseEntry(entry)
  if (!parsed) {
    continue
  }
  const list = versions.get(parsed.name) ?? []
  list.push({ dir: full, version: parsed.version })
  versions.set(parsed.name, list)
}

const selections = new Map<string, Entry>()

for (const [slug, list] of versions) {
  list.sort((a, b) => {
    const aValid = isValidSemver(a.version)
    const bValid = isValidSemver(b.version)
    if (aValid && bValid) return -Bun.semver.order(a.version, b.version)
    if (aValid) return -1
    if (bValid) return 1
    return b.version.localeCompare(a.version)
  })
  const first = list[0]
  if (first) selections.set(slug, first)
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
  if (!(await isDirectory(desired))) {
    continue
  }
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

function parseEntry(label: string) {
  const marker = label.startsWith("@") ? label.indexOf("@", 1) : label.indexOf("@")
  if (marker <= 0) {
    return null
  }
  const name = label.slice(0, marker).replace(/\+/g, "/")
  const version = label.slice(marker + 1)
  if (!name || !version) {
    return null
  }
  return { name, version }
}
