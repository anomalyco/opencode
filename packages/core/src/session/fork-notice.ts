export * as ForkNotice from "./fork-notice.js"

import { DateTime, Effect } from "effect"
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import type { Session } from "@opencode/schema/session"
import { DatabaseBatch } from "../database/batch.js"
import type { Database } from "../database/database.js"
import type { Job } from "../job.js"
import type { SessionMessage } from "./message.js"
import { SessionMessageTable, SessionPartTable } from "./sql.js"

export type Subagent = {
  readonly sessionID: string
  readonly description: string
  readonly state: string
}

const outstanding = "These subagents of the original were still outstanding when this fork was made:"

const closing =
  "Don't wait for these. Their results won't arrive here. Start a new subagent if this fork needs that work."

/** Reads copies in the same page size as the projection loop, so a fork scan never materializes the whole transcript. */
const ScanBatchSize = 500

type MessageRow = typeof SessionMessageTable.$inferSelect
type Part = SessionMessage.AssistantContentEncoded

/**
 * Names the original's work that keeps reporting to the original: launches in the copied history with no later
 * report, and children that still hold a running subagent job.
 *
 * One pass in transcript order, straight from the copied rows: a launch enters the set and a later report deletes
 * it, so no launch rescans the transcript and no media blob is ever hydrated.
 */
export const collect = (input: {
  readonly db: Database.Interface["db"]
  readonly sessionID: Session.ID
  readonly children: readonly Session.Info[]
  readonly jobs: Pick<Job.Interface, "get">
}): Effect.Effect<readonly Subagent[]> =>
  Effect.gen(function* () {
    // Map order keeps transcript order for launched entries while deduping by child.
    const subagents = new Map<string, Subagent>()
    let cursor = -1
    while (true) {
      const rows = yield* input.db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, input.sessionID), gt(SessionMessageTable.seq, cursor)))
        .orderBy(asc(SessionMessageTable.seq))
        .limit(ScanBatchSize)
        .all()
        .pipe(Effect.orDie)
      if (rows.length === 0) break
      cursor = rows.at(-1)!.seq
      const parts = yield* contentParts(input.db, rows)
      for (const row of rows) {
        if (row.type !== "assistant") {
          if (!("text" in row.data)) continue
          const text = row.data.text
          if (typeof text === "string") forget(subagents, text)
          continue
        }
        const inline = "content" in row.data && Array.isArray(row.data.content) ? row.data.content : []
        for (const part of [...(parts.get(row.id) ?? []), ...inline]) fold(subagents, part)
      }
    }
    for (const child of input.children) {
      const job = yield* input.jobs.get(child.id)
      // Finished jobs stay in the in-memory map, so only a running job is outstanding.
      if (job?.type !== "subagent" || job.status !== "running") continue
      subagents.set(child.id, {
        sessionID: child.id,
        description: job.title ?? child.title ?? "subagent",
        state: job.status,
      })
    }
    return [...subagents.values()]
  })

/**
 * Text and tool parts a split assistant row keeps in `session_part`, in ordinal order. Media parts stay in the
 * table, and legacy rows without parts keep their inline content.
 */
const contentParts = (db: Database.Interface["db"], rows: ReadonlyArray<MessageRow>) =>
  Effect.gen(function* () {
    const partsByMessage = new Map<SessionMessage.ID, Part[]>()
    const assistantIDs = rows.flatMap((row) => (row.type === "assistant" ? [row.id] : []))
    for (const ids of DatabaseBatch.batches(assistantIDs, 1)) {
      const found = yield* db
        .select({ message_id: SessionPartTable.message_id, data: SessionPartTable.data })
        .from(SessionPartTable)
        .where(and(inArray(SessionPartTable.message_id, ids), inArray(SessionPartTable.type, ["text", "tool"])))
        .orderBy(asc(SessionPartTable.message_id), asc(SessionPartTable.ordinal))
        .all()
        .pipe(Effect.orDie)
      for (const part of found) {
        const parts = partsByMessage.get(part.message_id)
        if (parts) parts.push(part.data)
        else partsByMessage.set(part.message_id, [part.data])
      }
    }
    return partsByMessage
  })

const fold = (subagents: Map<string, Subagent>, part: Part) => {
  if (part.type === "text") {
    forget(subagents, part.text)
    return
  }
  if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming") return
  // A foreground follow-up's result reports its child in the tool content.
  const content = "content" in part.state ? (part.state.content ?? []) : []
  for (const item of content) if (item.type === "text") forget(subagents, item.text)
  const launched = launch(part.state, content)
  if (launched === undefined || subagents.has(launched.sessionID)) return
  subagents.set(launched.sessionID, { ...launched, state: "unreported" })
}

/**
 * A background launch, whether the call asked for one or a foreground call was moved to the background before the
 * fork. The result then says it is running; a completed result is not an outstanding launch.
 */
const launch = (
  state: Exclude<SessionMessage.ToolState, { status: "streaming" }>,
  content: ReadonlyArray<{ readonly type: string; readonly text?: string }>,
) => {
  const metadata = state.metadata
  const text = content
    .flatMap((item) => (item.type === "text" && item.text !== undefined ? [item.text] : []))
    .join("\n")
  const sessionID =
    typeof metadata?.sessionID === "string"
      ? metadata.sessionID
      : /is working in the background \(sessionID: ([^)]+)\)/.exec(text)?.[1]
  if (sessionID === undefined) return
  if (state.input.background !== true && metadata?.status !== "running") return
  const description = state.input.description
  return { sessionID, description: typeof description === "string" ? description : "subagent" }
}

/** Matches the report `SubagentCompletion` delivers, keeping the closing quote so one child id can't prefix another. */
const forget = (subagents: Map<string, Subagent>, text: string) => {
  for (const match of text.matchAll(/<subagent sessionID="([^"]*)"/g)) subagents.delete(match[1]!)
}

export const text = (input: {
  readonly forkOf: Session.ID
  readonly title?: string
  readonly time: number
  readonly subagents: readonly Subagent[]
}) => {
  const title = input.title === undefined ? "untitled" : `"${input.title}"`
  const first =
    `This session is a fork of ${input.forkOf} (${title}), copied through its message at ` +
    `${DateTime.formatIso(DateTime.makeUnsafe(input.time))}; work started before the fork keeps reporting to the original, not here.`
  if (input.subagents.length === 0) return first
  return [
    first,
    "",
    outstanding,
    ...input.subagents.map((subagent) => `- ${subagent.sessionID} "${subagent.description}" (${subagent.state})`),
    "",
    closing,
  ].join("\n")
}
