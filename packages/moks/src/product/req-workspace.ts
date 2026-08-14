import path from "path"
import { CANDIDATES_DIR } from "./candidate-card"

export const HIRING_FILE = "HIRING.md"

export const HIRING_STUB = `# <role title>

## Role
- Team: TBD
- Level: TBD
- Location: TBD

## Must-haves
- TBD

## Nice-to-haves
- TBD

## Scorecard
| Dimension | Bar | Notes |
|-----------|-----|-------|
| TBD | 1–5 | |

## Process
- Stages: sourced → screen → phone → onsite → offer → hire
- Owners: TBD
`

export function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")
}

export function hiringPath(dirpath: string) {
  return path.join(dirpath, HIRING_FILE)
}

export async function isReqDir(dirpath: string) {
  return Bun.file(hiringPath(dirpath)).exists()
}

export function isHiringFile(filepath: string) {
  return path.basename(filepath) === HIRING_FILE
}

export function isReqMaterial(filepath: string) {
  return isHiringFile(filepath)
}

export async function resolve(directory: string, stop?: string) {
  const start = path.resolve(directory)
  const limit = stop && stop !== "/" ? path.resolve(stop) : undefined
  let current = start
  while (true) {
    if (await isReqDir(current)) return current
    if (limit && current === limit) return
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

export function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}

export function stubFor(title?: string) {
  if (!title) return HIRING_STUB
  return HIRING_STUB.replaceAll("<role title>", title)
}

export async function scaffold(cwd: string, title?: string) {
  const created: string[] = []
  const skipped: string[] = []
  const hiring = hiringPath(cwd)
  const existing = Bun.file(hiring)
  if ((await existing.exists()) && (await existing.text()).trim().length > 0) {
    skipped.push(HIRING_FILE)
  } else {
    await Bun.write(hiring, stubFor(title))
    created.push(HIRING_FILE)
  }

  const gitkeep = path.join(cwd, CANDIDATES_DIR, ".gitkeep")
  if (await Bun.file(gitkeep).exists()) {
    skipped.push(path.join(CANDIDATES_DIR, ".gitkeep"))
  } else {
    await Bun.write(gitkeep, "")
    created.push(path.join(CANDIDATES_DIR, ".gitkeep"))
  }

  const inited = await gitInitIfNeeded(cwd)
  return { created, skipped, title, relative: ".", git: inited }
}

async function gitInitIfNeeded(cwd: string) {
  const top = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const root = (await new Response(top.stdout).text()).trim()
  await top.exited
  if (top.exitCode === 0 && path.resolve(root) === path.resolve(cwd)) return "existing"

  const init = Bun.spawn(["git", "init"], { cwd, stdout: "pipe", stderr: "pipe" })
  await init.exited
  if (init.exitCode !== 0) return "failed"

  const add = Bun.spawn(["git", "add", HIRING_FILE, CANDIDATES_DIR], { cwd, stdout: "pipe", stderr: "pipe" })
  await add.exited
  if (add.exitCode !== 0) return "failed"

  const commit = Bun.spawn(
    ["git", "-c", "user.name=moks", "-c", "user.email=moks@local", "commit", "-m", "moks: init"],
    { cwd, stdout: "pipe", stderr: "pipe" },
  )
  await commit.exited
  if (commit.exitCode !== 0) return "failed"
  return "created"
}

export * as ReqWorkspace from "./req-workspace"
