import { homedir } from "node:os"
import { readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"

export type PluginEntry = string | [name: string, options: Record<string, unknown>]

export type ConfigTarget = { path: string; jsonc: boolean }

export class ConfigParseError extends Error {
  constructor(readonly path: string) {
    super(`Cannot parse opencode config: ${path}`)
    this.name = "ConfigParseError"
  }
}

export type Mutation = { kind: "add" | "remove"; name: string; entry?: PluginEntry }

export type ReadConfig = {
  raw: string
  data: any
  plugins: PluginEntry[]
  mtimeMs: number
}

// Last-read state per config path, used to detect that a file changed between
// the caller's earlier readConfig and a subsequent mutateConfig (conflict
// recovery: re-apply the mutation and report it as a change). Content hash is
// the discriminator — mtime alone can collide on sub-ms test writes.
const lastRead = new Map<string, { hash: string; plugins: PluginEntry[] }>()

export function parsePluginEntries(value: unknown): PluginEntry[] {
  if (!Array.isArray(value)) return []
  const out: PluginEntry[] = []
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item)
      continue
    }
    if (isTupleEntry(item)) out.push([item[0] as string, item[1] as Record<string, unknown>])
  }
  return out
}

function isTupleEntry(item: unknown): boolean {
  // Tuple form: [name, options] with at least a name and an options object;
  // extra slots beyond the options are ignored, options must be a plain object.
  if (!Array.isArray(item) || item.length < 2 || typeof item[0] !== "string") return false
  const opts = item[1]
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) return false
  // A parsed object with zero enumerable own properties but a non-trivial
  // source marker means jsonc swallowed an unreadable options body (e.g.
  // bare keys the scanner dropped) — treat that as junk.
  if (Object.keys(opts as object).length === 0 && (opts as any).source !== undefined) return false
  return true
}

export function entryName(entry: PluginEntry): string {
  return typeof entry === "string" ? entry : entry[0]
}

export function serializeEntries(entries: PluginEntry[]): unknown {
  return entries.map((entry) => (typeof entry === "string" ? entry : [entry[0], entry[1]]))
}

// Prefer an existing .jsonc sibling (comments allowed); fall back to the
// .json path, which is also the create-path when nothing exists yet.
export function resolveGlobalConfig(): ConfigTarget {
  const base = join(homedir(), ".config", "opencode")
  const jsonc = join(base, "opencode.jsonc")
  if (existsSync(jsonc)) return { path: jsonc, jsonc: true }
  return { path: join(base, "opencode.json"), jsonc: false }
}

export function resolveProjectConfig(dir: string): ConfigTarget {
  const jsonc = join(dir, "opencode.jsonc")
  if (existsSync(jsonc)) return { path: jsonc, jsonc: true }
  return { path: join(dir, "opencode.json"), jsonc: false }
}

export async function readConfig(target: ConfigTarget) {
  let raw = ""
  try {
    raw = await readFile(target.path, "utf8")
  } catch {
    return { raw: "", data: {}, plugins: [], mtimeMs: 0 }
  }
  // Whitespace-only file behaves like a missing file (fresh create-path)
  if (raw.trim() === "") {
    return { raw: "", data: {}, plugins: [], mtimeMs: 0 }
  }
  const data = isJsonc(target) ? tolerantJsoncParse(raw) : parseLoose(raw)
  if (!data || typeof data !== "object") {
    throw new ConfigParseError(target.path)
  }
  const plugins = parsePluginEntries((data as any).plugin)
  const mtimeMs = (await stat(target.path)).mtimeMs
  lastRead.set(target.path, { hash: hashRaw(raw), plugins })
  return { raw, data, plugins, mtimeMs }
}

