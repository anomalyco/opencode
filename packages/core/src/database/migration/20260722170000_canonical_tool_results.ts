import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { DatabaseMigration } from "../migration"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const isObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown))
const isJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Json))

const object = (value: unknown): Record<string, unknown> => (isObject(value) ? value : {})

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const contentOf = (state: Record<string, unknown>) => (Array.isArray(state.content) ? state.content : [])

/**
 * One-time rewrite of projected tool rows into the canonical result shape:
 * terminal states store model content plus optional metadata; the generic
 * `structured` and `result` fields disappear. Provider-hosted result payloads
 * move into provider-owned result state so hosted continuation survives.
 * Old-version tool events fall out of the durable manifest and are skipped.
 */
export default {
  id: "20260722170000_canonical_tool_results",
  up(tx) {
    return Effect.gen(function* () {
      // Keyset-paginated batches keep memory bounded: production databases hold
      // gigabytes of assistant rows, and materializing them all at once was
      // measured at a ~5GB RSS spike.
      let cursor = ""
      while (true) {
        const messages = yield* tx.all<{ id: string; data: string }>(
          sql`SELECT id, data FROM session_message WHERE type = 'assistant' AND id > ${cursor} ORDER BY id LIMIT 1000`,
        )
        if (messages.length === 0) break
        cursor = messages[messages.length - 1].id
        yield* rewrite(tx, messages)
      }
    })
  },
} satisfies DatabaseMigration.Migration

function rewrite(tx: Parameters<DatabaseMigration.Migration["up"]>[0], messages: { id: string; data: string }[]) {
  return Effect.gen(function* () {
    for (const row of messages) {
      // A row that never decoded is skipped rather than failing the whole
      // migration on every startup; it was equally unreadable before.
      const decoded = decodeJson(row.data)
      if (decoded._tag === "None") {
        yield* Effect.logWarning("skipping undecodable session_message row").pipe(Effect.annotateLogs({ id: row.id }))
        continue
      }
      const data = object(decoded.value)
      if (!Array.isArray(data.content)) continue
      let changed = false
      const content = data.content.map((part) => {
        const tool = object(part)
        if (tool.type !== "tool" || !isObject(tool.state)) return part
        const state = tool.state
        if (state.status !== "completed" && state.status !== "error" && state.status !== "running") return part
        changed = true
        if (state.status === "running")
          return {
            ...tool,
            state: {
              status: "running",
              input: object(state.input),
              metadata: object(state.structured),
              content: contentOf(state),
            },
          }
        // Hosted payloads are irreducible provider replay state; keep them under
        // the provider-owned result state instead of a generic result field.
        const hosted =
          tool.executed === true && isObject(state.result) && "value" in state.result
            ? { providerResultState: { ...object(tool.providerResultState), result: state.result.value } }
            : {}
        const preserved = contentOf(state)
        // Old generic `structured` payloads carry what consumers now read from
        // canonical metadata (edit/patch diffs, subagent session joins).
        const metadata =
          isJsonObject(state.structured) && Object.keys(state.structured).length > 0
            ? { metadata: state.structured }
            : {}
        if (state.status === "completed")
          return {
            ...tool,
            ...hosted,
            state: {
              status: "completed",
              input: object(state.input),
              content:
                preserved.length > 0
                  ? preserved
                  : [{ type: "text", text: stringify(state.structured ?? state.result) }],
              ...metadata,
            },
          }
        return {
          ...tool,
          ...hosted,
          state: {
            status: "error",
            input: object(state.input),
            error: state.error,
            ...(preserved.length > 0 ? { content: preserved } : {}),
            ...metadata,
          },
        }
      })
      if (!changed) continue
      yield* tx.run(sql`UPDATE session_message SET data = ${JSON.stringify({ ...data, content })} WHERE id = ${row.id}`)
    }
  })
}
