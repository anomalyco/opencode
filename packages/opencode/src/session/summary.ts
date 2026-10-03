import { isDeepStrictEqual } from "node:util"
import { and, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema, Semaphore } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { SessionID, MessageID } from "./schema"
import { Config } from "@/config/config"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: SessionV1.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummary") {}

// Count both active and queued calls; deleting on every completion would split a live queue.
const pending = new Map<MessageID, { semaphore: Semaphore.Semaphore; users: number }>()

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const { db } = yield* Database.Service

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: SessionV1.WithParts[] }) {
      let from: string | undefined
      let to: string | undefined
      for (const item of input.messages) {
        if (!from) {
          for (const part of item.parts) {
            if (part.type === "step-start" && part.snapshot) {
              from = part.snapshot
              break
            }
          }
        }
        for (const part of item.parts) {
          if (part.type === "step-finish" && part.snapshot) to = part.snapshot
        }
      }
      if (from && to) return yield* snapshot.diffFull(from, to)
      return []
    })

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          const entry = pending.get(input.messageID) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
          entry.users++
          pending.set(input.messageID, entry)
          return entry
        }),
        (entry) =>
          entry.semaphore.withPermit(
            Effect.gen(function* () {
              if ((yield* config.get()).snapshot === false) return
              const all = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
              if (!all.length) return

              const messages = all.filter(
                (m) =>
                  m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
              )
              const target = messages.find((m) => m.info.id === input.messageID)
              if (!target || target.info.role !== "user") return
              const msgDiffs = yield* computeDiff({ messages })
              if (isDeepStrictEqual(target.info.summary?.diffs, msgDiffs)) return
              yield* sessions.setSummary({
                sessionID: input.sessionID,
                summary: {
                  additions: 0,
                  deletions: 0,
                  files: 0,
                },
              })
              yield* events.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: [] })
              target.info.summary = { ...target.info.summary, diffs: msgDiffs }
              yield* sessions.updateMessage(target.info)
            }),
          ),
        (entry) =>
          Effect.sync(() => {
            if (--entry.users === 0) pending.delete(input.messageID)
          }),
      )
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      if (!input.messageID) return []
      const all = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      const message = all.find((item) => item.info.id === input.messageID)
      if (!message || message.info.role !== "user") return []
      const diffs = message.info.summary?.diffs ?? []
      // Local publish projects full patches. Only a patchless replay projection
      // needs snapshot recovery; successful recovery makes subsequent reads local.
      const resolved = yield* Effect.gen(function* () {
        if (diffs.every((item) => item.patch !== undefined)) return diffs
        const computed = yield* computeDiff({
          messages: all.filter(
            (item) =>
              item.info.id === input.messageID ||
              (item.info.role === "assistant" && item.info.parentID === input.messageID),
          ),
        }).pipe(Effect.catchCause(() => Effect.succeed([] as Snapshot.FileDiff[])))
        const patches = new Map(
          computed.filter((item) => item.file !== undefined).map((item) => [unquoteGitPath(item.file!), item.patch]),
        )
        const recovered = diffs.map((item) => {
          if (item.patch !== undefined) return item
          const patch = item.file === undefined ? undefined : patches.get(unquoteGitPath(item.file))
          // truncated is runtime-only: FileDiff's schema drops it, so never persist
          // a failed recovery (including its empty patch) as a complete projection.
          return patch === undefined ? { ...item, patch: "", truncated: true } : { ...item, patch }
        })
        if (recovered.some((item) => "truncated" in item)) return recovered
        const row = yield* db
          .select()
          .from(MessageTable)
          .where(and(eq(MessageTable.id, message.info.id), eq(MessageTable.session_id, input.sessionID)))
          .get()
          .pipe(Effect.orDie)
        if (
          row?.data.role === "user" &&
          typeof row.data.summary === "object" &&
          isDeepStrictEqual(row.data.summary.diffs, diffs)
        ) {
          // Bypass publish/updateMessage. A read must neither recurse nor append an
          // event; the compare-and-set also avoids overwriting a concurrent update.
          yield* db
            .update(MessageTable)
            .set({ data: { ...row.data, summary: { ...row.data.summary, diffs: recovered } } })
            .where(and(eq(MessageTable.id, row.id), eq(MessageTable.data, row.data)))
            .run()
            .pipe(Effect.orDie)
        }
        return recovered
      })
      return resolved.map((item) => {
        if (item.file === undefined) return item
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Session.node, Snapshot.node, EventV2Bridge.node, Config.node, Database.node],
})

export * as SessionSummary from "./summary"
