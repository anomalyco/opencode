import { Database, eq } from "@/storage/db"
import { MessageTable, PartTable } from "@/session/session.sql"
import { MessageV2 } from "@/session/message-v2"
import type { MessageID } from "@/session/schema"
import { Log } from "@/util/log"
import { PromptCycleTable, PromptCycleInputTable, SessionPromptDocTable, DocSubmitTable, DocSubmitActorTable } from "./doc.sql"
import { CycleID, CycleInputID } from "./schema"
import type { ActorID, DocID } from "./schema"

const log = Log.create({ service: "doc.cycle-recorder" })

// The shape of a message part's JSON `data` payload (the fields the recorder reads).
type PartData = {
  type?: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
  mime?: string
  filename?: string
  url?: string
  metadata?: { actorID?: string; docID?: string }
}

// Read a message's parts once, ordered, as plain data objects.
function partsOf(db: Database.TxOrDb, messageID: MessageID): PartData[] {
  return db
    .select()
    .from(PartTable)
    .where(eq(PartTable.message_id, messageID))
    .orderBy(PartTable.id)
    .all()
    .map((row) => row.data as PartData)
}

// Join verbatim text parts (skipping synthetic/ignored).
function textOf(parts: PartData[]) {
  const out: string[] = []
  for (const p of parts) {
    if (p?.type === "text" && !p.synthetic && !p.ignored && typeof p.text === "string") out.push(p.text)
  }
  return out.join("\n")
}

