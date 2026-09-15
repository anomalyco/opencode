export * as Notebook from "./notebook"

import { CORE_SCHEMA, dump, load } from "js-yaml"

export const NOTEBOOK_NAME = ".note.yaml"

export const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "target",
  "vendor",
  "graft",
  "coverage",
  ".pytest_cache",
  "__pycache__",
])

export type Confidence = "observed" | "inferred" | "verified"
export type Freshness = "fresh" | "suspect" | "stale"
export type BasedOn = string[] // "path@fingerprint"

export type Entry = {
  name: string
  summary: string
  based_on: BasedOn
  confidence: Confidence
}

export type Relation = {
  from: string
  to: string
  description: string
  based_on: BasedOn
  confidence: Confidence
}

export type Notebook = {
  /** Absolute directory this notebook describes. */
  dir: string
  /** Project-relative directory ("." for the project root). */
  rel: string
  summary: string
  based_on: BasedOn
  entries: Record<string, Entry>
  relations: Relation[]
  updated: string
}

export const emptyNotebook = (dir: string, rel: string): Notebook => ({
  dir,
  rel,
  summary: "",
  based_on: [],
  entries: {},
  relations: [],
  updated: "",
})

// ---------- parse / serialize ----------

type RawRecord = Record<string, unknown>

const asRecord = (value: unknown): RawRecord => (isRecord(value) ? value : {})

const isRecord = (value: unknown): value is RawRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asString = (value: unknown): string => (typeof value === "string" ? value : "")

const asBasedOn = (value: unknown): BasedOn =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []

const asConfidence = (value: unknown): Confidence =>
  value === "inferred" || value === "verified" ? value : "observed"

export function parseNotebook(content: string, dir: string, rel: string): Notebook {
  let data: unknown
  try {
    // CORE_SCHEMA restricts parsing to plain YAML (no `!!js/function` RCE tags)
    // while still accepting the scalars/maps/lists a notebook uses.
    data = load(content, { schema: CORE_SCHEMA }) ?? {}
  } catch {
    data = {}
  }
  const root = asRecord(data)
  const entries: Record<string, Entry> = {}
  for (const [name, raw] of Object.entries(asRecord(root.entries))) {
    const item = asRecord(raw)
    entries[name] = {
      name,
      summary: asString(item.summary).trim(),
      based_on: asBasedOn(item.based_on),
      confidence: asConfidence(item.confidence),
    }
  }
  const relations: Relation[] = []
  for (const raw of Array.isArray(root.relations) ? root.relations : []) {
    const item = asRecord(raw)
    const from = asString(item.from).trim()
    const to = asString(item.to).trim()
    if (!from || !to) continue
    relations.push({
      from,
      to,
      description: asString(item.description).trim(),
      based_on: asBasedOn(item.based_on),
      confidence: asConfidence(item.confidence),
    })
  }
  return {
    dir,
    rel,
    summary: asString(root.summary).trim(),
    based_on: asBasedOn(root.based_on),
    entries,
    relations,
    updated: asString(root.updated),
  }
}

export function serializeNotebook(nb: Notebook): string {
  const doc: RawRecord = { version: 1, updated: nb.updated }
  if (nb.summary) doc.summary = nb.summary
  if (nb.based_on.length > 0) doc.based_on = nb.based_on
  if (Object.keys(nb.entries).length > 0) {
    const entries: Record<string, RawRecord> = {}
    for (const entry of Object.values(nb.entries)) {
      const item: RawRecord = { summary: entry.summary }
      if (entry.confidence !== "observed") item.confidence = entry.confidence
      if (entry.based_on.length > 0) item.based_on = entry.based_on
      entries[entry.name] = item
    }
    doc.entries = entries
  }
  if (nb.relations.length > 0) {
    doc.relations = nb.relations.map((rel) => {
      const item: RawRecord = { from: rel.from, to: rel.to, description: rel.description }
      if (rel.confidence !== "observed") item.confidence = rel.confidence
      if (rel.based_on.length > 0) item.based_on = rel.based_on
      return item
    })
  }
  return dump(doc, { noRefs: true, lineWidth: 100 })
}

// ---------- text helpers ----------

const STOP = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "and",
  "or",
  "it",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "by",
  "as",
  "via",
  "its",
  "their",
  "into",
  "through",
  "using",
  "when",
  "while",
  "does",
  "do",
  "doesn",
  "don",
  "has",
  "have",
])

export function tokens(input: string): Set<string> {
  const set = new Set<string>()
  for (const word of input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (word.length > 1 && !STOP.has(word)) set.add(word)
  }
  return set
}

export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const token of a) if (b.has(token)) inter++
  return inter / Math.min(a.size, b.size)
}

const CONFIDENCE_RANK: Record<Confidence, number> = { observed: 0, inferred: 1, verified: 2 }

export function maxConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b
}

function mergeUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]))
}

// ---------- tree placement ----------

const asPosix = (relPath: string) => relPath.replaceAll("\\", "/")

function dirParts(relPath: string): string[] {
  const dir = asPosix(relPath).split("/").slice(0, -1).join("/") || ""
  if (!dir || dir === ".") return []
  return dir.split("/").filter(Boolean)
}

export function relationFolder(fromPath: string, toPath: string): string {
  const a = dirParts(fromPath)
  const b = dirParts(toPath)
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return a.slice(0, i).join("/")
}

export function relTo(fromPath: string, folder: string): string {
  const rel = (folder || ".") === "." ? asPosix(fromPath) : asPosix(fromPath).split("/").slice(folder.split("/").length).join("/")
  return rel === "" ? "." : rel
}

// ---------- scoring ----------

