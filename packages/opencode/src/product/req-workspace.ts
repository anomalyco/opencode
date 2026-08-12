import { readdir } from "fs/promises"
import path from "path"

export const JD_STUB = `# <role title>

- Team: <team or TBD>
- Level: TBD
- Location: TBD

## Must-haves
- TBD

## Nice-to-haves
- TBD
`

export const SCORECARD_STUB = `# Scorecard — <role title>

| Dimension | Bar | Notes |
|-----------|-----|-------|
| TBD | 1–5 | |
`

export const NOTES_STUB = `# Process notes

- Owners: TBD
- Open questions:
  - TBD
`

export const MATERIAL_NAMES = ["jd.md", "scorecard.md", "notes.md"] as const
export const BOOK = path.join(".moks", "reqs")
export const LEGACY = path.join(".moks", "req")

export type Listed = {
  slug: string
  path: string
  relative: string
  legacy?: true
}

export function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")
}

export function dir(slug: string) {
  return path.join(BOOK, slug)
}

export function isBookReq(dirpath: string) {
  return path.basename(path.dirname(dirpath)) === "reqs" && path.basename(path.dirname(path.dirname(dirpath))) === ".moks"
}

export function isLegacyReq(dirpath: string) {
  return path.basename(dirpath) === "req" && path.basename(path.dirname(dirpath)) === ".moks"
}

export function isReqDir(dirpath: string) {
  return isBookReq(dirpath) || isLegacyReq(dirpath)
}

export function isReqMaterial(filepath: string) {
  if (!(MATERIAL_NAMES as readonly string[]).includes(path.basename(filepath))) return false
  return isReqDir(path.dirname(filepath))
}

export function reqDirOf(filepath: string) {
  let current = path.resolve(filepath)
  while (true) {
    if (isReqDir(current)) return current
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

export function reqDirFromHint(hint: string, worktree: string) {
  const trimmed = hint.trim()
  if (!trimmed || worktree === "/") return
  const abs = path.isAbsolute(trimmed) ? trimmed : path.join(worktree, trimmed)
  const nested = reqDirOf(abs)
  if (nested) return nested
  if (trimmed.includes(path.sep) || trimmed.includes("/") || trimmed.includes(".")) return
  const slug = slugify(trimmed)
  if (!slug) return
  return path.join(worktree, dir(slug))
}

export function focusFromPaths(paths: Iterable<string>, worktree: string) {
  for (const hint of paths) {
    const focused = reqDirFromHint(hint, worktree)
    if (focused) return focused
  }
}

export function slugOf(dirpath: string) {
  if (isBookReq(dirpath)) return path.basename(dirpath)
  if (isLegacyReq(dirpath)) return "req"
}

export async function list(worktree: string) {
  const out: Listed[] = []
  const book = path.join(worktree, BOOK)
  const entries = await readdir(book, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const slug = slugify(entry.name)
    if (!slug) continue
    out.push({
      slug,
      path: path.join(book, entry.name),
      relative: path.join(BOOK, entry.name),
    })
  }

  const legacy = path.join(worktree, LEGACY)
  const legacyStat = await readdir(legacy).then(
    () => true,
    () => false,
  )
  if (legacyStat && !out.some((item) => item.slug === "req")) {
    out.push({
      slug: "req",
      path: legacy,
      relative: LEGACY,
      legacy: true,
    })
  }

  return out.toSorted((a, b) => a.slug.localeCompare(b.slug))
}

export async function resolve(directory: string, worktree?: string) {
  const start = path.resolve(directory)
  const stop = worktree && worktree !== "/" ? path.resolve(worktree) : undefined
  let current = start
  while (true) {
    if (isReqDir(current)) return current
    const listed = await list(current)
    if (listed.length === 1) return listed[0].path
    if (listed.length > 1) return
    if (stop && current === stop) return
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

export async function scaffold(worktree: string, slug: string) {
  const created: string[] = []
  const skipped: string[] = []
  const rels = [
    [path.join(dir(slug), "jd.md"), JD_STUB],
    [path.join(dir(slug), "scorecard.md"), SCORECARD_STUB],
    [path.join(dir(slug), "notes.md"), NOTES_STUB],
  ] as const
  const gitkeep = path.join(dir(slug), "scores", ".gitkeep")

  for (const [rel, content] of rels) {
    const file = Bun.file(path.join(worktree, rel))
    if ((await file.exists()) && (await file.text()).trim().length > 0) {
      skipped.push(rel)
      continue
    }
    await Bun.write(path.join(worktree, rel), content)
    created.push(rel)
  }

  if (await Bun.file(path.join(worktree, gitkeep)).exists()) {
    skipped.push(gitkeep)
  } else {
    await Bun.write(path.join(worktree, gitkeep), "")
    created.push(gitkeep)
  }

  const gitignore = path.join(worktree, ".gitignore")
  const ignore = Bun.file(gitignore)
  if (await ignore.exists()) {
    const text = await ignore.text()
    if (hasMoksIgnore(text)) {
      skipped.push(".gitignore")
    } else {
      const prefix = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`
      await Bun.write(gitignore, `${prefix}.moks/\n`)
      created.push(".gitignore")
    }
  }

  return { created, skipped, slug, relative: dir(slug) }
}

function hasMoksIgnore(text: string) {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim()
    return trimmed === ".moks" || trimmed === ".moks/" || trimmed === "/.moks" || trimmed === "/.moks/"
  })
}

export * as ReqWorkspace from "./req-workspace"
