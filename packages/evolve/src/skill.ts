import { readFileSync, writeFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import type { Skill } from "./types.ts"

const FENCE = "---"

/**
 * Split a `SKILL.md` string into its frontmatter block (verbatim) and body.
 * Uses string scanning rather than a regex so it is linear-time on adversarial
 * input (no catastrophic backtracking).
 */
function splitFrontmatter(raw: string): { frontmatter?: string; body: string } {
  if (!raw.startsWith(FENCE + "\n") && raw !== FENCE) return { body: raw }
  // Find the closing fence line after the opening one.
  const lines = raw.split("\n")
  if (lines[0] !== FENCE) return { body: raw }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FENCE) {
      const frontmatter = lines.slice(1, i).join("\n")
      const body = lines.slice(i + 1).join("\n")
      return { frontmatter, body }
    }
  }
  return { body: raw }
}

/** Parse a `SKILL.md` string into frontmatter + body. */
export function parseSkill(raw: string, path = ""): Skill {
  const { frontmatter: frontmatterRaw, body } = splitFrontmatter(raw)
  const frontmatter = frontmatterRaw !== undefined ? parseFrontmatter(frontmatterRaw) : {}
  const name = String(frontmatter.name ?? (path ? basename(dirname(path)) : "") ?? "skill") || "skill"
  return { name, path, frontmatter, frontmatterRaw, body: stripLeadingBlankLines(body) }
}

/**
 * Minimal frontmatter reader: flat `key: value` lines only, parsed without
 * regex. Rich YAML is intentionally not interpreted here — it is preserved
 * verbatim via `frontmatterRaw` and only the simple scalars are surfaced for
 * reads (e.g. `name`).
 */
export function parseFrontmatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    const key = line.slice(0, colon)
    if (!isPlainKey(key)) continue
    out[key] = parseScalar(line.slice(colon + 1).trim())
  }
  return out
}

function isPlainKey(key: string): boolean {
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    const ok =
      (c >= 48 && c <= 57) || // 0-9
      (c >= 65 && c <= 90) || // A-Z
      (c >= 97 && c <= 122) || // a-z
      c === 45 || // -
      c === 95 // _
    if (!ok) return false
  }
  return key.length > 0
}

function parseScalar(value: string): unknown {
  const t = value.trim()
  if (t === "") return ""
  if (t === "true") return true
  if (t === "false") return false
  if (isNumeric(t)) return Number(t)
  return stripQuotes(t)
}

function isNumeric(t: string): boolean {
  // Linear, allocation-free numeric check (avoids regex backtracking).
  return t.length > 0 && Number.isFinite(Number(t))
}

function stripQuotes(t: string): string {
  const first = t[0]
  const last = t[t.length - 1]
  if (t.length >= 2 && (first === '"' || first === "'") && last === first) return t.slice(1, -1)
  return t
}

/** Serialize a skill back to `SKILL.md` text (frontmatter + body). */
export function serializeSkill(skill: Skill): string {
  const body = ensureTrailingNewline(stripLeadingBlankLines(skill.body))
  // Prefer the verbatim block when available — this preserves rich YAML exactly.
  if (skill.frontmatterRaw !== undefined) {
    return skill.frontmatterRaw === "" ? body : `${FENCE}\n${skill.frontmatterRaw}\n${FENCE}\n\n${body}`
  }
  const keys = Object.keys(skill.frontmatter)
  if (keys.length === 0) return body
  const fm = keys.map((k) => `${k}: ${formatScalar(skill.frontmatter[k])}`).join("\n")
  return `${FENCE}\n${fm}\n${FENCE}\n\n${body}`
}

function formatScalar(value: unknown): string {
  if (typeof value === "string" && (value.includes(":") || value.includes("#"))) return JSON.stringify(value)
  return String(value)
}

function stripLeadingBlankLines(text: string): string {
  let i = 0
  while (i < text.length && text[i] === "\n") i++
  return text.slice(i)
}

function ensureTrailingNewline(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === "\n") end--
  return text.slice(0, end) + "\n"
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

/** Return a copy of `skill` with a replaced body (frontmatter preserved verbatim). */
export function withBody(skill: Skill, body: string): Skill {
  return { ...skill, body: stripLeadingBlankLines(body) }
}

/** Extract the markdown ATX headings (`#`..`######`) from a skill body. */
export function headings(skill: Skill): string[] {
  const out: string[] = []
  for (const line of skill.body.split("\n")) {
    const text = headingText(line)
    if (text) out.push(text)
  }
  return out
}

/** Return the heading text for an ATX heading line, else undefined. Regex-free. */
function headingText(line: string): string | undefined {
  let i = 0
  while (i < line.length && line[i] === "#") i++
  if (i === 0 || i > 6) return undefined
  if (i >= line.length || (line[i] !== " " && line[i] !== "\t")) return undefined
  return line.slice(i).trim() || undefined
}
