export * as ToolPayload from "./tool-payload"

import { createHash } from "crypto"
import { Effect, Schema } from "effect"
import { eq, and } from "drizzle-orm"
import { ToolPayload as ToolPayloadSchema } from "@opencode-ai/schema/tool-payload"
import type { Database } from "../database/database"
import { SessionToolPayloadTable } from "./sql"
import type { SessionSchema } from "./schema"

export const Hash = ToolPayloadSchema.Hash
export type Hash = ToolPayloadSchema.Hash

export const Body = ToolPayloadSchema.Body
export type Body = ToolPayloadSchema.Body

/** UTF-8 byte ceiling for encoded durable tool event `data` after thinning. */
export const MaxEventDataBytes = 256 * 1024

export const PreviewTextBytes = 2 * 1024

export class OverBudgetError extends Schema.TaggedErrorClass<OverBudgetError>()("ToolPayload.OverBudgetError", {
  actualBytes: Schema.Number,
  maxBytes: Schema.Number,
  message: Schema.String,
}) {}

export class MissingError extends Schema.TaggedErrorClass<MissingError>()("ToolPayload.MissingError", {
  hash: Hash,
  sessionID: Schema.String,
  message: Schema.String,
}) {}

export type Error = OverBudgetError | MissingError

type DatabaseService = Database.Interface["db"]

const encodeBody = Schema.encodeSync(Body)
const decodeJson = Schema.decodeUnknownSync(Schema.Json)

export function hash(value: Body): Hash {
  return Hash.make(createHash("sha256").update(canonical(decodeJson(encodeBody(value)))).digest("hex"))
}

export const insertJson = Effect.fn("ToolPayload.insertJson")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  value: Schema.Json,
) {
  const payloadHash = Hash.make(createHash("sha256").update(canonical(value)).digest("hex"))
  yield* db
    .insert(SessionToolPayloadTable)
    .values({
      session_id: sessionID,
      hash: payloadHash,
      value,
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  return payloadHash
})

export const loadJson = Effect.fn("ToolPayload.loadJson")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  payloadHash: Hash,
) {
  const row = yield* db
    .select()
    .from(SessionToolPayloadTable)
    .where(and(eq(SessionToolPayloadTable.session_id, sessionID), eq(SessionToolPayloadTable.hash, payloadHash)))
    .get()
    .pipe(Effect.orDie)
  if (!row)
    return yield* new MissingError({
      hash: payloadHash,
      sessionID,
      message: `Session payload blob not found: ${payloadHash}`,
    })
  return row.value
})

export const insert = Effect.fn("ToolPayload.insert")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  body: Body,
) {
  return yield* insertJson(db, sessionID, decodeJson(encodeBody(body)))
})

export const load = Effect.fn("ToolPayload.load")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  payloadHash: Hash,
) {
  const value = yield* loadJson(db, sessionID, payloadHash)
  return yield* Schema.decodeUnknownEffect(Body)(value).pipe(Effect.orDie)
})

/** Preview fields safe to put on the durable event / SSE frame. */
export function preview(body: Body): {
  readonly structured: Record<string, unknown>
  readonly content: Body["content"]
} {
  const text = body.content
    .filter((item): item is Extract<Body["content"][number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("")
  const truncated =
    Buffer.byteLength(text, "utf-8") <= PreviewTextBytes
      ? text
      : text.slice(0, Math.max(0, PreviewTextBytes - 3)) + "..."
  return {
    structured: {},
    content: truncated ? [{ type: "text" as const, text: truncated }] : [],
  }
}

export function assertEventDataBudget(data: unknown): Effect.Effect<void, OverBudgetError> {
  const actualBytes = Buffer.byteLength(JSON.stringify(data), "utf-8")
  if (actualBytes <= MaxEventDataBytes) return Effect.void
  return new OverBudgetError({
    actualBytes,
    maxBytes: MaxEventDataBytes,
    message: `Tool event data is ${actualBytes} bytes; the limit is ${MaxEventDataBytes} bytes`,
  })
}

function canonical(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(decodeJson(entry))}`)
      .join(",")}}`
  return JSON.stringify(value)
}
