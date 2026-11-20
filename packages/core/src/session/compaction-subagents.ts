export * as SessionCompactionSubagents from "./compaction-subagents.js"

import { DateTime, Effect, Option, Schema } from "effect"
import type { Job } from "../job.js"
import type { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import type { SessionStore } from "./store.js"

/** Most recently updated idle direct children kept alongside all currently running ones. */
export const MAX_IDLE = 10
const MAX_TITLE_CHARS = 120

export const Entry = Schema.Struct({
  id: SessionSchema.ID,
  agent: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  status: Schema.Literals(["running", "idle"]),
})
export type Entry = typeof Entry.Type

const Entries = Schema.Array(Entry)
const decodeEntries = Schema.decodeUnknownOption(Entries)

/**
 * Snapshots a session's direct non-archived subagents for compaction metadata: every currently
 * running child plus up to {@link MAX_IDLE} most recently updated idle children.
 */
export const collect = Effect.fnUntraced(function* (
  store: Pick<SessionStore.Interface, "list">,
  jobs: Pick<Job.Interface, "runningBackground">,
  sessionID: SessionSchema.ID,
): Effect.fn.Return<readonly Entry[]> {
  const children = yield* store.list({ parentID: sessionID, archived: false, order: "desc" })
  if (children.length === 0) return []
  const runningJobs = new Map(
    (yield* jobs.runningBackground).flatMap((recovery) =>
      recovery.kind === "subagent" && recovery.parentSessionID === sessionID
        ? [[recovery.childSessionID, recovery] as const]
        : [],
    ),
  )
  const entries = children.map((child): Entry => {
    const job = runningJobs.get(child.id)
    const agent = child.agent ?? job?.agent
    const title = formatTitle(child.title ?? job?.description)
    return {
      id: child.id,
      ...(agent ? { agent } : {}),
      ...(title ? { title } : {}),
      status: job !== undefined || isBusy(child) ? "running" : "idle",
    }
  })
  const running = entries.filter((entry) => entry.status === "running")
  const idle = entries.filter((entry) => entry.status === "idle").slice(0, MAX_IDLE)
  return [...running, ...idle]
})

/** Decodes valid subagent entries stored in compaction metadata. */
export const read = (message: SessionMessage.CompactionCompleted): readonly Entry[] =>
  Option.getOrElse(decodeEntries(message.metadata?.subagents), () => [])

/** Renders the `<subagents>` checkpoint block, or an empty string when none exist. */
export const format = (message: SessionMessage.CompactionCompleted) => {
  const entries = read(message)
  if (entries.length === 0) return ""
  return [
    "<subagents>",
    "Direct subagent sessions of this session (pass sessionID to the subagent tool to continue one):",
    ...entries.map(formatEntry),
    "</subagents>",
  ].join("\n")
}

const isBusy = (session: SessionSchema.Info) =>
  session.time.busy !== undefined &&
  (session.time.idle === undefined ||
    DateTime.toEpochMillis(session.time.busy) > DateTime.toEpochMillis(session.time.idle))

const formatTitle = (value: string | undefined) => {
  if (!value) return undefined
  const cleaned = value.replace(/\s+/g, " ").trim()
  if (!cleaned) return undefined
  const chars = Array.from(cleaned)
  return chars.length <= MAX_TITLE_CHARS ? cleaned : `${chars.slice(0, MAX_TITLE_CHARS - 1).join("")}…`
}

const formatEntry = (entry: Entry) => {
  const details = [entry.agent, entry.status].filter(Boolean).join(", ")
  const head = `- ${entry.id} (${details})`
  return entry.title ? `${head}: ${entry.title}` : head
}
