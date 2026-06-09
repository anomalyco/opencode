import { eq, and, desc, inArray } from "drizzle-orm"
import z from "zod"
import { ulid } from "ulid"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { Database, NotFoundError } from "@/storage/db"
import { fn } from "@/util/fn"
import { NamedError } from "@opencode-ai/util/error"
import * as Room from "./room"
import { MSG_DOC, pack, unpack } from "./wire"
import {
  DocAssetTable,
  DocSubmitActorTable,
  DocSubmitTable,
  DocTable,
  DocUpdateTable,
  PromptCycleTable,
  PromptCycleInputTable,
  SessionActorTable,
  SessionPromptDocTable,
} from "./doc.sql"
import { ActorID, AssetID, CycleID, CycleInputID, DocID, SubmitID } from "./schema"

export namespace Doc {
  const COLORS = [
    "#e03131",
    "#c2255c",
    "#9c36b5",
    "#6741d9",
    "#3b5bdb",
    "#1971c2",
    "#0c8599",
    "#099268",
    "#2f9e44",
    "#66a80f",
    "#f08c00",
    "#e8590c",
  ]

  // How recently an actor must have been seen to "reserve" its color. Keeps the palette collision-free
  // among currently-active participants without ancient/test actors permanently consuming colors.
  const COLOR_WINDOW = 60 * 60 * 1000

  function color(id: string) {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
    return COLORS[Math.abs(h) % COLORS.length]!
  }

  // Choose a presence color so concurrent participants are visually distinct (dots/avatars).
  // - Keep `current` if it doesn't collide with another recently-active actor (stable across reconnects).
  // - Otherwise move to a free palette color (heals a pre-existing hash collision when one reconnects).
  // - Collision-free up to COLORS.length (12) active participants; beyond that, fall back to the stable
  //   hash color. The "recently active" window keeps stale/historical actors from hogging the palette.
  function pickColor(sessionID: SessionID, selfActorID: ActorID, current?: string) {
    const now = Date.now()
    const used = new Set(
      Database.use((db) => db.select().from(SessionActorTable).where(eq(SessionActorTable.session_id, sessionID)).all())
        .filter((row) => row.actor_id !== selfActorID && now - row.time_seen < COLOR_WINDOW)
        .map((row) => row.color),
    )
    if (current && !used.has(current)) return current
    return COLORS.find((item) => !used.has(item)) ?? current ?? color(selfActorID)
  }

  export const ActorInfo = z
    .object({
      actorID: ActorID.zod,
      sessionID: SessionID.zod,
      userID: z.string().optional(),
      name: z.string(),
      color: z.string(),
    })
    .meta({ ref: "SessionActor" })
  export type ActorInfo = z.infer<typeof ActorInfo>

  export const CycleAsset = z.object({
    assetID: z.string().optional(),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string().optional(), // omitted for inline data: attachments (blob not stored)
  })
  export type CycleAsset = z.infer<typeof CycleAsset>

  export const CycleStatus = z.enum(["running", "completed", "aborted", "error"]).meta({ ref: "PromptCycleStatus" })
  export type CycleStatus = z.infer<typeof CycleStatus>

  // One consented prompt that fed a cycle's run. Prompt text is verbatim, never summarized.
  export const CycleInput = z
    .object({
      id: CycleInputID.zod,
      docID: DocID.zod.nullable(), // null for non-doc prompts
      submitID: SubmitID.zod.nullable(),
      // [self] for a solo doc send, [a,b,...] for multi-party consent, null for normal prompts.
      actorIDs: z.array(ActorID.zod).nullable(),
      // Who pressed send: submit creator (multi-party) or the lone sender (solo); null for normal.
      initiatorActorID: ActorID.zod.nullable(),
      seq: z.number(),
      prompt: z.string(),
      assets: z.array(CycleAsset).nullable(),
      actorCount: z.number(),
      userMessageID: z.string().nullable(),
      timeCreated: z.number(),
      timeConsented: z.number().nullable(), // doc mode only
      consentMs: z.number().nullable(), // doc mode only
    })
    .meta({ ref: "PromptCycleInput" })
  export type CycleInput = z.infer<typeof CycleInput>

  // A full AI run: the input prompt(s) through to one reply (or stop). Token/cost are the
  // run's single total. `inputs` currently always holds exactly one item; it is an array to
  // later support followup "steer" mode (several prompts in one run) — not implemented yet.
  // docID lives per-input (inputs[].docID), not on the run.
  export const Cycle = z
    .object({
      id: CycleID.zod,
      sessionID: SessionID.zod,
      timeCreated: z.number(),
      inputs: z.array(CycleInput),
      // output
      assistantMessageID: z.string().nullable(),
      response: z.string().nullable(),
      modelID: z.string().nullable(),
      providerID: z.string().nullable(),
      timeOutputStart: z.number().nullable(),
      timeCompleted: z.number().nullable(),
      ttftMs: z.number().nullable(),
      // tokens & cost
      tokensInput: z.number().nullable(),
      tokensOutput: z.number().nullable(),
      tokensReasoning: z.number().nullable(),
      tokensCacheRead: z.number().nullable(),
      tokensCacheWrite: z.number().nullable(),
      costTotal: z.number().nullable(),
      // status
      status: CycleStatus,
      aborted: z.boolean(),
      error: z.string().nullable(),
    })
    .meta({ ref: "PromptCycle" })
  export type Cycle = z.infer<typeof Cycle>

  function inputFromRow(row: typeof PromptCycleInputTable.$inferSelect): CycleInput {
    return {
      id: row.id,
      docID: row.doc_id ?? null,
      submitID: row.submit_id ?? null,
      actorIDs: (row.actor_ids as ActorID[] | null) ?? null,
      initiatorActorID: row.initiator_actor_id ?? null,
      seq: row.seq,
      prompt: row.prompt,
      assets: (row.assets as CycleAsset[] | null) ?? null,
      actorCount: row.actor_count,
      userMessageID: row.user_message_id ?? null,
      timeCreated: row.time_created,
      timeConsented: row.time_consented ?? null,
      consentMs: row.consent_ms ?? null,
    }
  }

