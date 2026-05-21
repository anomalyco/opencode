import { eq, and } from "drizzle-orm"
import z from "zod"
import { ulid } from "ulid"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { Database, NotFoundError } from "@/storage/db"
import { fn } from "@/util/fn"
import * as Room from "./room"
import { MSG_DOC, pack, unpack } from "./wire"
import { DocAssetTable, DocTable, DocUpdateTable, SessionActorTable, SessionPromptDocTable } from "./doc.sql"
import { ActorID, AssetID, DocID } from "./schema"

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

      const name = input.name ?? existing?.name ?? `Guest-${actorID.slice(-4)}`
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
