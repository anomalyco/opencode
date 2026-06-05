import { eq, and, desc } from "drizzle-orm"
import z from "zod"
import { ulid } from "ulid"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
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
  SessionActorTable,
  SessionPromptDocTable,
} from "./doc.sql"
import { ActorID, AssetID, DocID, SubmitID } from "./schema"

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

  function color(id: string) {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
    return COLORS[Math.abs(h) % COLORS.length]!
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

  export const SubmitState = z
    .object({
      submitID: SubmitID.zod,
      sessionID: SessionID.zod,
      docID: DocID.zod,
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

  export const SubmitCreateInput = z.object({
    sessionID: SessionID.zod,
    docID: DocID.zod,
    actorID: ActorID.zod,
    actorIDs: ActorID.zod.array(),
    names: z.record(z.string(), z.string()).optional(),
    prompt: SubmitPrompt,
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
  const peers = new Map<DocID, Set<SubmitPeer>>()
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
    return {
      submitID: row.id,
      sessionID: row.session_id,
      docID: row.doc_id,
      actorID: row.actor_id,
      status: SubmitStatus.parse(row.status),
      actors,
      cancelledBy: row.cancelled_by ? actors.find((item) => item.actorID === row.cancelled_by) : undefined,
      timeoutMs: row.timeout_ms,
      expiresAt: row.expires_at,
    }
  }

  function cast(type: SubmitEvent["type"], state: SubmitState) {
    const set = peers.get(state.docID)
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
    const body = SubmitPrompt.parse(JSON.parse(row.prompt))
    SessionPrompt.prompt({
      ...body,
      noReply: true,
      sessionID: row.session_id,
    })
      .then(() => {
        rotate(row)
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

  function active(sessionID: SessionID, docID: DocID, actorID?: ActorID) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(DocSubmitTable)
        .where(
          and(
            eq(DocSubmitTable.session_id, sessionID),
            eq(DocSubmitTable.doc_id, docID),
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

  function recent(sessionID: SessionID, docID: DocID, actorID: ActorID, now = Date.now()) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(DocSubmitTable)
        .where(and(eq(DocSubmitTable.session_id, sessionID), eq(DocSubmitTable.doc_id, docID)))
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

  function targets(docID: DocID, actorID: ActorID) {
    // The connected submit peers are the single source of truth for "who is in the doc":
    // it is the same set used by cast() and leave(), so a vote can never target someone
    // we cannot reach (or skip someone we can). The requester is always included, even if
    // their own socket has not finished connecting yet.
    const online = new Set(Array.from(peers.get(docID) ?? []).map((peer) => peer.actorID))
    online.add(actorID)
    return Array.from(online)
  }

  export const submitCreate = fn(SubmitCreateInput, (input) => {
    Session.get(input.sessionID)
    get(input.docID)

    const found = active(input.sessionID, input.docID)
    if (found) return found

    const ids = targets(input.docID, input.actorID)
    const timeout = clamp(input.timeoutMs)
    const now = Date.now()
    const build = () =>
      Database.transaction((db) => {
        const submit = {
          id: SubmitID.ascending(),
          session_id: input.sessionID,
          doc_id: input.docID,
          actor_id: input.actorID,
          status: ids.length <= 1 ? "sent" : "pending",
          prompt: JSON.stringify(input.prompt),
          timeout_ms: timeout,
          expires_at: now + timeout,
          cancelled_by: null,
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
      const winner = active(input.sessionID, input.docID)
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

  function leave(docID: DocID, actorID: ActorID) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(DocSubmitTable)
        .where(and(eq(DocSubmitTable.doc_id, docID), eq(DocSubmitTable.status, "pending")))
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

  function leaveKey(docID: DocID, actorID: ActorID) {
    return `${docID}:${actorID}`
  }

  function cancelLeave(docID: DocID, actorID: ActorID) {
    const key = leaveKey(docID, actorID)
    const timer = leaveTimers.get(key)
    if (!timer) return
    clearTimeout(timer)
    leaveTimers.delete(key)
  }

  function scheduleLeave(docID: DocID, actorID: ActorID) {
    cancelLeave(docID, actorID)
    const key = leaveKey(docID, actorID)
    leaveTimers.set(
      key,
      setTimeout(() => {
        leaveTimers.delete(key)
        const set = peers.get(docID)
        const online = set ? Array.from(set).some((item) => item.actorID === actorID) : false
        if (online) return
        leave(docID, actorID)
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
      const peer = { actorID: input.actorID, send: input.peer.send }
      const set = peers.get(input.docID) ?? new Set<SubmitPeer>()
      set.add(peer)
      peers.set(input.docID, set)
      cancelLeave(input.docID, input.actorID)
      const state = active(input.sessionID, input.docID, input.actorID)
      if (state) {
        peer.send(JSON.stringify({ type: "created", state } satisfies SubmitEvent))
      } else {
        // No live vote — but if one resolved moments ago, replay its terminal state so a
        // client that missed the cast() (e.g. reconnected just after) can update its dialog.
        const last = recent(input.sessionID, input.docID, input.actorID)
        if (last) peer.send(JSON.stringify({ type: last.status as SubmitEvent["type"], state: last } satisfies SubmitEvent))
      }
      return () => {
        set.delete(peer)
        if (!Array.from(set).some((item) => item.actorID === peer.actorID)) scheduleLeave(input.docID, peer.actorID)
        if (set.size === 0) peers.delete(input.docID)
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

      const actorID = input.actorID ?? ActorID.ascending()
      const existing = Database.use((db) =>
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
        color: existing?.color ?? color(actorID),
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