  function cycleFromRow(row: typeof PromptCycleTable.$inferSelect, inputs: CycleInput[]): Cycle {
    return {
      id: row.id,
      sessionID: row.session_id,
      timeCreated: row.time_created,
      inputs,
      assistantMessageID: row.assistant_message_id ?? null,
      response: row.response ?? null,
      modelID: row.model_id ?? null,
      providerID: row.provider_id ?? null,
      timeOutputStart: row.time_output_start ?? null,
      timeCompleted: row.time_completed ?? null,
      ttftMs: row.ttft_ms ?? null,
      tokensInput: row.tokens_input ?? null,
      tokensOutput: row.tokens_output ?? null,
      tokensReasoning: row.tokens_reasoning ?? null,
      tokensCacheRead: row.tokens_cache_read ?? null,
      tokensCacheWrite: row.tokens_cache_write ?? null,
      costTotal: row.cost_total ?? null,
      status: CycleStatus.parse(row.status),
      aborted: row.aborted,
      error: row.error ?? null,
    }
  }

  export const CycleListInput = z.object({
    sessionID: SessionID.zod.optional(),
    docID: DocID.zod.optional(),
    status: CycleStatus.optional(),
    limit: z.coerce.number().min(1).max(500).optional(),
    offset: z.coerce.number().min(0).optional(),
  })

