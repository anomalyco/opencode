import { readdir } from "fs/promises"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { CandidateCard, CANDIDATES_DIR } from "./candidate-card"

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

export const COMPANY_STUB = `# Company

## About
- TBD

## Hiring principles
- TBD

## Process
- Reqs live in subdirectories. Each req has HIRING.md + candidates/.
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
  return isHiringFile(filepath) || CandidateCard.isCardPath(filepath)
}

export async function isPacket(dir: string) {
  return (await isReqDir(dir)) && (await Filesystem.isDir(path.join(dir, CANDIDATES_DIR)))
}

export async function isCompanyRoot(dir: string) {
  return isReqDir(dir)
}

export async function listReqs(company: string) {
  if (!(await Filesystem.isDir(company))) return []
  const names: string[] = []
  for (const entry of await readdir(company, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    if (await isReqDir(path.join(company, entry.name))) names.push(entry.name)
  }
  return names.toSorted()
}

export const FOCUS_FILE = ".moks/focus"

export async function readFocus(company: string) {
  const slug = await Bun.file(path.join(company, FOCUS_FILE))
    .text()
    .then((text) => text.trim())
    .catch(() => "")
  if (!slug || slug.includes("..") || path.isAbsolute(slug) || slug.includes("/") || slug.includes("\\")) return
  return slug
}

export async function writeFocus(company: string, slug: string) {
  const safe = path.basename(slug.trim())
  if (!safe || safe === "." || safe === "..") return
  await Bun.write(path.join(company, FOCUS_FILE), safe)
}

export async function focusedReq(opened: string) {
  const company = await companyRoot(opened)
  if (!company) return
  if (await isPacket(opened)) return opened
  if (await isPacket(company)) return company
  const slug = await readFocus(company)
  if (slug && (await isPacket(path.join(company, slug)))) return path.join(company, slug)
}

export async function workspaceEnv(dir: string) {
  const company = (await companyRoot(dir)) ?? dir
  const focused = await focusedReq(dir)
  return {
    company,
    focused: !focused ? "none" : focused === company ? "same as company" : focused,
    candidates: focused ? path.join(focused, CANDIDATES_DIR) : "none",
    hiring: (await isReqDir(dir)) ? "present" : "missing",
  }
}

const SLATE_CAP = 20

export async function slateBlock(dir: string) {
  const focused = await focusedReq(dir)
  if (focused && (await isPacket(focused))) {
    const cards = (await CandidateCard.list(focused)).slice(0, SLATE_CAP)
    if (cards.length === 0) return
    return [
      "<slate>",
      ...cards.map((card) => {
        const fields = [card.id]
        if (card.stage) fields.push(`stage=${card.stage}`)
        if (card.score !== undefined) fields.push(`score=${card.score}`)
        fields.push(`path=${path.relative(focused, CandidateCard.filePath(focused, card.id)).replaceAll(path.sep, "/")}`)
        return `  ${fields.join("  ")}`
      }),
      "</slate>",
    ].join("\n")
  }
  const company = await companyRoot(dir)
  if (company) {
    const reqs = await listReqs(company)
    if (reqs.length === 0) return
    return ["<reqs>", ...reqs.map((name) => `  ${name}`), "</reqs>"].join("\n")
  }
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

export async function companyRoot(opened: string) {
  const nearest = await resolve(opened)
  if (!nearest) return
  const parent = path.dirname(nearest)
  if (
    parent !== nearest &&
    (await isPacket(nearest)) &&
    (await isCompanyRoot(parent)) &&
    !(await isPacket(parent))
  ) {
    return parent
  }
  return nearest
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
  const present = (await existing.exists()) && (await existing.text()).trim().length > 0

  if (!present) {
    await Bun.write(hiring, COMPANY_STUB)
    created.push(HIRING_FILE)
    const git = await gitInitIfNeeded(cwd, [HIRING_FILE])
    return { created, skipped, title, relative: ".", git }
  }

  if (!(await Filesystem.isDir(path.join(cwd, CANDIDATES_DIR)))) {
    const slug = title ? slugify(title) : ""
    if (!slug) {
      skipped.push(HIRING_FILE)
      const git = await gitInitIfNeeded(cwd, [HIRING_FILE], false)
      return { created, skipped, title, relative: ".", git }
    }
    const reqHiring = path.join(slug, HIRING_FILE)
    const reqKeep = path.join(slug, CANDIDATES_DIR, ".gitkeep")
    const reqFile = Bun.file(path.join(cwd, reqHiring))
    if ((await reqFile.exists()) && (await reqFile.text()).trim().length > 0) {
      skipped.push(reqHiring)
    } else {
      await Bun.write(path.join(cwd, reqHiring), stubFor(title))
      created.push(reqHiring)
    }
    if (await Bun.file(path.join(cwd, reqKeep)).exists()) {
      skipped.push(reqKeep)
    } else {
      await Bun.write(path.join(cwd, reqKeep), "")
      created.push(reqKeep)
    }
    const git = await gitInitIfNeeded(cwd, [slug], false)
    return { created, skipped, title, relative: slug, git }
  }

  skipped.push(HIRING_FILE)
  const gitkeep = path.join(CANDIDATES_DIR, ".gitkeep")
  if (await Bun.file(path.join(cwd, gitkeep)).exists()) {
    skipped.push(gitkeep)
  } else {
    await Bun.write(path.join(cwd, gitkeep), "")
    created.push(gitkeep)
  }
  const git = await gitInitIfNeeded(cwd, [HIRING_FILE, CANDIDATES_DIR], false)
  return { created, skipped, title, relative: ".", git }
}

async function gitInitIfNeeded(cwd: string, add: string[], create = true) {
  const paths: string[] = []
  for (const rel of add) {
    if (await Filesystem.exists(path.join(cwd, rel))) paths.push(rel)
  }

  const top = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const root = (await new Response(top.stdout).text()).trim()
  await top.exited
  if (top.exitCode === 0 && path.resolve(root) === path.resolve(cwd)) {
    if (paths.length > 0) {
      const staged = Bun.spawn(["git", "add", ...paths], { cwd, stdout: "pipe", stderr: "pipe" })
      await staged.exited
    }
    return "existing"
  }
  if (!create) return "existing"

  const init = Bun.spawn(["git", "init"], { cwd, stdout: "pipe", stderr: "pipe" })
  await init.exited
  if (init.exitCode !== 0) return "failed"

  if (paths.length > 0) {
    const staged = Bun.spawn(["git", "add", ...paths], { cwd, stdout: "pipe", stderr: "pipe" })
    await staged.exited
    if (staged.exitCode !== 0) return "failed"
  }

  const commit = Bun.spawn(
    ["git", "-c", "user.name=moks", "-c", "user.email=moks@local", "commit", "-m", "moks: init"],
    { cwd, stdout: "pipe", stderr: "pipe" },
  )
  await commit.exited
  if (commit.exitCode !== 0) return "failed"
  return "created"
}

export * as ReqWorkspace from "./req-workspace"
