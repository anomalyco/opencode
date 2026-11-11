export * as SessionHistoryTools from "./session-history.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { optional } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Cache, DateTime, Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"

const Page = {
  cursor: optional(Schema.String),
  limit: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
}
const Filters = {
  query: optional(Schema.NonEmptyString),
  sessionID: optional(Session.ID),
  includeMessages: optional(Schema.Boolean),
  includeToolOutput: optional(Schema.Boolean),
}
// Host cursors are opaque. A hit inside a host page is identified by its page start + offset.
const Position = Schema.Struct({
  sessionID: Session.ID,
  cursor: Page.cursor,
  offset: optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 63 }))),
})
const InspectCursor = Schema.fromJsonString(Position)
const Search = Schema.Struct({ ...Page, ...Filters })
type Continuation = typeof Search.Type & {
  list: Session.ListCursor | undefined
  position: typeof Position.Type | undefined
}
const Summary = Schema.Struct({ sessionID: Session.ID, title: Schema.String })
const Message = Schema.Struct({ id: SessionMessage.ID, type: Schema.String, time: Schema.Number, text: Schema.String })
const Hit = Schema.Struct({
  messageID: SessionMessage.ID,
  type: Schema.String,
  time: Schema.Number,
  cursor: Page.cursor,
  message: optional(Message),
})
const Group = Schema.Struct({ ...Summary.fields, hits: Schema.Array(Hit) })
const invalid = () => new Tool.Error({ message: "Invalid session history cursor" })
const summary = (info: Session.Info) => ({ sessionID: info.id, title: info.title ?? "Untitled session" })
const link = Schema.encodeSync(InspectCursor)

function transcript(row: SessionMessage.Info, output: boolean): string {
  switch (row.type) {
    case "assistant":
      return row.content
        .flatMap((part) => {
          if (part.type === "text") return [part.text]
          if (part.type !== "tool") return []
          // Unknown tool arguments may contain media or replay data. Only copy common textual arguments.
          const args =
            part.state.status === "streaming"
              ? []
              : Object.entries(part.state.input)
                  .filter(
                    ([key, value]) =>
                      ["command", "code", "path", "filePath", "pattern", "query"].includes(key) &&
                      typeof value === "string" &&
                      !/data:[^\s,]*,/i.test(value),
                  )
                  .map(([key, value]) => `${key}: ${value}`)
          return [
            part.name,
            ...args,
            ...(output && "content" in part.state
              ? (part.state.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : []))
              : []),
            ...(output && part.state.status === "error" ? [part.state.error.message] : []),
          ]
        })
        .join("\n")
    case "user":
    case "synthetic":
    case "skill":
      return row.text
    case "system":
      return row.description ?? ""
    case "shell":
      return [row.command, output && row.output?.output].filter(Boolean).join("\n")
    case "compaction":
      return row.status === "failed" ? row.error.message : row.summary
    case "agent-switched":
      return row.agent
    case "model-switched":
      return `${row.model.providerID}/${row.model.id}`
    case "location-switched":
      return row.location.directory
    case "idle":
      return row.error?.message ?? row.outcome
  }
}

function view(row: SessionMessage.Info, text: string) {
  return {
    id: row.id,
    type: row.type,
    time: DateTime.toEpochMillis(row.time.created),
    text: text.length <= 8000 ? text : `${text.slice(0, 8000)}…`,
  }
}

