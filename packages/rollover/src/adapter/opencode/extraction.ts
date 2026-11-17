/** Extraction driver (spec Part A §7). Async, testable. */
import { z } from "zod"
import type { NMessage } from "../../core/types"
import type { LedgerLine, LedgerRecord, SessionState, RolloverConfig } from "../../core/types"
import type { LlmPort } from "../../core/ports"
import { buildDelta } from "../../core/delta"
import { redact, redactRecordFields } from "../../core/redact"
import { activeRecords, nextRecordId, isDuplicate } from "../../core/ledger"
import { validateConsolidation } from "../../core/consolidate"
import { EXTRACTION_SYSTEM, CONSOLIDATION_SYSTEM } from "../../core/prompts"

const recordSchema = z.object({
  type: z.enum(["objective", "decision", "user_correction", "open_item", "verification"]),
  text: z.string(),
  rationale: z.string().optional(),
  files: z.array(z.string()).optional(),
  status: z.enum(["pass", "fail", "partial"]).optional(),
  process: z.object({ command: z.string(), purpose: z.string(), onResult: z.string() }).optional(),
})
const extractionSchema = z.object({ records: z.array(recordSchema) })

const MAX_RECORDS_PER_TURN = 12
const TEXT_CAP = 300
const RATIONALE_CAP = 200
const FILES_CAP = 5

export interface ExtractionInput {
  sid: string
  cfg: RolloverConfig
  st: SessionState
  msgs: NMessage[]
  lines: LedgerLine[]
  llm: LlmPort
  smallModel: string | null
  sessionModel: { providerID: string; id: string } | null
  now?: () => number
}

export interface ExtractionOutput {
  ok: boolean
  records: LedgerRecord[]
  newCursor: string | null
  shouldConsolidate: boolean
  reason?: string
}

export async function runExtraction(input: ExtractionInput): Promise<ExtractionOutput> {
  const now = input.now ?? (() => Date.now())
  const lastAssistant = [...input.msgs].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant) return { ok: false, records: [], newCursor: null, shouldConsolidate: false, reason: "no-assistant" }

  const delta = buildDelta(input.msgs, input.st.extractedUntilMessageId, { maxTokens: input.cfg.extractionDeltaMaxTokens })

  // nothing new
  if (delta.lastUserMessageId === "" && delta.turnMessageId === input.st.extractedUntilMessageId) {
    return { ok: true, records: [], newCursor: input.st.extractedUntilMessageId, shouldConsolidate: false }
  }
  if (delta.text.trim() === "") {
    return { ok: true, records: [], newCursor: input.st.extractedUntilMessageId, shouldConsolidate: false }
  }

  const active = activeRecords(input.lines)
  const userMsg = delta.lastUserMessageId

  // Returns the raw response text; JSON parsing happens at the call site via
  // parseExtractionJson, so a truncated response can still be salvaged.
  const attempt = async (extraInstruction: string): Promise<string> => {
    const res = await input.llm.complete({
      purpose: "extraction",
      system: EXTRACTION_SYSTEM,
      user: `DELTA:\n${delta.text}` + extraInstruction,
      maxOutputTokens: input.cfg.extractionDeltaMaxTokens,
      timeoutMs: input.cfg.extractionTimeoutMs,
      // Fallback chain: configured model → small model → the session's own
      // model, which is known to resolve and be authorized.
      model:
        input.cfg.extractionModel ??
        input.smallModel ??
        (input.sessionModel ? `${input.sessionModel.providerID}/${input.sessionModel.id}` : undefined),
    })
    return res.text
  }

  let parsed: z.infer<typeof extractionSchema> | null = null
  let failure = ""
  try {
    const v = extractionSchema.safeParse(parseExtractionJson(stripFence(await attempt(""))))
    if (v.success) parsed = v.data
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  if (!parsed) {
    try {
      const v = extractionSchema.safeParse(
        parseExtractionJson(stripFence(await attempt("\n\nReturn ONLY valid JSON matching the schema."))),
      )
      if (v.success) parsed = v.data
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
  }
  if (!parsed) {
    // The reason carries the real cause (llm-error vs JSON shape) into the
    // extraction_failed metric, so a broken model setup is diagnosable.
    return { ok: false, records: [], newCursor: null, shouldConsolidate: false, reason: (failure || "invalid-json").slice(0, 300) }
  }

  // enforce limits + redact + dedupe
  const limited = parsed.records.slice(0, MAX_RECORDS_PER_TURN)
  const built: LedgerRecord[] = []
  const existingActive = [...active]
  for (const r of limited) {
    const redacted = redactRecordFields({
      kind: "record",
      id: "", // assigned below
      type: r.type,
      text: r.text.slice(0, TEXT_CAP),
      rationale: r.rationale ? redact(r.rationale).slice(0, RATIONALE_CAP) : undefined,
      files: r.files ? r.files.slice(0, FILES_CAP).map((f) => redact(f)) : undefined,
      status: r.status,
      process: r.process
        ? {
            command: redact(r.process.command),
            purpose: redact(r.process.purpose),
            onResult: redact(r.process.onResult),
          }
        : undefined,
      epoch: input.st.epoch,
      userMessageId: userMsg || delta.lastUserMessageId,
      turnMessageId: delta.turnMessageId,
      createdAt: now(),
    } as LedgerRecord)
    // dedupe
    if (isDuplicate({ type: redacted.type, text: redacted.text }, [...existingActive, ...built])) continue
    // assign id
    const id = nextRecordId([...input.lines, ...built.map((b) => b as LedgerLine)], redacted.type)
    built.push({ ...redacted, id })
  }

  const shouldConsolidate =
    active.length + built.length - input.st.consolidatedAtRecordCount >= input.cfg.consolidateAfterRecords

  return {
    ok: true,
    records: built,
    newCursor: delta.turnMessageId,
    shouldConsolidate,
  }
}

function stripFence(s: string): string {
  const trimmed = s.trim()
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/)
  if (fence) return fence[1].trim()
  return trimmed
}