// Pull the asset id out of a reference URL like `/doc/{docID}/asset/{assetID}` (with an
// optional query/fragment). Prefers the `/asset/<id>` segment; falls back to the last path
// segment. Tolerates trailing slashes and `?`/`#` suffixes.
function assetIdFromUrl(url: string): string | undefined {
  const clean = url.split(/[?#]/)[0]!.replace(/\/+$/, "")
  return clean.match(/\/asset\/([^/]+)$/)?.[1] ?? clean.split("/").pop() ?? undefined
}

// File attachments as lightweight references — never the raw bytes. Inline data: URLs
// (base64 blobs) are recorded as {mime, filename} only; real reference URLs keep url + assetID.
function assetsOf(parts: PartData[]) {
  const out: { assetID?: string; mime: string; filename?: string; url?: string }[] = []
  for (const p of parts) {
    if (p?.type !== "file") continue
    const isData = typeof p.url === "string" && p.url.startsWith("data:")
    out.push({
      mime: p.mime ?? "",
      filename: p.filename,
      ...(isData ? {} : { url: p.url, assetID: p.url ? assetIdFromUrl(p.url) : undefined }),
    })
  }
  return out.length ? out : null
}

// The doc/actor the app stamps onto the prompt's text part metadata.
function metaOf(parts: PartData[]): { actorID: ActorID | null; docID: DocID | null } {
  for (const p of parts) {
    if (p?.type === "text" && p.metadata) {
      return {
        actorID: (p.metadata.actorID as ActorID) ?? null,
        docID: (p.metadata.docID as DocID) ?? null,
      }
    }
  }
  return { actorID: null, docID: null }
}

// Resolve who sent/consented an input, plus consent timing.
//  - multi-party consent (a doc_submit links to this user message) → all its actors
//  - solo doc send (no submit) → the single sender from the message metadata
//  - normal/non-doc prompt → no actor identity at all
function resolveConsent(db: Database.TxOrDb, userMessageID: MessageID, soloActorID: ActorID | null) {
  const submit = db.select().from(DocSubmitTable).where(eq(DocSubmitTable.user_message_id, userMessageID)).get()
  if (submit) {
    const actors = db
      .select({ actor_id: DocSubmitActorTable.actor_id })
      .from(DocSubmitActorTable)
      .where(eq(DocSubmitActorTable.submit_id, submit.id))
      .all()
    const actorIDs = actors.map((a) => a.actor_id)
    return {
      submitID: submit.id,
      actorIDs: actorIDs.length ? actorIDs : null,
      initiatorActorID: submit.actor_id, // whoever created (first pressed send on) the submit
      actorCount: actorIDs.length || 1,
      timeConsented: submit.time_updated,
      consentMs: Math.max(0, submit.time_updated - submit.time_created),
    }
  }
  // Solo: the lone sender is both the only actor and the initiator.
  return {
    submitID: null,
    actorIDs: soloActorID ? [soloActorID] : null,
    initiatorActorID: soloActorID,
    actorCount: 1,
    timeConsented: null,
    consentMs: null,
  }
}

// The assistant message info fields the aggregator reads off MessageTable.data.
type AssistantData = {
  role?: string
  parentID?: string
  cost?: number
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  modelID?: string
  providerID?: string
  time?: { created?: number; completed?: number }
  error?: { name?: string; data?: { message?: string } }
}

/**
 * Record one prompt cycle per user prompt (turn). A single turn can produce several
 * assistant messages (multi-step agent loop); they all share the same parentID (the user
 * message) and are AGGREGATED into one cycle: tokens/cost summed, response texts joined.
 *
 * Runs inside the message-update projector transaction, so it fires for EVERY prompt path
 * (normal / shell / doc). Idempotent: re-derives the whole cycle from all completed steps
 * of the turn each time, so duplicate events converge to the same row.
 *
 * TODO(steer): records only one input (the parent user message). Accumulating several
 * prompts into one run (followup "steer" mode) is planned but not implemented.
 */
export function record(db: Database.TxOrDb, info: MessageV2.Info) {
  if (info.role !== "assistant") return
  if (!info.time.completed) return // only finished steps
  const parentID = info.parentID
  if (!parentID) return // no turn anchor

  const parent = db.select().from(MessageTable).where(eq(MessageTable.id, parentID)).get()
  if (!parent) return

  // All completed assistant steps of this turn (same parent user message), in order.
  const steps = db
    .select()
    .from(MessageTable)
    .where(eq(MessageTable.session_id, info.sessionID))
    .all()
    .map((m) => ({ id: m.id, data: m.data as AssistantData }))
    .filter((m) => m.data?.role === "assistant" && m.data.parentID === parentID && m.data.time?.completed)
    .sort((a, b) => (a.data.time?.created ?? 0) - (b.data.time?.created ?? 0))
  if (steps.length === 0) return

  // Aggregate token/cost across steps; join non-empty response texts in order.
  let tokensInput = 0
  let tokensOutput = 0
  let tokensReasoning = 0
  let tokensCacheRead = 0
  let tokensCacheWrite = 0
  let cost = 0
  const responses: string[] = []
  let aborted = false
  let errorMessage: string | null = null
  for (const s of steps) {
    const tk = s.data.tokens ?? {}
    tokensInput += tk.input ?? 0
    tokensOutput += tk.output ?? 0
    tokensReasoning += tk.reasoning ?? 0
    tokensCacheRead += tk.cache?.read ?? 0
    tokensCacheWrite += tk.cache?.write ?? 0
    cost += s.data.cost ?? 0
    const text = textOf(partsOf(db, s.id as MessageID))
    if (text) responses.push(text)
    if (s.data.error) {
      if (s.data.error.name === "MessageAbortedError") aborted = true
      errorMessage = s.data.error.data?.message ?? s.data.error.name ?? "error"
    }
  }
  const first = steps[0]!
  const last = steps[steps.length - 1]!
  const status = aborted ? "aborted" : errorMessage ? "error" : "completed"

  const parentParts = partsOf(db, parent.id)
  const meta = metaOf(parentParts)
  const consent = resolveConsent(db, parent.id, meta.actorID)
  // docID = the doc the prompt was authored in (part metadata); fall back to the session's
  // current prompt doc for prompts with no doc metadata (normal path).
  const docID =
    meta.docID ??
    (db
      .select({ doc_id: SessionPromptDocTable.doc_id })
      .from(SessionPromptDocTable)
      .where(eq(SessionPromptDocTable.session_id, info.sessionID))
      .get()?.doc_id ??
      null)

  const promptStart = parent.time_created
  // TTFT from when the prompt was actually sent to the AI (consent for a doc submit, else
  // when it was authored) to the first assistant step.
  const ttftStart = consent.timeConsented ?? promptStart
  const outputStart = first.data.time?.created ?? info.time.created

  const cycleValues = {
    session_id: info.sessionID,
    user_message_id: parentID,
    time_created: promptStart,
    assistant_message_id: last.id,
    response: responses.join("\n\n"),
    model_id: last.data.modelID ?? info.modelID,
    provider_id: last.data.providerID ?? info.providerID,
    time_output_start: outputStart,
    time_completed: last.data.time?.completed ?? info.time.completed ?? null,
    ttft_ms: Math.max(0, outputStart - ttftStart),
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    tokens_reasoning: tokensReasoning,
    tokens_cache_read: tokensCacheRead,
    tokens_cache_write: tokensCacheWrite,
    cost_total: cost,
    status,
    aborted,
    error: errorMessage,
  }

  const existing = db
    .select({ id: PromptCycleTable.id })
    .from(PromptCycleTable)
    .where(eq(PromptCycleTable.user_message_id, parentID))
    .get()

  if (existing) {
    db.update(PromptCycleTable).set(cycleValues).where(eq(PromptCycleTable.id, existing.id)).run()
    log.info("updated cycle", { cycleID: existing.id, session: info.sessionID, steps: steps.length, status })
    return
  }

  const cycleID = CycleID.ascending()
  db.insert(PromptCycleTable)
    .values({ id: cycleID, ...cycleValues })
    .run()
  db.insert(PromptCycleInputTable)
    .values({
      id: CycleInputID.ascending(),
      cycle_id: cycleID,
      session_id: info.sessionID,
      doc_id: docID,
      submit_id: consent.submitID,
      actor_ids: consent.actorIDs,
      initiator_actor_id: consent.initiatorActorID,
      actor_count: consent.actorCount,
      seq: 0,
      prompt: textOf(parentParts),
      assets: assetsOf(parentParts),
      user_message_id: parent.id,
      time_created: parent.time_created,
      time_consented: consent.timeConsented,
      consent_ms: consent.consentMs,
    })
    .run()
  log.info("recorded cycle", { cycleID, session: info.sessionID, steps: steps.length, status })
}
