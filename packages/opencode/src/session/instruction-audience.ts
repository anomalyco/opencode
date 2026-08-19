import { Schema } from "effect"
import matter from "gray-matter"
import { isRecord } from "@/util/record"
import { Wildcard } from "@/util/wildcard"

export type Reader = { role: "main" | "subagent"; agent: string }

export type AudienceEntry = {
  role?: "main" | "subagent" | "all"
  agent?: string
}

export class AudienceError extends Schema.TaggedErrorClass<AudienceError>()("InstructionAudienceError", {
  path: Schema.String,
  detail: Schema.String,
}) {
  override get message() {
    return `Instruction audience error in ${this.path}: ${this.detail}`
  }
}

export type Parsed =
  | { kind: "absent" }
  | { kind: "present"; body: string; entries: AudienceEntry[] }

const roles = ["main", "subagent", "all"] as const

export function parse(filepath: string, content: string): Parsed {
  const parsed = parseMatter(filepath, content)
  if (!isRecord(parsed.data)) return { kind: "absent" }
  if (!("opencode" in parsed.data)) return { kind: "absent" }

  const opencode = parsed.data.opencode
  if (!isRecord(opencode)) fail(filepath, "`opencode` must be a mapping")

  const keys = Object.keys(opencode)
  if (keys.length === 0) return { kind: "absent" }

  const unknown = keys.filter((key) => key !== "audience")
  if (unknown.length > 0) fail(filepath, `unknown keys inside opencode: ${unknown.join(", ")}`)
  return { kind: "present", body: parsed.content, entries: parseEntries(filepath, opencode.audience) }
}

function parseMatter(filepath: string, content: string) {
  try {
    return matter(content)
  } catch (error) {
    fail(filepath, `unparseable YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseEntries(filepath: string, raw: unknown) {
  const entries = Array.isArray(raw) ? raw : [raw]
  if (entries.length === 0) fail(filepath, "opencode.audience is empty")
  return entries.map((entry, index) => parseEntry(filepath, entry, index))
}

function parseEntry(filepath: string, raw: unknown, index: number): AudienceEntry {
  if (typeof raw === "string") return { role: parseRole(filepath, raw, index) }
  if (!isRecord(raw)) fail(filepath, `opencode.audience[${index}] must be a mapping or string`)

  const keys = Object.keys(raw)
  if (keys.length === 0) fail(filepath, `opencode.audience[${index}] is empty`)

  const unknown = keys.filter((key) => key !== "role" && key !== "agent")
  if (unknown.length > 0) fail(filepath, `opencode.audience[${index}] has unknown keys: ${unknown.join(", ")}`)
  const agent = raw.agent
  if (agent !== undefined && typeof agent !== "string") {
    fail(filepath, `opencode.audience[${index}].agent must be a string`)
  }

  return {
    ...(raw.role === undefined ? {} : { role: parseRole(filepath, raw.role, index) }),
    ...(agent === undefined ? {} : { agent }),
  }
}

function parseRole(filepath: string, raw: unknown, index: number): AudienceEntry["role"] {
  if (raw === "main" || raw === "subagent" || raw === "all") return raw
  fail(filepath, `opencode.audience[${index}].role must be one of ${roles.join(" | ")}`)
}

function fail(filepath: string, detail: string): never {
  throw new AudienceError({ path: filepath, detail })
}

export function matches(reader: Reader, entries: AudienceEntry[]) {
  return entries.some((entry) => {
    const role = entry.role === undefined || entry.role === "all" || entry.role === reader.role
    const agent = entry.agent === undefined || Wildcard.match(reader.agent, entry.agent)
    return role && agent
  })
}

export function filter(
  filepath: string,
  content: string,
  reader: Reader,
): { include: true; body: string } | { include: false } {
  const parsed = parse(filepath, content)
  if (parsed.kind === "absent") return { include: true, body: content }
  if (!matches(reader, parsed.entries)) return { include: false }
  return { include: true, body: parsed.body }
}

export * as InstructionAudience from "./instruction-audience"