export function scoreEntry(entry: Entry, query: string): number {
  const q = tokens(query)
  if (q.size === 0) return 0
  let score = overlap(tokens(entry.summary), q) * 3
  score += overlap(tokens(entry.name), q) * 2
  for (const item of entry.based_on) score += overlap(tokens(item), q)
  return score
}

export function scoreRelation(rel: Relation, query: string): number {
  const q = tokens(query)
  if (q.size === 0) return 0
  let score = overlap(tokens(rel.description), q) * 3
  score += overlap(tokens(`${rel.from} ${rel.to}`), q) * 2
  for (const item of rel.based_on) score += overlap(tokens(item), q)
  return score
}

// ---------- commit ops ----------

export type Op =
  | { kind: "folder"; summary: string; basedOn: BasedOn }
  | { kind: "entry"; name: string; summary: string; basedOn: BasedOn; confidence: Confidence }
  | { kind: "removeEntry"; name: string }
  | { kind: "relation"; from: string; to: string; description: string; basedOn: BasedOn; confidence: Confidence }
  | { kind: "removeRelation"; from: string; to: string }

export function applyOps(
  nb: Notebook,
  ops: ReadonlyArray<Op>,
): { nb: Notebook; dirty: boolean; changes: string[] } {
  const out: Notebook = { ...nb, based_on: [...nb.based_on], entries: { ...nb.entries }, relations: [...nb.relations] }
  const changes: string[] = []
  let dirty = false

  for (const op of ops) {
    switch (op.kind) {
      case "folder": {
        const summary = op.summary.trim()
        if (summary && summary !== out.summary) {
          out.summary = summary
          out.based_on = mergeUnique(out.based_on, op.basedOn)
          changes.push("folder summary updated")
          dirty = true
        }
        break
      }
      case "entry": {
        const prev = out.entries[op.name]
        const summary = op.summary.trim()
        if (prev) {
          if (summary && summary !== prev.summary) {
            prev.summary = summary
            prev.confidence = maxConfidence(prev.confidence, op.confidence)
            prev.based_on = mergeUnique(prev.based_on, op.basedOn)
            changes.push(`entry ${op.name} updated`)
            dirty = true
          }
        } else if (summary) {
          out.entries[op.name] = { name: op.name, summary, based_on: op.basedOn, confidence: op.confidence }
          changes.push(`entry ${op.name} added`)
          dirty = true
        }
        break
      }
      case "removeEntry": {
        if (out.entries[op.name]) {
          delete out.entries[op.name]
          changes.push(`entry ${op.name} removed`)
          dirty = true
        } else {
          changes.push(`entry ${op.name} not found`)
        }
        break
      }
      case "relation": {
        const description = op.description.trim()
        const idx = out.relations.findIndex((r) => r.from === op.from && r.to === op.to)
        if (idx >= 0) {
          const prev = out.relations[idx]
          if (description && (description !== prev.description || op.confidence !== prev.confidence)) {
            prev.description = description
            prev.confidence = maxConfidence(prev.confidence, op.confidence)
            prev.based_on = mergeUnique(prev.based_on, op.basedOn)
            changes.push(`relation ${op.from} → ${op.to} updated`)
            dirty = true
          }
        } else if (description) {
          out.relations.push({
            from: op.from,
            to: op.to,
            description,
            based_on: op.basedOn,
            confidence: op.confidence,
          })
          changes.push(`relation ${op.from} → ${op.to} added`)
          dirty = true
        }
        break
      }
      case "removeRelation": {
        const idx = out.relations.findIndex((r) => r.from === op.from && r.to === op.to)
        if (idx >= 0) {
          out.relations.splice(idx, 1)
          changes.push(`relation ${op.from} → ${op.to} removed`)
          dirty = true
        } else {
          changes.push(`relation ${op.from} → ${op.to} not found`)
        }
        break
      }
    }
  }

  return { nb: out, dirty, changes }
}

// ---------- diff ----------

export function unifiedDiff(oldText: string, newText: string, label: string): string {
  const a = oldText.split("\n")
  const b = newText.split("\n")
  const height = a.length + 1
  const width = b.length + 1
  const table: number[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => 0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const ops: Array<[string, string]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push([" ", a[i]])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push(["-", a[i]])
      i++
    } else {
      ops.push(["+", b[j]])
      j++
    }
  }
  while (i < a.length) ops.push(["-", a[i++]])
  while (j < b.length) ops.push(["+", b[j++]])

  const changed = ops.filter(([sign]) => sign !== " ").length
  if (changed === 0) return ""

  const idx: number[] = []
  for (let k = 0; k < ops.length; k++) if (ops[k][0] !== " ") idx.push(k)
  const start = Math.max(0, idx[0] - 2)
  const end = Math.min(ops.length - 1, idx[idx.length - 1] + 2)

  let oldBefore = 0
  let newBefore = 0
  for (let k = 0; k < start; k++) {
    const sign = ops[k][0]
    if (sign === "-") oldBefore++
    else if (sign === "+") newBefore++
    else {
      oldBefore++
      newBefore++
    }
  }
  let oldCount = 0
  let newCount = 0
  for (let k = start; k <= end; k++) {
    const sign = ops[k][0]
    if (sign === "-") oldCount++
    else if (sign === "+") newCount++
    else {
      oldCount++
      newCount++
    }
  }

  const body = ops.slice(start, end + 1).map(([sign, line]) => `${sign}${line}`).join("\n")
  return `--- a/${label}\n+++ b/${label}\n@@ -${oldBefore + 1},${oldCount} +${newBefore + 1},${newCount} @@\n${body}`
}