  // Return whole prompt cycles (with their inputs), newest first. Text is returned verbatim.
  export const cycleList = fn(CycleListInput, (input) => {
    return Database.use((db) => {
      const filters = [
        input.sessionID ? eq(PromptCycleTable.session_id, input.sessionID) : undefined,
        // docID is per-input now: match runs that have any input authored in that doc.
        input.docID
          ? inArray(
              PromptCycleTable.id,
              db
                .select({ id: PromptCycleInputTable.cycle_id })
                .from(PromptCycleInputTable)
                .where(eq(PromptCycleInputTable.doc_id, input.docID)),
            )
          : undefined,
        input.status ? eq(PromptCycleTable.status, input.status) : undefined,
      ].filter(Boolean)
      const rows = db
        .select()
        .from(PromptCycleTable)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(PromptCycleTable.time_created))
        .limit(input.limit ?? 100)
        .offset(input.offset ?? 0)
        .all()
      return rows.map((row) => {
        const inputs = db
          .select()
          .from(PromptCycleInputTable)
          .where(eq(PromptCycleInputTable.cycle_id, row.id))
          .orderBy(PromptCycleInputTable.seq)
          .all()
          .map(inputFromRow)
        return cycleFromRow(row, inputs)
      })
    })
  })

  // Return a single prompt cycle (with its inputs), or null if not found. Text is verbatim.
  export const cycleGet = fn(z.object({ cycleID: CycleID.zod }), (input) =>
    Database.use((db) => {
      const row = db.select().from(PromptCycleTable).where(eq(PromptCycleTable.id, input.cycleID)).get()
      if (!row) return null
      const inputs = db
        .select()
        .from(PromptCycleInputTable)
        .where(eq(PromptCycleInputTable.cycle_id, row.id))
        .orderBy(PromptCycleInputTable.seq)
        .all()
        .map(inputFromRow)
      return cycleFromRow(row, inputs)
    }),
  )

  export const PromptDocInfo = z
    .object({
      docID: DocID.zod,
      sessionID: SessionID.zod,
    })
    .meta({ ref: "SessionPromptDoc" })
  export type PromptDocInfo = z.infer<typeof PromptDocInfo>

  export const AssetInfo = z
    .object({
      assetID: AssetID.zod,
      docID: DocID.zod,
      mime: z.string(),
      size: z.number(),
      url: z.string(),
    })
    .meta({ ref: "DocAsset" })
  export type AssetInfo = z.infer<typeof AssetInfo>

  export const PromptDocRotated = BusEvent.define(
    "doc.prompt.rotated",
    z.object({
      sessionID: SessionID.zod,
      docID: DocID.zod,
      clientID: z.string().optional(),
      init: z.boolean().optional(),
    }),
  )

  function loadUpdates(id: DocID) {
    const rows = Database.use((db) =>
      db.select().from(DocUpdateTable).where(eq(DocUpdateTable.doc_id, id)).orderBy(DocUpdateTable.time_created).all(),
    )
    for (const row of rows) {
      const raw = row.data
      const data =
        raw instanceof Uint8Array ? new Uint8Array(raw) : new Uint8Array(Buffer.from(raw as Buffer))
      const msg = unpack(data)
      if (msg?.type === MSG_DOC) {
        Room.apply(id, msg.guid, msg.data)
        continue
      }
      Room.apply(id, id, data)
    }
  }

  function ensureLoaded(id: DocID) {
    loadUpdates(id)
  }

  export const prompt = fn(SessionID.zod, (sessionID) => {
    const existing = Database.use((db) =>
      db.select().from(SessionPromptDocTable).where(eq(SessionPromptDocTable.session_id, sessionID)).get(),
    )
    if (existing) {
      ensureLoaded(existing.doc_id)
      return { docID: existing.doc_id, sessionID }
    }

    const docID = DocID.ascending()
    Database.use((db) => {
      db.insert(DocTable).values({ id: docID, kind: "prompt" }).run()
      db.insert(SessionPromptDocTable).values({ session_id: sessionID, doc_id: docID }).run()
    })
    return { docID, sessionID }
  })

  export const promptAdvance = fn(
    z.object({
      sessionID: SessionID.zod,
      clientID: z.string().optional(),
    }),
    (input) => {
      const sessionID = input.sessionID
      Session.get(sessionID)
      const docID = DocID.ascending()
      Database.use((db) => {
        db.insert(DocTable).values({ id: docID, kind: "prompt" }).run()
      })
      return { docID, sessionID }
    },
  )

  export const promptReady = fn(
    z.object({
      sessionID: SessionID.zod,
      docID: DocID.zod,
      clientID: z.string().optional(),
      init: z.boolean().optional(),
    }),
    (input) => {
      Session.get(input.sessionID)
      get(input.docID)
      Database.use((db) => {
        db
          .insert(SessionPromptDocTable)
          .values({ session_id: input.sessionID, doc_id: input.docID })
          .onConflictDoUpdate({
            target: SessionPromptDocTable.session_id,
            set: { doc_id: input.docID },
          })
          .run()
      })
      Bus.publish(Doc.PromptDocRotated, {
        sessionID: input.sessionID,
        docID: input.docID,
        clientID: input.clientID,
        init: input.init,
      })
      return { docID: input.docID, sessionID: input.sessionID }
    },
  )

  export const get = fn(DocID.zod, (id) => {
    const row = Database.use((db) => db.select().from(DocTable).where(eq(DocTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: "Doc not found" })
    ensureLoaded(id)
    return row
  })

  export const syncPull = fn(
    z.object({
      docID: DocID.zod,
      guid: z.string(),
      state: z.instanceof(Uint8Array),
    }),
    (input) => {
      get(input.docID)
      return Room.pull(input.docID, input.guid, input.state)
    },
  )

  export const syncPush = fn(
    z.object({
      docID: DocID.zod,
      guid: z.string(),
      data: z.instanceof(Uint8Array),
      peer: z.custom<Room.Peer>().optional(),
    }),
    (input) => {
      get(input.docID)
      const blob = pack(MSG_DOC, input.guid, input.data)
      Room.push(input.docID, input.guid, input.data, input.peer)
      const id = ulid()
      Database.use((db) =>
        db
          .insert(DocUpdateTable)
          .values({
            id,
            doc_id: input.docID,
            data: blob,
          })
          .run(),
      )
    },
  )

  export const assetCreate = fn(
    z.object({
      docID: DocID.zod,
      assetID: AssetID.zod.optional(),
      mime: z.string(),
      data: z.instanceof(Uint8Array),
    }),
    (input) => {
      get(input.docID)
      const assetID = input.assetID ?? AssetID.ascending()
      Database.use((db) =>
        db
          .insert(DocAssetTable)
          .values({
            id: assetID,
            doc_id: input.docID,
            mime: input.mime,
            data: input.data,
            size: input.data.byteLength,
          })
          .onConflictDoUpdate({
            target: [DocAssetTable.doc_id, DocAssetTable.id],
            set: {
              mime: input.mime,
              data: input.data,
              size: input.data.byteLength,
            },
          })
          .run(),
      )
      return {
        assetID,
        docID: input.docID,
        mime: input.mime,
        size: input.data.byteLength,
        url: `/doc/${input.docID}/asset/${assetID}`,
      }
    },
  )

  export const assetGet = fn(
    z.object({
      docID: DocID.zod,
      assetID: AssetID.zod,
    }),
    (input) => {
      get(input.docID)
      const row = Database.use((db) =>
        db
          .select()
          .from(DocAssetTable)
          .where(and(eq(DocAssetTable.doc_id, input.docID), eq(DocAssetTable.id, input.assetID)))
          .get(),
      )
      if (!row) throw new NotFoundError({ message: "Doc asset not found" })
      const raw = row.data
      return {
        assetID: row.id,
        docID: row.doc_id,
        mime: row.mime,
        data: raw instanceof Uint8Array ? new Uint8Array(raw) : new Uint8Array(Buffer.from(raw as Buffer)),
        size: row.size,
      }
    },
  )

  const DEFAULT = 120_000
  const MIN = 10_000
  const MAX = 600_000
  const MAX_NAME = 64
  // How long after a submit resolves we still replay its terminal state to a (re)connecting
  // participant, so a client that blipped offline exactly at the transition can catch up.
  const REPLAY_WINDOW = 15_000
  const SubmitPrompt = SessionPrompt.PromptInput.omit({ sessionID: true })
  const SubmitActorStatus = z.enum(["pending", "approved"])
  export const SubmitStatus = z.enum(["pending", "sent", "cancelled", "expired", "left"]).meta({ ref: "DocSubmitStatus" })
  export type SubmitStatus = z.infer<typeof SubmitStatus>

  export const SubmitActorInfo = z
    .object({
      actorID: ActorID.zod,
      name: z.string(),
      status: SubmitActorStatus,
    })
    .meta({ ref: "DocSubmitActor" })
  export type SubmitActorInfo = z.infer<typeof SubmitActorInfo>

  // What a consent vote acts on once approved: a prompt doc, or an AI question (reply/reject).
  export const SubmitTargetKind = z.enum(["doc", "question"]).meta({ ref: "DocSubmitTargetKind" })
  export type SubmitTargetKind = z.infer<typeof SubmitTargetKind>

  export const SubmitState = z
    .object({
      submitID: SubmitID.zod,
      sessionID: SessionID.zod,
      // 'doc' → targetID is the prompt doc id; 'question' → targetID is the question request id.
      targetKind: SubmitTargetKind,
      targetID: z.string(),
      // For 'question' votes: whether this vote sends a reply or dismisses the question — lets every
      // participant (not just the requester) see the right dialog copy.
      questionAction: z.enum(["send", "dismiss"]).optional(),
      actorID: ActorID.zod,
      status: SubmitStatus,
      actors: SubmitActorInfo.array(),
      cancelledBy: SubmitActorInfo.optional(),
      timeoutMs: z.number(),
      expiresAt: z.number(),
    })
    .meta({ ref: "DocSubmit" })
  export type SubmitState = z.infer<typeof SubmitState>

  export const SubmitEvent = z
    .object({
      type: z.enum(["created", "updated", "sent", "cancelled", "expired", "left"]),
      state: SubmitState,
    })
    .meta({ ref: "DocSubmitEvent" })
  export type SubmitEvent = z.infer<typeof SubmitEvent>

  // The payload persisted in doc_submit.prompt for a 'question' vote: either a reply (answers per
  // question) or a close vote (reject). Mirrors the SessionPrompt blob used for 'doc' votes.
  export const QuestionPayload = z.object({
    requestID: z.string(),
    answers: z.array(z.array(z.string())).optional(),
    reject: z.boolean().optional(),
  })
  export type QuestionPayload = z.infer<typeof QuestionPayload>

  export const SubmitCreateInput = z.object({
    sessionID: SessionID.zod,
    docID: DocID.zod,
    actorID: ActorID.zod,
    actorIDs: ActorID.zod.array(),
    names: z.record(z.string(), z.string()).optional(),
    prompt: SubmitPrompt,
    timeoutMs: z.number().optional(),
  })

  export const QuestionSubmitCreateInput = z.object({
    sessionID: SessionID.zod,
    requestID: z.string(),
    actorID: ActorID.zod,
    actorIDs: ActorID.zod.array(),
    names: z.record(z.string(), z.string()).optional(),
    payload: QuestionPayload,
    timeoutMs: z.number().optional(),
  })

  export const SubmitRespondInput = z.object({
    sessionID: SessionID.zod,
    submitID: SubmitID.zod,
    actorID: ActorID.zod,
    action: z.enum(["approve", "cancel"]),
  })

  type SubmitRow = typeof DocSubmitTable.$inferSelect
  type SubmitPeer = {
    actorID: ActorID
    send: (data: string) => void
  }

  const LEAVE_GRACE = 2_000
  // Keyed by targetID (doc id or question request id) — the single routing key for a vote's peers.
  const peers = new Map<string, Set<SubmitPeer>>()
  const timers = new Map<SubmitID, ReturnType<typeof setTimeout>>()
  const leaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function clamp(input?: number) {
    if (input === undefined) return DEFAULT
    return Math.min(MAX, Math.max(MIN, input))
  }

  function fallback(id: ActorID) {
    return `Guest-${id.slice(-4)}`
  }

  function cap(name: string) {
    return name.trim().slice(0, MAX_NAME)
  }

  function read(row: SubmitRow) {
    const actors = Database.use((db) =>
      db.select().from(DocSubmitActorTable).where(eq(DocSubmitActorTable.submit_id, row.id)).all(),
    ).map((item) => ({
      actorID: item.actor_id,
      name: item.name,
      status: SubmitActorStatus.parse(item.status),
    }))
    const questionAction: "send" | "dismiss" | undefined =
      row.target_kind === "question"
        ? QuestionPayload.safeParse(JSON.parse(row.prompt)).data?.reject
          ? "dismiss"
          : "send"
        : undefined
    return {
      submitID: row.id,
      sessionID: row.session_id,
      targetKind: SubmitTargetKind.parse(row.target_kind),
      targetID: row.target_id,
      questionAction,
      actorID: row.actor_id,
      status: SubmitStatus.parse(row.status),
      actors,
      cancelledBy: row.cancelled_by ? actors.find((item) => item.actorID === row.cancelled_by) : undefined,
      timeoutMs: row.timeout_ms,
      expiresAt: row.expires_at,
    }
  }

  function cast(type: SubmitEvent["type"], state: SubmitState) {
    const set = peers.get(state.targetID)
    if (!set) return
    const ids = new Set(state.actors.map((actor) => actor.actorID))
    const data = JSON.stringify({ type, state } satisfies SubmitEvent)
    set.forEach((peer) => {
      if (ids.has(peer.actorID)) peer.send(data)
    })
  }

  function done(id: SubmitID) {
    const timer = timers.get(id)
    if (!timer) return
    clearTimeout(timer)
    timers.delete(id)
  }

  function fail(row: SubmitRow, err: unknown) {
    Bus.publish(Session.Event.Error, {
      sessionID: row.session_id,
      error: new NamedError.Unknown({ message: err instanceof Error ? err.message : String(err) }).toObject(),
    })
  }

  function rotate(row: SubmitRow) {
    const next = promptAdvance({ sessionID: row.session_id })
    promptReady({ sessionID: row.session_id, docID: next.docID, init: true })
  }

  function send(row: SubmitRow) {
    if (row.target_kind === "question") {
      const payload = QuestionPayload.parse(JSON.parse(row.prompt))
      const requestID = QuestionID.make(payload.requestID)
      const run = payload.reject ? Question.reject(requestID) : Question.reply({ requestID, answers: payload.answers ?? [] })
      run.catch((err) => fail(row, err))
      questionDraftReset(payload.requestID)
      return
    }
    const body = SubmitPrompt.parse(JSON.parse(row.prompt))
    // Cycle recording happens centrally in the cycle recorder (subscribes to assistant
    // message completion), so it covers normal/shell prompts too — not just doc submits.
    SessionPrompt.prompt({
      ...body,
      noReply: true,
      sessionID: row.session_id,
    })
      .then((message) => {
        rotate(row)
        // Link the produced user message back to this submit so the recorder can resolve
        // the consenting actors (doc_submit_actor) when it records the cycle.
        if (message?.info?.id)
          Database.use((db) =>
            db
              .update(DocSubmitTable)
              .set({ user_message_id: message.info.id })
              .where(eq(DocSubmitTable.id, row.id))
              .run(),
          )
        if (body.noReply === true) return
        return SessionPrompt.loop({ sessionID: row.session_id })
      })
      .catch((err) => fail(row, err))
  }

  function expire(row: SubmitRow, now = Date.now()) {
    if (row.status !== "pending") return row
    if (row.expires_at > now) return row
    const next = Database.use((db) =>
      db
        .update(DocSubmitTable)
        .set({ status: "expired", time_updated: now })
        .where(eq(DocSubmitTable.id, row.id))
        .returning()
        .get(),
    )
    done(row.id)
    if (!next) return row
    cast("expired", read(next))
    return next
  }

  function active(sessionID: SessionID, targetID: string, actorID?: ActorID) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(DocSubmitTable)
        .where(
          and(
            eq(DocSubmitTable.session_id, sessionID),
            eq(DocSubmitTable.target_id, targetID),
            eq(DocSubmitTable.status, "pending"),
          ),
        )
        .all(),
    )
    const state = rows
      .map((row) => {
        const next = expire(row)
        if (next.status === "pending" && !timers.has(next.id)) schedule(next)
        return read(next)
      })
      .find((item) => item.status === "pending" && (!actorID || item.actors.some((actor) => actor.actorID === actorID)))
    return state
  }

  function recent(sessionID: SessionID, targetID: string, actorID: ActorID, now = Date.now()) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(DocSubmitTable)
        .where(and(eq(DocSubmitTable.session_id, sessionID), eq(DocSubmitTable.target_id, targetID)))
        .orderBy(desc(DocSubmitTable.time_updated))
        .all(),
    )
    for (const row of rows) {
      if (row.status === "pending") continue
      if (row.time_updated < now - REPLAY_WINDOW) return
      const state = read(row)
      if (state.actors.some((actor) => actor.actorID === actorID)) return state
    }
    return
  }

  function schedule(row: SubmitRow) {
    done(row.id)
    if (row.status !== "pending") return
    const wait = row.expires_at - Date.now()
    if (wait <= 0) {
      expire(row)
      return
    }
    timers.set(
      row.id,
      setTimeout(() => {
        const next = Database.use((db) => db.select().from(DocSubmitTable).where(eq(DocSubmitTable.id, row.id)).get())
        if (next) expire(next)
      }, wait),
    )
  }

  // Re-establish in-memory state after a process restart: the DB is the source of truth, but the
  // expiry timers live only in memory. Expire any pending submit whose deadline already passed and
  // reschedule the timer for the rest, so recovery no longer depends on someone happening to read.
  export function recover() {
    const rows = Database.use((db) =>
      db.select().from(DocSubmitTable).where(eq(DocSubmitTable.status, "pending")).all(),
    )
    for (const row of rows) {
      const next = expire(row)
      if (next.status === "pending") schedule(next)
    }
    // GC a question's shared draft/presence when it resolves outside the vote path (e.g. the AI
    // tool times out, or a solo participant auto-replies). The vote path GCs in send() directly.
    Bus.subscribe(Question.Event.Replied, async (event) => questionDraftReset(String(event.properties.requestID)))
    Bus.subscribe(Question.Event.Rejected, async (event) => questionDraftReset(String(event.properties.requestID)))
  }

  function actorNames(sessionID: SessionID, ids: ActorID[], names?: Record<string, string>) {
    const actors = Database.use((db) =>
      db.select().from(SessionActorTable).where(eq(SessionActorTable.session_id, sessionID)).all(),
    )
    return ids.map((id) => {
      const provided = names?.[id] ? cap(names[id]!) : ""
      if (provided) return { actorID: id, name: provided }
      return {
        actorID: id,
        name: actors.find((actor) => actor.actor_id === id)?.name ?? fallback(id),
      }
    })
  }

  function targets(targetID: string, actorID: ActorID, allow?: ActorID[]) {
    // Connected submit peers are the reachability source of truth (same set as cast()/leave()), so a
    // vote never targets someone we cannot reach. When the requester provides `allow` — the
    // collaborators it actually sees via awareness/presence — we intersect with it so STALE peers
    // (e.g. a half-open socket from a refreshed/HMR'd tab that lingers in the map but is no longer a
    // real participant) cannot join the vote and block consensus by never responding. The requester
    // is always included, even if its own socket has not finished connecting yet.
    const online = new Set(Array.from(peers.get(targetID) ?? []).map((peer) => peer.actorID))
    const ids = allow && allow.length ? allow.filter((id) => online.has(id)) : Array.from(online)
    const result = new Set(ids)
    result.add(actorID)
    return Array.from(result)
  }

  // Shared core for both 'doc' and 'question' votes. `promptBlob` is the persisted payload
  // (a SessionPrompt for doc, a QuestionPayload for question); `docID` is set only for doc votes.
  function create(input: {
    sessionID: SessionID
    targetKind: SubmitTargetKind
    targetID: string
    docID: DocID | null
    actorID: ActorID
    actorIDs: ActorID[]
    names?: Record<string, string>
    promptBlob: string
    timeoutMs?: number
  }) {
    const found = active(input.sessionID, input.targetID)
    if (found) return found

    const ids = targets(input.targetID, input.actorID, input.actorIDs)
    const timeout = clamp(input.timeoutMs)
    const now = Date.now()
    const build = () =>
      Database.transaction((db) => {
        const submit = {
          id: SubmitID.ascending(),
          session_id: input.sessionID,
          target_kind: input.targetKind,
          target_id: input.targetID,
          doc_id: input.docID,
          actor_id: input.actorID,
          status: ids.length <= 1 ? "sent" : "pending",
          prompt: input.promptBlob,
          timeout_ms: timeout,
          expires_at: now + timeout,
          cancelled_by: null,
          user_message_id: null,
          time_created: now,
          time_updated: now,
        }
        db.insert(DocSubmitTable).values(submit).run()
        db.insert(DocSubmitActorTable)
          .values(
            actorNames(input.sessionID, ids, input.names).map((actor) => ({
              submit_id: submit.id,
              actor_id: actor.actorID,
              name: actor.name,
              status: actor.actorID === input.actorID ? "approved" : "pending",
              time_responded: actor.actorID === input.actorID ? now : null,
            })),
          )
          .run()
        return submit
      })

    let row: SubmitRow
    try {
      row = build()
    } catch (err) {
      // Two participants pressed send at the same instant: the pending unique index
      // rejected the loser. Return whoever won rather than surfacing a DB error.
      const winner = active(input.sessionID, input.targetID)
      if (winner) return winner
      throw err
    }

    const state = read(row)
    if (state.status === "sent") {
      cast("sent", state)
      send(row)
      return state
    }
    schedule(row)
    cast("created", state)
    return state
  }

  export const submitCreate = fn(SubmitCreateInput, (input) => {
    Session.get(input.sessionID)
    get(input.docID)
    return create({
      sessionID: input.sessionID,
      targetKind: "doc",
      targetID: input.docID,
      docID: input.docID,
      actorID: input.actorID,
      actorIDs: input.actorIDs,
      names: input.names,
      promptBlob: JSON.stringify(input.prompt),
      timeoutMs: input.timeoutMs,
    })
  })

  export const questionSubmitCreate = fn(QuestionSubmitCreateInput, (input) => {
    Session.get(input.sessionID)
    return create({
      sessionID: input.sessionID,
      targetKind: "question",
      targetID: input.requestID,
      docID: null,
      actorID: input.actorID,
      actorIDs: input.actorIDs,
      names: input.names,
      promptBlob: JSON.stringify(input.payload),
      timeoutMs: input.timeoutMs,
    })
  })

  export const submitRespond = fn(SubmitRespondInput, (input) => {
    const row = Database.use((db) =>
      db
        .select()
        .from(DocSubmitTable)
        .where(and(eq(DocSubmitTable.session_id, input.sessionID), eq(DocSubmitTable.id, input.submitID)))
        .get(),
    )
    if (!row) throw new NotFoundError({ message: "Doc submit not found" })
    const next = expire(row)
    if (next.status !== "pending") return read(next)

    const actor = Database.use((db) =>
      db
        .select()
        .from(DocSubmitActorTable)
        .where(and(eq(DocSubmitActorTable.submit_id, input.submitID), eq(DocSubmitActorTable.actor_id, input.actorID)))
        .get(),
    )
    if (!actor) throw new NotFoundError({ message: "Doc submit actor not found" })

    if (input.action === "cancel") {
      const item = Database.use((db) =>
        db
          .update(DocSubmitTable)
          .set({ status: "cancelled", cancelled_by: input.actorID, time_updated: Date.now() })
          .where(eq(DocSubmitTable.id, input.submitID))
          .returning()
          .get(),
      )
      if (!item) throw new NotFoundError({ message: "Doc submit not found" })
      done(input.submitID)
      const state = read(item)
      cast("cancelled", state)
      return state
    }

    if (actor.status !== "approved") {
      Database.use((db) =>
        db
          .update(DocSubmitActorTable)
          .set({ status: "approved", time_responded: Date.now() })
          .where(and(eq(DocSubmitActorTable.submit_id, input.submitID), eq(DocSubmitActorTable.actor_id, input.actorID)))
          .run(),
      )
    }

    const state = read(next)
    if (state.actors.some((item) => item.status !== "approved")) {
      cast("updated", state)
      return state
    }

    const sent = Database.use((db) =>
      db
        .update(DocSubmitTable)
        .set({ status: "sent", time_updated: Date.now() })
        .where(eq(DocSubmitTable.id, input.submitID))
        .returning()
        .get(),
    )
    if (!sent) throw new NotFoundError({ message: "Doc submit not found" })
    done(input.submitID)
    const finished = read(sent)
    cast("sent", finished)
    send(sent)
    return finished
  })

  function leave(targetID: string, actorID: ActorID) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(DocSubmitTable)
        .where(and(eq(DocSubmitTable.target_id, targetID), eq(DocSubmitTable.status, "pending")))
        .all(),
    )
    for (const row of rows) {
      const next = expire(row)
      if (next.status !== "pending") continue
      const state = read(next)
      if (!state.actors.some((item) => item.actorID === actorID)) continue
      const item = Database.use((db) =>
        db
          .update(DocSubmitTable)
          .set({ status: "left", cancelled_by: actorID, time_updated: Date.now() })
          .where(eq(DocSubmitTable.id, next.id))
          .returning()
          .get(),
      )
      if (!item) continue
      done(next.id)
      cast("left", read(item))
    }
  }

  function leaveKey(targetID: string, actorID: ActorID) {
    return `${targetID}:${actorID}`
  }

  function cancelLeave(targetID: string, actorID: ActorID) {
    const key = leaveKey(targetID, actorID)
    const timer = leaveTimers.get(key)
    if (!timer) return
    clearTimeout(timer)
    leaveTimers.delete(key)
  }

  function scheduleLeave(targetID: string, actorID: ActorID) {
    cancelLeave(targetID, actorID)
    const key = leaveKey(targetID, actorID)
    leaveTimers.set(
      key,
      setTimeout(() => {
        leaveTimers.delete(key)
        const set = peers.get(targetID)
        const online = set ? Array.from(set).some((item) => item.actorID === actorID) : false
        if (online) return
        leave(targetID, actorID)
      }, LEAVE_GRACE),
    )
  }

  export const submitActive = fn(
    z.object({
      sessionID: SessionID.zod,
      docID: DocID.zod,
      actorID: ActorID.zod,
    }),
    (input) => active(input.sessionID, input.docID, input.actorID),
  )

  export const questionSubmitActive = fn(
    z.object({
      sessionID: SessionID.zod,
      requestID: z.string(),
      actorID: ActorID.zod,
    }),
    (input) => active(input.sessionID, input.requestID, input.actorID),
  )

  // Shared peer-attach core. `targetID` routes casts/leaves; the caller validates the target first.
  function connect(input: {
    sessionID: SessionID
    targetID: string
    actorID: ActorID
    peer: { send: (data: string) => void }
  }) {
    const peer = { actorID: input.actorID, send: input.peer.send }
    const set = peers.get(input.targetID) ?? new Set<SubmitPeer>()
    set.add(peer)
    peers.set(input.targetID, set)
    cancelLeave(input.targetID, input.actorID)
    const state = active(input.sessionID, input.targetID, input.actorID)
    if (state) {
      peer.send(JSON.stringify({ type: "created", state } satisfies SubmitEvent))
    } else {
      // No live vote — but if one resolved moments ago, replay its terminal state so a
      // client that missed the cast() (e.g. reconnected just after) can update its dialog.
      const last = recent(input.sessionID, input.targetID, input.actorID)
      if (last) peer.send(JSON.stringify({ type: last.status as SubmitEvent["type"], state: last } satisfies SubmitEvent))
    }
    return () => {
      set.delete(peer)
      if (!Array.from(set).some((item) => item.actorID === peer.actorID)) scheduleLeave(input.targetID, peer.actorID)
      if (set.size === 0) peers.delete(input.targetID)
    }
  }

  export const submitConnect = fn(
    z.object({
      sessionID: SessionID.zod,
      docID: DocID.zod,
      actorID: ActorID.zod,
      peer: z.custom<{ send: (data: string) => void }>(),
    }),
    (input) => {
      Session.get(input.sessionID)
      get(input.docID)
      return connect({ sessionID: input.sessionID, targetID: input.docID, actorID: input.actorID, peer: input.peer })
    },
  )

  export const questionSubmitConnect = fn(
    z.object({
      sessionID: SessionID.zod,
      requestID: z.string(),
      actorID: ActorID.zod,
      peer: z.custom<{ send: (data: string) => void }>(),
    }),
    (input) => {
      Session.get(input.sessionID)
      return connect({ sessionID: input.sessionID, targetID: input.requestID, actorID: input.actorID, peer: input.peer })
    },
  )

  // ── Question answer draft + presence relay ─────────────────────────────────────────────────
  // Lets several participants co-edit one shared answer set before a consent send. State is
  // authoritative in-memory per requestID and relayed to connected peers over a bidirectional ws;
  // it is ephemeral and GC'd when the question resolves. Single-choice answers are last-write-wins;
  // multi-choice toggles are commutative; custom text is per-field last-write-wins.

  export const QuestionDraft = z
    .object({
      requestID: z.string(),
      sessionID: SessionID.zod,
      answers: z.array(z.array(z.string())),
      custom: z.array(z.string()),
      customOn: z.array(z.boolean()),
      rev: z.number(),
    })
    .meta({ ref: "QuestionDraft" })
  export type QuestionDraft = z.infer<typeof QuestionDraft>

  export const QuestionDraftOp = z
    .discriminatedUnion("kind", [
      // Single-choice: replace the question's answer outright (LWW). null clears it.
      z.object({ kind: z.literal("single"), q: z.number(), value: z.string().nullable() }),
      // Multi-choice: add/remove one predefined label (commutative across actors).
      z.object({ kind: z.literal("toggle"), q: z.number(), label: z.string(), on: z.boolean() }),
      // Custom "직접 답변": text + toggle. `multi` mirrors the dock's single vs multi custom handling.
      z.object({ kind: z.literal("custom"), q: z.number(), text: z.string(), on: z.boolean(), multi: z.boolean() }),
    ])
    .meta({ ref: "QuestionDraftOp" })
  export type QuestionDraftOp = z.infer<typeof QuestionDraftOp>

  export const QuestionPresenceEntry = z
    .object({
      actorID: ActorID.zod,
      name: z.string(),
      color: z.string(),
      qIndex: z.number(),
      selection: z.array(z.string()),
      customFocused: z.boolean(),
    })
    .meta({ ref: "QuestionPresenceEntry" })
  export type QuestionPresenceEntry = z.infer<typeof QuestionPresenceEntry>

  export const QuestionChannelEvent = z
    .object({
      type: z.enum(["draft", "presence"]),
      draft: QuestionDraft.optional(),
      presence: QuestionPresenceEntry.array().optional(),
    })
    .meta({ ref: "QuestionChannelEvent" })
  export type QuestionChannelEvent = z.infer<typeof QuestionChannelEvent>

  type DraftPeer = { actorID: ActorID; send: (data: string) => void }
  const drafts = new Map<string, QuestionDraft>()
  const presences = new Map<string, Map<ActorID, QuestionPresenceEntry>>()
  const draftPeers = new Map<string, Set<DraftPeer>>()
  const draftLeaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function castDraft(requestID: string) {
    const set = draftPeers.get(requestID)
    const draft = drafts.get(requestID)
    if (!set || !draft) return
    const data = JSON.stringify({ type: "draft", draft } satisfies QuestionChannelEvent)
    set.forEach((peer) => peer.send(data))
  }

  function castPresence(requestID: string) {
    const set = draftPeers.get(requestID)
    if (!set) return
    const list = Array.from(presences.get(requestID)?.values() ?? [])
    const data = JSON.stringify({ type: "presence", presence: list } satisfies QuestionChannelEvent)
    set.forEach((peer) => peer.send(data))
  }

  function ensureDraft(sessionID: SessionID, requestID: string) {
    let draft = drafts.get(requestID)
    if (!draft) {
      draft = { requestID, sessionID, answers: [], custom: [], customOn: [], rev: 0 }
      drafts.set(requestID, draft)
    }
    return draft
  }

  export const questionDraftApply = fn(
    z.object({ sessionID: SessionID.zod, requestID: z.string(), op: QuestionDraftOp }),
    (input) => {
      const draft = ensureDraft(input.sessionID, input.requestID)
      const op = input.op
      while (draft.answers.length <= op.q) draft.answers.push([])
      while (draft.custom.length <= op.q) draft.custom.push("")
      while (draft.customOn.length <= op.q) draft.customOn.push(false)

      if (op.kind === "single") {
        draft.answers[op.q] = op.value === null ? [] : [op.value]
        draft.customOn[op.q] = false
      } else if (op.kind === "toggle") {
        const cur = draft.answers[op.q] ?? []
        draft.answers[op.q] = op.on
          ? cur.includes(op.label)
            ? cur
            : [...cur, op.label]
          : cur.filter((item) => item !== op.label)
      } else {
        const prev = (draft.custom[op.q] ?? "").trim()
        const next = op.text.trim()
        draft.custom[op.q] = op.text
        draft.customOn[op.q] = op.on
        if (op.multi) {
          let cur = draft.answers[op.q] ?? []
          if (prev) cur = cur.filter((item) => item.trim() !== prev)
          if (op.on && next && !cur.some((item) => item.trim() === next)) cur = [...cur, op.text]
          draft.answers[op.q] = cur
        } else {
          draft.answers[op.q] = op.on && next ? [op.text] : []
        }
      }
      draft.rev += 1
      castDraft(input.requestID)
      return draft
    },
  )

  export const questionPresenceSet = fn(
    z.object({ sessionID: SessionID.zod, requestID: z.string(), entry: QuestionPresenceEntry }),
    (input) => {
      const map = presences.get(input.requestID) ?? new Map<ActorID, QuestionPresenceEntry>()
      map.set(input.entry.actorID, input.entry)
      presences.set(input.requestID, map)
      castPresence(input.requestID)
    },
  )

  function dropPresence(requestID: string, actorID: ActorID) {
    const map = presences.get(requestID)
    if (!map) return
    if (map.delete(actorID)) castPresence(requestID)
    if (map.size === 0) presences.delete(requestID)
  }

  function draftLeaveKey(requestID: string, actorID: ActorID) {
    return `draft:${requestID}:${actorID}`
  }

  function cancelDraftLeave(requestID: string, actorID: ActorID) {
    const key = draftLeaveKey(requestID, actorID)
    const timer = draftLeaveTimers.get(key)
    if (!timer) return
    clearTimeout(timer)
    draftLeaveTimers.delete(key)
  }

  function scheduleDraftLeave(requestID: string, actorID: ActorID) {
    cancelDraftLeave(requestID, actorID)
    const key = draftLeaveKey(requestID, actorID)
    draftLeaveTimers.set(
      key,
      setTimeout(() => {
        draftLeaveTimers.delete(key)
        const set = draftPeers.get(requestID)
        const online = set ? Array.from(set).some((peer) => peer.actorID === actorID) : false
        if (online) return
        dropPresence(requestID, actorID)
      }, LEAVE_GRACE),
    )
  }

  // GC a resolved question's shared state. Called on reply/reject (vote path and Bus events).
  export function questionDraftReset(requestID: string) {
    drafts.delete(requestID)
    presences.delete(requestID)
    castPresence(requestID)
  }

  export const questionDraftConnect = fn(
    z.object({
      sessionID: SessionID.zod,
      requestID: z.string(),
      actorID: ActorID.zod,
      peer: z.custom<{ send: (data: string) => void }>(),
    }),
    (input) => {
      Session.get(input.sessionID)
      const peer = { actorID: input.actorID, send: input.peer.send }
      const set = draftPeers.get(input.requestID) ?? new Set<DraftPeer>()
      set.add(peer)
      draftPeers.set(input.requestID, set)
      cancelDraftLeave(input.requestID, input.actorID)
      // Snapshot current draft + presence so a late joiner sees the in-progress shared answer.
      const draft = drafts.get(input.requestID)
      if (draft) peer.send(JSON.stringify({ type: "draft", draft } satisfies QuestionChannelEvent))
      const list = Array.from(presences.get(input.requestID)?.values() ?? [])
      if (list.length) peer.send(JSON.stringify({ type: "presence", presence: list } satisfies QuestionChannelEvent))
      return () => {
        set.delete(peer)
        if (!Array.from(set).some((item) => item.actorID === peer.actorID))
          scheduleDraftLeave(input.requestID, peer.actorID)
        if (set.size === 0) draftPeers.delete(input.requestID)
      }
    },
  )

  export const actorUpsert = fn(
    z.object({
      sessionID: SessionID.zod,
      actorID: ActorID.zod.optional(),
      userID: z.string().optional(),
      name: z.string().optional(),
    }),
    (input) => {
      Session.get(input.sessionID)

      // Identity resolution priority:
      //  1. An explicit actorID (tab-scoped client identity).
      //  2. Otherwise, if a userID is given, reuse that user's existing actor in this session so the
      //     SAME user is one collaborator across tabs/browsers/devices (and distinct users stay
      //     distinct → consent applies between them).
      //  3. Otherwise mint a fresh actor.
      const byUser =
        !input.actorID && input.userID
          ? Database.use((db) =>
              db
                .select()
                .from(SessionActorTable)
                .where(and(eq(SessionActorTable.session_id, input.sessionID), eq(SessionActorTable.user_id, input.userID!)))
                .get(),
            )
          : undefined
      const actorID = input.actorID ?? byUser?.actor_id ?? ActorID.ascending()
      const existing =
        byUser ??
        Database.use((db) =>
          db
            .select()
            .from(SessionActorTable)
            .where(and(eq(SessionActorTable.session_id, input.sessionID), eq(SessionActorTable.actor_id, actorID)))
            .get(),
        )

      const name = (input.name ? cap(input.name) : "") || existing?.name || fallback(actorID)
      const row = {
        session_id: input.sessionID,
        actor_id: actorID,
        user_id: input.userID ?? existing?.user_id ?? null,
        name,
        color: pickColor(input.sessionID, actorID, existing?.color),
        time_seen: Date.now(),
      }

      Database.use((db) =>
        db
          .insert(SessionActorTable)
          .values({
            ...row,
            time_created: existing?.time_created ?? Date.now(),
          })
          .onConflictDoUpdate({
            target: [SessionActorTable.session_id, SessionActorTable.actor_id],
            set: {
              user_id: row.user_id,
              name: row.name,
              color: row.color,
              time_seen: row.time_seen,
            },
          })
          .run(),
      )

      return {
        actorID,
        sessionID: input.sessionID,
        userID: row.user_id ?? undefined,
        name: row.name,
        color: row.color,
      }
    },
  )

  export const actorList = fn(SessionID.zod, (sessionID) => {
    Session.get(sessionID)
    return Database.use((db) =>
      db.select().from(SessionActorTable).where(eq(SessionActorTable.session_id, sessionID)).all(),
    ).map((row) => ({
      actorID: row.actor_id,
      sessionID: row.session_id,
      userID: row.user_id ?? undefined,
      name: row.name,
      color: row.color,
    }))
  })
}
