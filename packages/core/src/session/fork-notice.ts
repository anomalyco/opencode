export * as ForkNotice from "./fork-notice.js"

import { DateTime, Effect } from "effect"
import { and, asc, eq, gt } from "drizzle-orm"
import type { Session } from "@opencode/schema/session"
import type { Database } from "../database/database.js"
import type { Job } from "../job.js"
import { SessionHistory } from "./history.js"
import type { SessionMessage } from "./message.js"
import { SessionMessageTable } from "./sql.js"

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

/**
 * Names the original's work that keeps reporting to the original: launches in the copied history with no later
 * report, and children the copied history can reach that still hold a running subagent job. Returns the creation
 * time of the last copied message too, which the notice names; a fork that copied nothing has none.
 *
 * One pass in transcript order, straight from the copied rows: a launch enters the set and a later report deletes
 * it, so no launch rescans the transcript and no media blob is ever hydrated.
 */
export const collect = (input: {
  readonly db: Database.Interface["db"]
  readonly sessionID: Session.ID
  readonly children: readonly Session.Info[]
  readonly jobs: Pick<Job.Interface, "get">
}): Effect.Effect<{ readonly subagents: readonly Subagent[]; readonly copiedThrough?: number }> =>
  Effect.gen(function* () {
    // Map order keeps transcript order for launched entries while deduping by child.
    const subagents = new Map<string, Subagent>()
    let cursor = -1
    let copiedThrough: number | undefined
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
      const last = rows.at(-1)!
      cursor = last.seq
      copiedThrough = last.time_created
      for (const row of yield* SessionHistory.withParts(input.db, rows)) {
        if (row.type !== "assistant") {
          if (!("text" in row.data)) continue
          const text = row.data.text
          if (typeof text === "string") forget(subagents, text)
          continue
        }
        if (!("content" in row.data) || !Array.isArray(row.data.content)) continue
        for (const part of row.data.content) fold(subagents, part)
      }
    }
    for (const child of input.children) {
      // A child created after the fork point is unreachable from the copied history, even while it runs.
      if (copiedThrough === undefined) continue
      if (DateTime.toEpochMillis(child.time.created) > copiedThrough) continue
      const job = yield* input.jobs.get(child.id)
      // Finished jobs stay in the in-memory map, so only a running job is outstanding.
      if (job?.type !== "subagent" || job.status !== "running") continue
      subagents.set(child.id, {
        sessionID: child.id,
        description: job.title ?? child.title ?? "subagent",
        state: job.status,
      })
    }
    return { subagents: [...subagents.values()], copiedThrough }
  })

const fold = (subagents: Map<string, Subagent>, part: SessionMessage.AssistantContentEncoded) => {
  if (part.type === "text") {
    forget(subagents, part.text)
    return
  }
  if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming") return
  // A foreground follow-up's result reports its child in the tool content.
  const content = "content" in part.state ? (part.state.content ?? []) : []
  for (const item of content) if (item.type === "text") forget(subagents, item.text)
  const launched = launch(part.state)
  if (launched === undefined || subagents.has(launched.sessionID)) return
  subagents.set(launched.sessionID, { ...launched, state: "unreported" })
}

/**
 * A background launch. `subagent.ts` always writes `{ sessionID, status }`, and a result that is still running is a
 * launch, whether the call asked to run in the background or was moved there before the fork.
 */
const launch = (state: Exclude<SessionMessage.ToolState, { status: "streaming" }>) => {
  const metadata = state.metadata
  if (metadata?.status !== "running" || typeof metadata.sessionID !== "string") return
  const description = state.input.description
  return { sessionID: metadata.sessionID, description: typeof description === "string" ? description : "subagent" }
}

/** Matches the report `SubagentCompletion` delivers, keeping the closing quote so one child id can't prefix another. */
const forget = (subagents: Map<string, Subagent>, text: string) => {
  for (const match of text.matchAll(/<subagent sessionID="([^"]*)"/g)) subagents.delete(match[1]!)
}

export const text = (input: {
  readonly forkOf: Session.ID
  readonly title?: string
  /** Creation time of the last message copied into the fork; undefined when the fork copied nothing. */
  readonly copiedThrough?: number
  readonly subagents: readonly Subagent[]
}) => {
  const title = input.title === undefined ? "untitled" : `"${input.title}"`
  const opening = `This session is a fork of ${input.forkOf} (${title})`
  const first =
    input.copiedThrough === undefined
      ? `${opening}. It starts with none of the original's messages; work started before the fork keeps reporting to the original, not here.`
      : `${opening}, copied through its message at ${DateTime.formatIso(DateTime.makeUnsafe(input.copiedThrough))}; work started before the fork keeps reporting to the original, not here.`
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
