import { dataRoot } from "./paths.ts"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import { isNodeError } from "./fs-durability.ts"

/**
 * Session journal: an auditable per-session record of what agents did to the
 * user's browser. The relay appends one JSON line per execute call to
 * `<data root>/sessions/<id>/journal.jsonl` (see paths.ts); the CLI `journal` command
 * reads the file locally and renders a human-readable timeline.
 */

export const JournalEntry = Schema.Struct({
  ts: Schema.String,
  sessionId: Schema.String,
  code: Schema.String,
  isError: Schema.Boolean,
  durationMs: Schema.Number,
  resultPreview: Schema.String,
  logCount: Schema.Number,
  startUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  endUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  navigations: Schema.optionalKey(Schema.Array(Schema.String)),
  warnings: Schema.optionalKey(Schema.Array(Schema.String)),
  diagnostic: Schema.optionalKey(Schema.String),
  handoffs: Schema.optionalKey(Schema.Number),
})

export interface JournalEntry extends Schema.Schema.Type<typeof JournalEntry> {}

const decodeJournalEntry = Schema.decodeUnknownOption(JournalEntry)

export const defaultJournalBaseDir = (): string => {
  return path.join(dataRoot(), "sessions")
}

export function journalPathForSession(baseDir: string, sessionId: string): string {
  return path.join(baseDir, sessionId, "journal.jsonl")
}

const maxJournalCodeLength = 2_000
const maxJournalPreviewLength = 400
const maxJournalDiagnosticLength = 240

export function truncateForJournal(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength)}… [truncated ${text.length - maxLength} chars]`
}

export function makeJournalEntry(options: {
  readonly sessionId: string
  readonly code: string
  readonly isError: boolean
  readonly durationMs: number
  readonly resultText: string
  readonly logCount: number
  readonly startUrl?: string | null | undefined
  readonly endUrl?: string | null | undefined
  readonly navigations?: readonly string[] | undefined
  readonly warnings?: readonly string[] | undefined
  readonly diagnostic?: string | undefined
  readonly handoffs?: number | undefined
}): JournalEntry {
  return {
    ts: new Date().toISOString(),
    sessionId: options.sessionId,
    code: truncateForJournal(options.code, maxJournalCodeLength),
    isError: options.isError,
    durationMs: options.durationMs,
    resultPreview: truncateForJournal(options.resultText, maxJournalPreviewLength),
    logCount: options.logCount,
    ...(options.startUrl === undefined ? {} : { startUrl: options.startUrl }),
    ...(options.endUrl === undefined ? {} : { endUrl: options.endUrl }),
    ...(options.navigations && options.navigations.length > 0 ? { navigations: options.navigations } : {}),
    ...(options.warnings && options.warnings.length > 0 ? { warnings: options.warnings } : {}),
    ...(options.diagnostic ? { diagnostic: truncateForJournal(options.diagnostic, maxJournalDiagnosticLength) } : {}),
    ...(options.handoffs ? { handoffs: options.handoffs } : {}),
  }
}

/**
 * Append a journal entry, creating the session directory if needed. Journal
 * writes are best-effort: failures are reported to the callback (or ignored)
 * and never fail the execute call they describe.
 */
export async function appendJournalEntry(options: {
  readonly baseDir: string
  readonly entry: JournalEntry
}): Promise<void> {
  const filePath = journalPathForSession(options.baseDir, options.entry.sessionId)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.appendFile(filePath, `${JSON.stringify(options.entry)}\n`, "utf8")
}

/** Read the last `limit` journal entries for a session; skips corrupt lines. */
export async function readJournalEntries(options: {
  readonly baseDir: string
  readonly sessionId: string
  readonly limit: number
}): Promise<JournalEntry[]> {
  const filePath = journalPathForSession(options.baseDir, options.sessionId)
  let raw: string
  try {
    raw = await fs.promises.readFile(filePath, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return []
    }
    throw error
  }
  return parseJournalLines(raw).slice(-options.limit)
}

export function parseJournalLines(raw: string): JournalEntry[] {
  const entries: JournalEntry[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const decoded = decodeJournalEntry(parsed)
    if (Option.isSome(decoded)) {
      entries.push(decoded.value)
    }
  }
  return entries
}

export function formatJournalEntry(entry: JournalEntry): string {
  const time = entry.ts.slice(11, 19) || entry.ts
  const status = entry.isError ? "ERR" : "ok "
  const codePreview = entry.code.replace(/\s+/g, " ").trim().slice(0, 80)
  const urlPart = entry.endUrl ? ` ${entry.endUrl}` : ""
  const navPart = entry.navigations && entry.navigations.length > 0 ? ` nav=${entry.navigations.length}` : ""
  const handoffPart = entry.handoffs ? ` handoffs=${entry.handoffs}` : ""
  const warningPart = entry.warnings && entry.warnings.length > 0 ? ` warnings=${entry.warnings.length}` : ""
  const diagnosticPart = entry.diagnostic ? ` diagnostic=${entry.diagnostic}` : ""
  return `${time} ${status} ${String(entry.durationMs).padStart(5)}ms${urlPart}${navPart}${handoffPart}${warningPart}${diagnosticPart}  ${codePreview}`
}
