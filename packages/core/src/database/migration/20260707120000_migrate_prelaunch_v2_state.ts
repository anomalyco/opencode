import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { DatabaseMigration } from "../migration"

const decodeJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)
const isObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown))

export default {
  id: "20260707120000_migrate_prelaunch_v2_state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        sql`DELETE FROM session_message WHERE type = 'compaction' AND json_extract(data, '$.status') = 'queued'`,
      )
      const messages = yield* tx.all<{ id: string; type: string; data: string }>(
        sql`SELECT id, type, data FROM session_message WHERE type IN ('skill', 'shell', 'assistant', 'compaction', 'synthetic')`,
      )
      for (const row of messages) {
        const data = object(decodeJson(row.data))
        yield* tx.run(
          sql`UPDATE session_message SET data = ${JSON.stringify(messageData(row.type, data))} WHERE id = ${row.id}`,
        )
      }

      yield* tx.run(sql`DELETE FROM event WHERE type = 'session.compaction.delta.1'`)
      const events = yield* tx.all<{ id: string; aggregateID: string; seq: number; type: string; data: string }>(sql`
        SELECT id, aggregate_id as aggregateID, seq, type, data
        FROM event
        WHERE type IN (
          'session.skill.activated.1',
          'session.skill.activated.2',
          'session.compaction.started.1',
          'session.compaction.started.2',
          'session.compaction.ended.1',
          'session.compaction.failed.1',
          'session.compaction.failed.2',
          'session.revert.staged.1',
          'session.revert.staged.2'
        )
        ORDER BY aggregate_id, seq
      `)
      const compactionReasons = new Map<string, "auto" | "manual">()
      for (const row of events) {
        const data = object(decodeJson(row.data))
        if (row.type.startsWith("session.compaction.ended.")) {
          compactionReasons.delete(row.aggregateID)
          continue
        }
        const event = eventData(row.type, data, compactionReasons.get(row.aggregateID))
        if (row.type.startsWith("session.compaction.started."))
          compactionReasons.set(row.aggregateID, event.data.reason === "auto" ? "auto" : "manual")
        if (row.type.startsWith("session.compaction.failed.")) compactionReasons.delete(row.aggregateID)
        yield* tx.run(
          sql`UPDATE event SET type = ${event.type}, data = ${JSON.stringify(event.data)} WHERE id = ${row.id}`,
        )
      }
    })
  },
} satisfies DatabaseMigration.Migration

function messageData(type: string, data: Record<string, unknown>) {
  if (type === "skill")
    return defined({
      metadata: data.metadata,
      time: data.time,
      skill: data.skill ?? data.id ?? data.name,
      name: data.name,
      text: data.text,
    })
  if (type === "shell") {
    const shell = object(data.shell)
    return defined({
      metadata: data.metadata,
      time: data.time,
      shellID: data.shellID ?? shell.id,
      command: data.command ?? shell.command,
      status: data.status ?? shell.status,
      exit: data.exit ?? shell.exit,
      output: data.output,
    })
  }
  if (type === "assistant")
    return defined({
      metadata: data.metadata,
      time: data.time,
      agent: data.agent,
      model: data.model,
      content: Array.isArray(data.content) ? data.content.map(assistantContent) : data.content,
      snapshot: data.snapshot,
      finish: data.finish,
      cost: data.cost,
      tokens: data.tokens,
      error: data.error,
      retry: data.retry,
    })
  if (type === "compaction") {
    if (data.status === "failed")
      return defined({
        metadata: data.metadata,
        time: data.time,
        status: data.status,
        reason: data.reason,
        error: data.error ?? genericCompactionError,
      })
    return defined({
      metadata: data.metadata,
      time: data.time,
      status: data.status,
      reason: data.reason,
      summary: data.summary,
      recent: data.recent,
    })
  }
  if (type === "synthetic")
    return defined({ metadata: data.metadata, time: data.time, text: data.text, description: data.description })
  const { sessionID: _, ...current } = data
  return current
}

function assistantContent(value: unknown) {
  const content = object(value)
  if (content.type === "text") return defined({ type: content.type, text: content.text })
  if (content.type === "reasoning")
    return defined({ type: content.type, text: content.text, state: content.state, time: content.time })
  if (content.type !== "tool") return content
  return defined({
    type: content.type,
    id: content.id,
    name: content.name,
    executed: content.executed,
    providerState: content.providerState,
    providerResultState: content.providerResultState,
    state: toolState(content.state),
    time: content.time,
  })
}

function toolState(value: unknown) {
  const state = object(value)
  if (state.status === "pending" || state.status === "streaming")
    return defined({ status: "streaming", input: state.input })
  if (state.status === "running")
    return defined({ status: state.status, input: state.input, structured: state.structured, content: state.content })
  if (state.status === "completed")
    return defined({
      status: state.status,
      input: state.input,
      structured: state.structured,
      content: state.content,
      result: state.result,
    })
  if (state.status === "error")
    return defined({
      status: state.status,
      input: state.input,
      structured: state.structured,
      content: state.content,
      error: state.error,
      result: state.result,
    })
  return state
}

function eventData(type: string, data: Record<string, unknown>, compactionReason?: "auto" | "manual") {
  if (type.startsWith("session.skill.activated."))
    return {
      type: "session.skill.activated.1",
      data: defined({ sessionID: data.sessionID, id: data.id ?? data.name, name: data.name, text: data.text }),
    }
  if (type.startsWith("session.compaction.started."))
    return {
      type: "session.compaction.started.1",
      data: defined({
        sessionID: data.sessionID,
        reason: data.reason,
        recent: data.recent ?? "",
        inputID: data.inputID,
      }),
    }
  if (type.startsWith("session.compaction.failed."))
    return {
      type: "session.compaction.failed.1",
      data: defined({
        sessionID: data.sessionID,
        reason: data.reason ?? compactionReason ?? "manual",
        error: data.error ?? genericCompactionError,
        inputID: data.inputID,
      }),
    }
  const revert = object(data.revert)
  return {
    type: "session.revert.staged.1",
    data: defined({
      sessionID: data.sessionID,
      revert: defined({
        messageID: revert.messageID,
        partID: revert.partID,
        snapshot: revert.snapshot,
        files: Array.isArray(revert.files)
          ? revert.files.map((value) => {
              const file = object(value)
              return defined({
                file: file.file ?? file.path,
                patch: file.patch,
                additions: file.additions,
                deletions: file.deletions,
                status: file.status,
              })
            })
          : undefined,
      }),
    }),
  }
}

const genericCompactionError = {
  type: "compaction.failed",
  message: "Compaction failed before recording an error",
}

function object(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {}
}

function defined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined))
}
