import path from "path"

export const CANDIDATES_DIR = "candidates"

export type Card = {
  id: string
  stage?: string
  score?: number
  source?: string
  ats_id?: string
  extra: Record<string, string>
  body: string
}

export function safeId(id: string) {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")
}

export function fileName(id: string) {
  const slug = safeId(id)
  if (!slug) throw new Error("invalid candidate id")
  return `${slug}.md`
}

export function filePath(cwd: string, id: string) {
  return path.join(cwd, CANDIDATES_DIR, fileName(id))
}

export function isCardPath(filepath: string) {
  const parent = path.basename(path.dirname(filepath))
  return parent === CANDIDATES_DIR && filepath.endsWith(".md") && path.basename(filepath) !== ".gitkeep"
}

export function parse(text: string): Card | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return
  const extra: Record<string, string> = {}
  let id = ""
  let stage: string | undefined
  let score: number | undefined
  let source: string | undefined
  let ats_id: string | undefined
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const sep = trimmed.indexOf(":")
    if (sep <= 0) continue
    const key = trimmed.slice(0, sep).trim()
    const value = trimmed.slice(sep + 1).trim()
    if (key === "id") id = value
    else if (key === "stage") stage = value
    else if (key === "score") {
      const n = Number(value)
      if (!Number.isNaN(n)) score = n
    } else if (key === "source") source = value
    else if (key === "ats_id") ats_id = value
    else extra[key] = value
  }
  if (!id) return
  return { id, stage, score, source, ats_id, extra, body: match[2].replace(/^\r?\n/, "") }
}

export function serialize(card: Card) {
  const lines = [`id: ${card.id}`]
  if (card.stage) lines.push(`stage: ${card.stage}`)
  if (card.score !== undefined) lines.push(`score: ${card.score}`)
  if (card.source) lines.push(`source: ${card.source}`)
  if (card.ats_id) lines.push(`ats_id: ${card.ats_id}`)
  for (const key of Object.keys(card.extra).toSorted()) {
    lines.push(`${key}: ${card.extra[key]}`)
  }
  const body = card.body.endsWith("\n") || card.body.length === 0 ? card.body : `${card.body}\n`
  return `---\n${lines.join("\n")}\n---\n\n${body}`
}

export function stub(id: string, input?: { stage?: string; name?: string; ats_id?: string; source?: string }) {
  return serialize({
    id,
    stage: input?.stage ?? "sourced",
    source: input?.source,
    ats_id: input?.ats_id,
    extra: input?.name ? { name: input.name } : {},
    body: input?.name ? `# ${input.name}\n` : `# ${id}\n`,
  })
}

export async function read(cwd: string, id: string) {
  const text = await Bun.file(filePath(cwd, id))
    .text()
    .catch(() => "")
  if (!text) return
  return parse(text)
}

export async function write(cwd: string, card: Card) {
  const file = filePath(cwd, card.id)
  await Bun.write(file, serialize(card))
  return file
}

export async function list(cwd: string) {
  const dir = path.join(cwd, CANDIDATES_DIR)
  const glob = new Bun.Glob("*.md")
  const cards: Card[] = []
  for await (const name of glob.scan({ cwd: dir, onlyFiles: true })) {
    if (name === ".gitkeep") continue
    const text = await Bun.file(path.join(dir, name)).text().catch(() => "")
    const card = parse(text)
    if (card) cards.push(card)
  }
  return cards.toSorted((a, b) => a.id.localeCompare(b.id))
}

export * as CandidateCard from "./candidate-card"