export const Plugin = {
  id: "opencode.tool.session-history",
  effect: Effect.fn("SessionHistoryTools.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const flags = yield* Flag.Service
    const permission = yield* Permission.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    // A host list cursor may identify a session we skipped (same directory, different workspace).
    // Return a local handle instead of exposing that cursor or accepting an arbitrary list filter.
    const continuations = yield* Cache.make<string, Continuation, Tool.Error>({
      capacity: 512,
      lookup: () => Effect.fail(invalid()),
    })
    const local = (info: Session.Info) =>
      info.location.directory === ctx.location.directory && info.location.workspaceID === ctx.location.workspaceID
    const missing = () => new Tool.Error({ message: "Session not found in this location" })
    const get = Effect.fn("SessionSearch.get")(function* (sessionID: Session.ID) {
      const info = yield* ctx.session.get({ sessionID }).pipe(Effect.mapError(missing))
      if (!local(info)) return yield* Effect.fail(missing())
      return info
    })
    const assert = (call: Tool.Context, action: string, resource: string) =>
      permission
        .assert({
          ...Permission.invocation(call),
          action,
          resources: [resource],
          save: ["*"],
        })
        .pipe(Effect.mapError((error) => new Tool.Error({ message: error.message })))
    const messages = (sessionID: Session.ID, cursor: string | undefined, limit: number) =>
      ctx.session.message
        .list({
          sessionID,
          ...(cursor === undefined ? { order: "asc" } : { cursor }),
          limit,
        })
        .pipe(Effect.mapError(() => new Tool.Error({ message: "Could not read message page" })))

    yield* ctx.tool
      .transform((editor) => {
        if (!flags.resolve(loaded.entries).session_search.enabled) return
        editor.namespace({ name: "sessions", description: "Search and inspect sessions in this location." })
        editor.add({
          name: "search",
          options: { namespace: "sessions" },
          description:
            "List sessions, or search titles and transcript text literally (case-insensitive). Continue with nextCursor even after an empty page. includeMessages adds excerpts; includeToolOutput includes tool and shell output in those excerpts.",
          input: Search,
          output: Schema.Struct({ sessions: Schema.Array(Group), nextCursor: Page.cursor }),
          execute: (input, call) =>
            Effect.gen(function* () {
              const pos = input.cursor === undefined ? undefined : yield* Cache.get(continuations, input.cursor)
              if (
                pos &&
                ((input.query !== undefined && pos.query !== input.query) ||
                  (input.sessionID !== undefined && pos.sessionID !== input.sessionID))
              )
                return yield* Effect.fail(invalid())
              const filters = {
                query: input.query ?? pos?.query,
                sessionID: input.sessionID ?? pos?.sessionID,
                includeMessages: input.includeMessages ?? pos?.includeMessages,
                includeToolOutput: input.includeToolOutput ?? pos?.includeToolOutput,
              }
              yield* assert(call, "sessions_search", filters.sessionID ?? ctx.location.directory)
              const limit = input.limit ?? 20
              const q = filters.query?.toLowerCase()
              const target = filters.sessionID ?? pos?.position?.sessionID
              const size = q ? 1 : limit
              const page = target
                ? { data: [yield* get(target)], cursor: { next: filters.sessionID ? undefined : pos?.list } }
                : yield* ctx.session
                    .list({
                      ...(pos?.list ? { cursor: pos.list } : { directory: ctx.location.directory }),
                      limit: size,
                    })
                    .pipe(Effect.mapError(invalid))
              const list = page.data.length === size ? page.cursor.next : undefined
              const sessions: (typeof Group.Type)[] = []
              let position: typeof Position.Type | undefined
              for (const info of page.data.filter(local)) {
                const group = summary(info)
                if (!q) {
                  sessions.push({ ...group, hits: [] })
                  continue
                }
                const start = pos?.position?.cursor
                const offset = pos?.position?.offset ?? 0
                const batch = yield* messages(info.id, start, 64)
                const hits: (typeof Hit.Type)[] = []
                for (const [i, row] of batch.data.entries()) {
                  if (i < offset) continue
                  const text = transcript(row, true)
                  if (!text.toLowerCase().includes(q)) continue
                  hits.push({
                    messageID: row.id,
                    type: row.type,
                    time: DateTime.toEpochMillis(row.time.created),
                    cursor: i || start ? link({ sessionID: info.id, cursor: start, offset: i }) : undefined,
                    message: filters.includeMessages
                      ? view(row, filters.includeToolOutput ? text : transcript(row, false))
                      : undefined,
                  })
                  if (hits.length === limit && i + 1 < batch.data.length) {
                    position = { sessionID: info.id, cursor: start, offset: i + 1 }
                    break
                  }
                }
                if (!position && batch.data.length === 64 && batch.cursor.next)
                  position = { sessionID: info.id, cursor: batch.cursor.next }
                if (hits.length || (!pos?.position && group.title.toLowerCase().includes(q)))
                  sessions.push({ ...group, hits })
              }
              const nextCursor = list || position ? crypto.randomUUID() : undefined
              if (nextCursor) yield* Cache.set(continuations, nextCursor, { ...filters, list, position })
              const output = { sessions, nextCursor }
              return { output, content: JSON.stringify(output) }
            }),
        })
        editor.add({
          name: "inspect",
          options: { namespace: "sessions" },
          description:
            "Read a chronological transcript page. Start at a hit with its sessionID and cursor (omit the cursor for the first message). Use previousCursor or nextCursor to navigate.",
          input: Schema.Struct({ ...Page, sessionID: Session.ID }),
          output: Schema.Struct({
            session: Summary,
            messages: Schema.Array(Message),
            previousCursor: Page.cursor,
            nextCursor: Page.cursor,
          }),
          execute: (input, call) =>
            Effect.gen(function* () {
              yield* assert(call, "sessions_inspect", input.sessionID)
              const pos =
                input.cursor === undefined
                  ? undefined
                  : yield* Schema.decodeUnknownEffect(InspectCursor)(input.cursor).pipe(Effect.mapError(invalid))
              if (pos && pos.sessionID !== input.sessionID) return yield* Effect.fail(invalid())
              const info = yield* get(input.sessionID)
              const cursor = pos?.offset ? (yield* messages(info.id, pos.cursor, pos.offset)).cursor.next : pos?.cursor
              if (pos?.offset && !cursor) return yield* Effect.fail(invalid())
              const page = yield* messages(info.id, cursor, input.limit ?? 20)
              // The host returns boundary cursors for any nonempty page, even at the ends.
              const neighbor = Effect.fnUntraced(function* (cursor?: string) {
                if (cursor && (yield* messages(info.id, cursor, 1)).data.length)
                  return link({ sessionID: info.id, cursor })
              })
              const output = {
                session: summary(info),
                messages: page.data.map((row) => view(row, transcript(row, true))),
                previousCursor: yield* neighbor(page.cursor.previous),
                nextCursor: yield* neighbor(page.cursor.next),
              }
              return { output, content: JSON.stringify(output) }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
}