/**
 * Salvages complete records from a truncated extraction response: reasoning
 * models sometimes hit their output cap mid-JSON ("Unexpected EOF"), and
 * keeping the records that survived beats losing the whole attempt. Walks the
 * text with a string-aware brace counter and collects every record object
 * closed before the cut; a partial trailing record is never collected.
 */
export function salvageRecords(text: string): unknown | null {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  const objects: string[] = []
  let recordStart = -1
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === "{") {
      // depth 1 is the root object; a record opens at 1 → 2
      if (depth === 1) recordStart = i
      depth++
      continue
    }
    if (c === "}") {
      depth--
      if (depth === 1 && recordStart >= 0) {
        objects.push(text.slice(recordStart, i + 1))
        recordStart = -1
      }
      if (depth === 0) break
    }
  }
  if (objects.length === 0) return null
  try {
    const records = objects.map((o) => JSON.parse(o))
    return { records }
  } catch {
    return null
  }
}

/** JSON.parse, then the truncation salvage; null when neither yields an object. */
function parseExtractionJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return salvageRecords(text)
  }
}

// ── Consolidation ─────────────────────────────────────────────────────────

export interface ConsolidationInput {
  sid: string
  cfg: RolloverConfig
  st: SessionState
  lines: LedgerLine[]
  llm: LlmPort
  now?: () => number
}

export interface ConsolidationOutput {
  ok: boolean
  invalidations: LedgerLine[]
  reason?: string
}

export async function runConsolidation(input: ConsolidationInput): Promise<ConsolidationOutput> {
  const now = input.now ?? (() => Date.now())
  const active = activeRecords(input.lines)
  const eligible = active.filter((r) => r.type === "decision" || r.type === "user_correction" || r.type === "open_item" || r.type === "verification")

  // snapshot: newest 300, <= 15k tokens
  const sorted = [...eligible].sort((a, b) => b.createdAt - a.createdAt)
  const snapshot: LedgerRecord[] = []
  let tokens = 0
  for (const r of sorted) {
    if (snapshot.length >= 300) break
    const line = `${r.id} | ${r.type} | ${r.epoch} | ${r.text}`
    const cost = Math.ceil(line.length / 4)
    if (tokens + cost > 15000 && snapshot.length > 0) break
    snapshot.push(r)
    tokens += cost
  }
  if (snapshot.length === 0) return { ok: true, invalidations: [] }

  const snapshotIds = new Set(snapshot.map((r) => r.id))
  const correctionIds = new Set(snapshot.filter((r) => r.type === "user_correction").map((r) => r.id))

  const body = snapshot.map((r) => `${r.id} | ${r.type} | ${r.epoch} | ${r.text}`).join("\n")

  let parsed: { invalidate: Array<{ id: string; reason: string; by: string }> } | null = null
  try {
    const res = await input.llm.complete({
      purpose: "consolidation",
      system: CONSOLIDATION_SYSTEM,
      user: body,
      maxOutputTokens: 4000,
      timeoutMs: input.cfg.consolidationTimeoutMs,
      model: input.cfg.extractionModel ?? undefined,
    })
    const text = stripFence(res.text)
    const v = z.object({ invalidate: z.array(z.object({ id: z.string(), reason: z.string(), by: z.string() })) }).safeParse(JSON.parse(text))
    if (v.success) parsed = v.data
  } catch {
    parsed = null
  }
  if (!parsed) return { ok: false, invalidations: [], reason: "invalid-json" }

  const validated = validateConsolidation(parsed, snapshotIds, correctionIds)
  if ("error" in validated) return { ok: false, invalidations: [], reason: validated.error }

  const invalidations: LedgerLine[] = validated.invalidate.map((inv) => ({
    kind: "invalidate" as const,
    id: inv.id,
    reason: inv.reason as "superseded" | "resolved" | "duplicate",
    by: inv.by,
    at: inv.at ?? now(),
  }))
  return { ok: true, invalidations }
}
