export * as SessionCompactionSubagents from "./compaction-subagents.js"

import { Automation } from "@opencode/schema/automation"
import { DateTime, Effect, Option, Schema } from "effect"
import type { Job } from "../job.js"
import { SessionBackground } from "./background.js"
import type { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import type { SessionStore } from "./store.js"
import { SubagentCompletion } from "./subagent-completion.js"

/** Most recently updated idle direct children kept alongside the running ones. */
export const MAX_IDLE = 10
/** Children one checkpoint lists at most, running ones first. The list goes into the durable compaction event. */
export const MAX = 20
const MAX_TITLE_CHARS = 120

const Entry = Schema.Struct({
  id: SessionSchema.ID,
  agent: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  status: Schema.Literals(["running", "idle"]),
})
type Entry = typeof Entry.Type

const Entries = Schema.Array(Entry)
const decodeEntries = Schema.decodeUnknownOption(Entries)

/**
 * Snapshots a session's direct non-archived subagents for compaction metadata: running children, then up to
 * {@link MAX_IDLE} most recently updated idle ones, {@link MAX} in all.
 */
export const collect = Effect.fnUntraced(function* (
  store: Pick<SessionStore.Interface, "list" | "get">,
  jobs: Pick<Job.Interface, "runningBackground">,
  sessionID: SessionSchema.ID,
): Effect.fn.Return<readonly Entry[]> {
  const children = yield* store.list({ parentID: sessionID, archived: false, order: "desc" })
  if (children.length === 0) return []
  // A child that went idle with its own shell or subagent still running has not finished its work.
  const outstanding = yield* SessionBackground.outstanding(jobs, store, sessionID)
  const working = new Set(
    yield* Effect.forEach(outstanding, (item) =>
      directChild(store, item.kind === "subagent" ? item.childSessionID : item.sessionID, sessionID),
    ),
  )
  // An automation run's child reports to no one, so it is listed only while the parent continues it as a subagent.
  const delegated = new Set(outstanding.flatMap((item) => (item.kind === "subagent" ? [item.childSessionID] : [])))
  const entries = children
    .filter((child) => !Automation.isRunSession(child.id) || delegated.has(child.id))
    .map((child): Entry => {
      const title = child.title ? SubagentCompletion.truncate(SubagentCompletion.clean(child.title), MAX_TITLE_CHARS) : ""
      return {
        id: child.id,
        ...(child.agent ? { agent: child.agent } : {}),
        ...(title ? { title } : {}),
        status: working.has(child.id) || isBusy(child) ? "running" : "idle",
      }
    })
  const running = entries.filter((entry) => entry.status === "running")
  const idle = entries.filter((entry) => entry.status === "idle").slice(0, MAX_IDLE)
  return [...running, ...idle].slice(0, MAX)
})

/** Explains the `<subagents>` block. The tag holds only the list, so this goes beside it. */
export const NOTE =
  "<subagents> lists this session's direct subagent sessions, with their status when this checkpoint was written; a subagent whose own background work is still going counts as running."

/** Renders the `<subagents>` checkpoint block, or an empty string when none exist. */
export const format = (message: SessionMessage.CompactionCompleted) => {
  const entries = Option.getOrElse(decodeEntries(message.metadata?.subagents), () => [])
  if (entries.length === 0) return ""
  return ["<subagents>", ...entries.map(formatEntry), "</subagents>"].join("\n")
}

/** The direct child of `root` that `from` is or descends from, or undefined when `from` is `root` itself. */
const directChild = Effect.fnUntraced(function* (
  store: Pick<SessionStore.Interface, "get">,
  from: SessionSchema.ID,
  root: SessionSchema.ID,
) {
  const seen = new Set<SessionSchema.ID>()
  let current = from
  while (current !== root && !seen.has(current)) {
    seen.add(current)
    const parentID = (yield* store.get(current))?.parentID
    if (parentID === root) return current
    if (parentID === undefined) return undefined
    current = parentID
  }
  return undefined
})

const isBusy = (session: SessionSchema.Info) =>
  session.time.busy !== undefined &&
  (session.time.idle === undefined ||
    DateTime.toEpochMillis(session.time.busy) > DateTime.toEpochMillis(session.time.idle))

const formatEntry = (entry: Entry) => {
  const details = [entry.agent, entry.status].filter(Boolean).join(", ")
  const head = `- ${entry.id} (${details})`
  return entry.title ? `${head}: ${entry.title}` : head
}
