import { readFileSync, writeFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import type { Skill } from "./types.ts"

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/

/** Parse a `SKILL.md` string into frontmatter + body. */
export function parseSkill(raw: string, path = ""): Skill {
  const match = raw.match(FRONTMATTER)
  let frontmatter: Record<string, unknown> = {}
  let body = raw
  if (match) {
    frontmatter = parseFrontmatter(match[1])
    body = raw.slice(match[0].length)
  }
  const name = String(frontmatter.name ?? (path ? basename(dirname(path)) : "") ?? "skill") || "skill"
  return { name, path, frontmatter, body: body.replace(/^\n+/, "") }
}

/**
 * Minimal frontmatter parser: flat `key: value` lines only. This is enough for
 * the fields the loop reads/preserves (name, description); anything richer is
 * kept verbatim only if it is a simple scalar.
 */
export function parseFrontmatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (m) out[m[1]] = parseScalar(m[2])
  }
  return out
}

function parseScalar(value: string): unknown {
  const t = value.trim()
  if (t === "") return ""
  if (t === "true") return true
  if (t === "false") return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return t.replace(/^["']|["']$/g, "")
}

function formatScalar(value: unknown): string {
  if (typeof value === "string" && /[:#]/.test(value)) return JSON.stringify(value)
  return String(value)
}

/** Serialize a skill back to `SKILL.md` text (frontmatter + body). */
export function serializeSkill(skill: Skill): string {
  const keys = Object.keys(skill.frontmatter)
  const body = skill.body.replace(/^\n+/, "").replace(/\n*$/, "\n")
  if (keys.length === 0) return body
  const fm = keys.map((k) => `${k}: ${formatScalar(skill.frontmatter[k])}`).join("\n")
  return `---\n${fm}\n---\n\n${body}`
}

export function loadSkill(path: string): Skill {
  return parseSkill(readFileSync(path, "utf8"), path)
}

export function writeSkill(skill: Skill, path = skill.path): void {
  if (!path) throw new Error("writeSkill: no path provided")
  writeFileSync(path, serializeSkill(skill), "utf8")
}

/** Byte size of the serialized skill (what the size gate measures). */
export function skillBytes(skill: Skill): number {
  return Buffer.byteLength(serializeSkill(skill), "utf8")
}

/** Return a copy of `skill` with a replaced body. */
export function withBody(skill: Skill, body: string): Skill {
  return { ...skill, body: body.replace(/^\n+/, "") }
}

/** Extract the markdown ATX headings (`#`..`######`) from a skill body. */
export function headings(skill: Skill): string[] {
  return skill.body
    .split("\n")
    .map((l) => l.match(/^#{1,6}\s+(.*?)\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim())
}
