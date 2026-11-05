import { createHash } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import type { Database } from "./database"
import {
  initialDraftGcTransition,
  STARTUP_COLLECT_DELAY_MS,
  transitionDraftGc,
  type DraftGcCommand,
  type DraftGcEvent,
} from "./draft-gc-machine"
import { blobs, document } from "./schema"
import { createWriteBehind } from "./write-behind"

export type DraftStore = ReturnType<typeof createDraftStore>

// Every blob id a document references: image parts `{ blob: { id } }` and text chunk lists
// `{ blob: { kind: "text", ids: [...] } }`. SQLite walks the JSON; nothing parses drafts in JS.
const referenced = (value: string) => sql`
  SELECT json_extract(node.value, '$.id') AS id
  FROM json_tree(${value}) AS node
  WHERE node.key = 'blob' AND node.type = 'object' AND json_type(node.value, '$.id') = 'text'
  UNION
  SELECT chunk.value AS id
  FROM json_tree(${value}) AS node, json_each(node.value, '$.ids') AS chunk
  WHERE node.key = 'blob' AND node.type = 'object' AND json_type(node.value, '$.ids') = 'array'
`

export function createDraftStore(
  db: Database,
  input: { collectDelay?: number; onError?: (cause: unknown) => void } = {},
) {
  const gc = createDraftGc(db, input)
  const byKey = eq(document.key, sql.placeholder("key"))
  const read = db.select({ value: document.value }).from(document).where(byKey).prepare()
  const remove = db.delete(document).where(byKey).prepare()

  const upsert = db
    .insert(document)
    .values({ key: sql.placeholder("key"), value: sql.placeholder("value") })
    .onConflictDoUpdate({ target: document.key, set: { value: sql.placeholder("value") } })
    .prepare()

  const writer = createWriteBehind<string | null>({
    delay: 500,
    onError: input.onError,
    write: (batch) => {
      const at = Date.now()
      db.transaction(() => {
        for (const [key, value] of batch) {
          if (value === null) {
            remove.run({ key })
            continue
          }

          upsert.run({ key, value })

          // Referencing a blob keeps it alive; done here so a reference the renderer republished
          // from its cache is refreshed even though no upload happened.
          if (json(value))
            db.run(sql`UPDATE ${blobs} SET touched_at = ${at} WHERE ${blobs.id} IN (${referenced(value)})`)
        }
      })

      gc.dispatch({ type: "documents.written", at })
    },
  })

  return {
    get(key: string) {
      if (writer.has(key)) return writer.get(key) ?? null

      return read.get({ key })?.value ?? null
    },
    // Returns the referenced blob ids this store does not hold so the renderer can upload them
    // again. A strict write is refused while any are missing, so the previously stored document
    // stays visible instead of one with dangling references.
    set(key: string, value: string | null, strict = false) {
      const missing =
        value === null || !json(value)
          ? []
          : db
              .all<{
                id: string
              }>(sql`SELECT ref.id FROM (${referenced(value)}) AS ref WHERE ref.id NOT IN (SELECT ${blobs.id} FROM ${blobs})`)
              .map((row) => row.id)

      if (!strict || missing.length === 0) writer.set(key, value)

      return missing
    },
    putBlob(data: Uint8Array) {
      const id = createHash("sha256").update(data).digest("hex")
      const touched_at = Date.now()
      db.insert(blobs)
        .values({ id, data: Buffer.from(data), touched_at })
        .onConflictDoUpdate({ target: blobs.id, set: { touched_at } })
        .run()
      gc.dispatch({ type: "blob.uploaded", at: touched_at })

      return id
    },
    getBlob(id: string): Uint8Array<ArrayBuffer> | null {
      const data = db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).get()?.data

      // SAFETY: node:sqlite allocates a dedicated ArrayBuffer per BLOB column value.
      return data ? (data as Uint8Array<ArrayBuffer>) : null
    },
    flush: writer.flush,
    close() {
      // The final flush below collects nothing: the scan walks every document and can wait for the next launch.
      gc.dispatch({ type: "close.requested" })
      writer.close()
    },
  }
}

function json(value: string) {
  return value.startsWith("{") || value.startsWith("[")
}

function createDraftGc(db: Database, input: { collectDelay?: number; onError?: (cause: unknown) => void }) {
  const initial = initialDraftGcTransition(Date.now(), input.collectDelay ?? STARTUP_COLLECT_DELAY_MS)
  const current = { state: initial.state }
  // The armed timer; there is at most one.
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const dispatch = (event: DraftGcEvent) => {
    const next = transitionDraftGc(current.state, event)
    current.state = next.state
    next.commands.forEach(perform)
  }

  const perform = (command: DraftGcCommand) => {
    if (command.type === "collect") return dispatch(collect(command.attempt, command.at, command.before))

    if (command.type === "report-error") return input.onError?.(command.error)

    timers.forEach(clearTimeout)
    timers.clear()

    if (command.type === "cancel-timer") return
    const timer = setTimeout(() => dispatch({ type: "timer.fired", attempt: command.attempt, at: Date.now() }), command.delayMs)
    timer.unref()
    timers.add(timer)
  }

  // A failed sweep is a result the machine retries; it never fails the document write that triggered it.
  const collect = (attempt: number, at: number, before: number): DraftGcEvent => {
    try {
      return { type: "collect.succeeded", attempt, at, oldestOrphanAt: collectBlobs(db, before) }
    } catch (error) {
      return { type: "collect.failed", attempt, at, error }
    }
  }

  initial.commands.forEach(perform)

  return { dispatch }
}

// Every blob id a stored document references.
const stored = sql`
  SELECT json_extract(node.value, '$.id')
  FROM ${document}, json_tree(${document.value}) AS node
  WHERE json_valid(${document.value}) AND node.key = 'blob' AND node.type = 'object'
    AND json_type(node.value, '$.id') = 'text'
  UNION
  SELECT chunk.value
  FROM ${document}, json_tree(${document.value}) AS node, json_each(node.value, '$.ids') AS chunk
  WHERE json_valid(${document.value}) AND node.key = 'blob' AND node.type = 'object'
    AND json_type(node.value, '$.ids') = 'array'
`

// Drops blobs no stored document references and nothing has touched since `before`, and returns the oldest
// `touched_at` among the unreferenced blobs it kept.
function collectBlobs(db: Database, before: number) {
  return db.transaction(() => {
    if (!db.get<{ found: number }>(sql`SELECT EXISTS (SELECT 1 FROM ${blobs}) AS found`)?.found) return null

    db.run(sql`DELETE FROM ${blobs} WHERE ${blobs.touched_at} < ${before} AND ${blobs.id} NOT IN (${stored})`)

    return (
      db.get<{ oldest: number | null }>(
        sql`SELECT MIN(${blobs.touched_at}) AS oldest FROM ${blobs} WHERE ${blobs.id} NOT IN (${stored})`,
      )?.oldest ?? null
    )
  })
}
