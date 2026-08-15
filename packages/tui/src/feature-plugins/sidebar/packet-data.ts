import { readdir } from "node:fs/promises"
import path from "node:path"

export type PacketCandidate = {
  id: string
  stage?: string
  score?: number
}

export type PacketReq = {
  slug: string
  title: string
  focused: boolean
}

export type PacketData = {
  company: string
  companyTitle: string
  reqs: PacketReq[]
  packet?: {
    slug: string
    title: string
    candidates: PacketCandidate[]
  }
}

export async function loadPacket(dir: string) {
  if (await isPacket(dir)) {
    const parent = path.dirname(dir)
    if (parent !== dir && (await hasHiring(parent)) && !(await isDir(path.join(parent, "candidates")))) {
      return packetOf(parent, dir)
    }
    return packetOf(dir, dir)
  }
  if (!(await hasHiring(dir))) return
  const slug = await readFocus(dir)
  if (slug && (await isPacket(path.join(dir, slug)))) return packetOf(dir, path.join(dir, slug))
  return packetOf(dir)
}

async function packetOf(company: string, focused?: string) {
  const implicit = focused === company
  return {
    company,
    companyTitle: await readTitle(company),
    reqs: await Promise.all(
      (implicit ? [path.basename(company)] : await listReqSlugs(company)).map(async (slug) => ({
        slug,
        title: await readTitle(implicit ? company : path.join(company, slug)),
        focused: slug === (focused ? path.basename(focused) : undefined),
      })),
    ),
    packet: focused
      ? {
          slug: path.basename(focused),
          title: await readTitle(focused),
          candidates: await listCandidates(focused),
        }
      : undefined,
  } satisfies PacketData
}

async function listReqSlugs(company: string) {
  const entries = await readdir(company, { withFileTypes: true }).catch(() => [])
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    if (await hasHiring(path.join(company, entry.name))) names.push(entry.name)
  }
  return names.toSorted()
}

async function listCandidates(dir: string) {
  const entries = await readdir(path.join(dir, "candidates"), { withFileTypes: true }).catch(() => [])
  const cards: PacketCandidate[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === ".gitkeep") continue
    const text = await Bun.file(path.join(dir, "candidates", entry.name))
      .text()
      .catch(() => "")
    const card = parseCard(text)
    if (card) cards.push(card)
  }
  return cards.toSorted((a, b) => a.id.localeCompare(b.id))
}

function parseCard(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return
  let id = ""
  let stage: string | undefined
  let score: number | undefined
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const sep = trimmed.indexOf(":")
    if (sep <= 0) continue
    const key = trimmed.slice(0, sep).trim()
    const value = trimmed.slice(sep + 1).trim()
    if (key === "id") {
      id = value
      continue
    }
    if (key === "stage") {
      stage = value
      continue
    }
    if (key !== "score") continue
    const n = Number(value)
    if (!Number.isNaN(n)) score = n
  }
  if (!id) return
  return { id, stage, score }
}

async function readTitle(dir: string) {
  const text = await Bun.file(path.join(dir, "HIRING.md"))
    .text()
    .catch(() => undefined)
  const title = text ? firstHeading(text) : undefined
  if (title) return title
  return path.basename(dir)
}

async function readFocus(company: string) {
  const slug = await Bun.file(path.join(company, ".moks", "focus"))
    .text()
    .then((text) => text.trim())
    .catch(() => "")
  if (!slug || slug.includes("..") || path.isAbsolute(slug) || slug.includes("/") || slug.includes("\\")) return
  return slug
}

async function isPacket(dir: string) {
  return (await hasHiring(dir)) && (await isDir(path.join(dir, "candidates")))
}

async function hasHiring(dir: string) {
  return Bun.file(path.join(dir, "HIRING.md")).exists()
}

async function isDir(dir: string) {
  return readdir(dir)
    .then(() => true)
    .catch(() => false)
}

function firstHeading(text: string) {
  const match = text.match(/^#\s+(.+)$/m)
  if (!match) return
  return match[1].trim()
}