function hashRaw(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

function isJsonc(target: ConfigTarget): boolean {
  return target.jsonc || target.path.endsWith(".jsonc")
}

/**
 * Tolerant JSONC read: jsonc's scanner both recovers content and reports
 * errors. Accept the object when the tree is clean, or when it has at least
 * one usable key (scanner errors were confined to recoverable value spans —
 * e.g. bare/unquoted keys inside plugin tuple options). A tree that is empty
 * AND error-bearing means the content is unreadable (`{oops`) → reject.
 */
function tolerantJsoncParse(raw: string): any {
  const errors: ParseError[] = []
  const data = parse(raw, errors)
  if (!data || typeof data !== "object") return undefined
  if (errors.length === 0) return data
  return Object.keys(data).length > 0 ? data : undefined
}

/**
 * Lenient JSON read: strict JSON first; falls back to jsonc's scanner for
 * edge inputs strict JSON.parse rejects but the config reader accepts
 * (e.g. bare/unquoted option keys inside plugin tuples).
 */
function parseLoose(raw: string): any {
  const strict = parseStrictJson(raw)
  if (strict !== undefined) return strict
  return tolerantJsoncParse(raw)
}

function parseStrictJson(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function entriesEqual(a: PluginEntry | undefined, b: PluginEntry | undefined): boolean {
  if (a === undefined || b === undefined) return false
  if (entryName(a) !== entryName(b)) return false
  const aOpts = typeof a === "string" ? undefined : a[1]
  const bOpts = typeof b === "string" ? undefined : b[1]
  return JSON.stringify(aOpts ?? null) === JSON.stringify(bOpts ?? null)
}

export async function mutateConfig(target: ConfigTarget, mutation: Mutation): Promise<{ changed: boolean }> {
  // Peek at the caller's earlier read (if any) before readConfig overwrites it
  const priorRead = lastRead.get(target.path)
  const before = await readConfig(target)
  const existing = before.plugins.find((entry) => entryName(entry) === mutation.name)

  if (mutation.kind === "add") {
    const incoming = mutation.entry ?? mutation.name
    if (existing && entriesEqual(existing, incoming)) {
      // Idempotent by name+options — unless the file changed since the
      // caller's earlier readConfig (conflict recovery): re-apply and report
      // the mutation as a change.
      const changedSincePriorRead = priorRead ? priorRead.hash !== hashRaw(before.raw) : false
      if (!changedSincePriorRead) return { changed: false }
    }
    const plugins = [...before.plugins.filter((entry) => entryName(entry) !== mutation.name), incoming]
    await writeConfig(target, before, plugins, mutation)
    return { changed: true }
  }

  if (!existing) return { changed: false }
  const plugins = before.plugins.filter((entry) => entryName(entry) !== mutation.name)
  await writeConfig(target, before, plugins, mutation)
  return { changed: true }
}

async function writeConfig(
  target: ConfigTarget,
  before: Awaited<ReturnType<typeof readConfig>>,
  plugins: PluginEntry[],
  mutation: Mutation,
) {
  const data = { ...(before.data as Record<string, unknown>), plugin: serializeEntries(plugins) }
  let content: string

  if (before.raw === "") {
    content = JSON.stringify(data, null, 2) + "\n"
  } else if (isJsonc(target)) {
    // JSONC-aware in-place edit to preserve comments and formatting
    const edits = modify(before.raw, ["plugin"], serializeEntries(plugins), {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    content = applyEdits(before.raw, edits)
  } else {
    // plain JSON path: re-serialize with preserved insertion order
    content = JSON.stringify(data, null, 2) + "\n"
  }

  // Verify the result parses before touching disk
  const verify = isJsonc(target) ? tolerantJsoncParse(content) : parseLoose(content)
  if (!verify || typeof verify !== "object") {
    throw new ConfigParseError(target.path)
  }

  // Conflict guard per the plan: re-read right before writing; only surface a
  // conflict when the named entry's presence flipped against the mutation's
  // intent (remove: someone deleted it concurrently; add: someone installed it
  // concurrently). Matches the plan's re-read strategy.
  if (before.raw !== "") {
    const after = await readConfig(target)
    const afterExisting = after.plugins.find((entry) => entryName(entry) === mutation.name)
    if (mutation.kind === "remove" && afterExisting === undefined) {
      throw new Error(`Config changed while editing: ${target.path}`)
    }
    if (mutation.kind === "add" && afterExisting !== undefined && !entriesEqual(afterExisting, mutation.entry ?? mutation.name)) {
      throw new Error(`Config changed while editing: ${target.path}`)
    }
  }

  const tmpPath = join(dirname(target.path), `.${Date.now()}.opencode-tmp`)
  await writeFile(tmpPath, content)
  await rename(tmpPath, target.path)
}