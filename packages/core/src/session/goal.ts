export * as SessionGoal from "./goal.js"

import { and, desc, eq } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { diffLines } from "diff"
import { SessionGoal } from "@opencode/schema/session-goal"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { SessionEvent } from "./event.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionMessageTable, SessionTable } from "./sql.js"
import { SessionTeam } from "./team.js"
import { KV } from "../kv.js"

export const continuation = (objective: string) => `現在のゴール:
${objective}

このゴールの達成に向けて作業を続けてください。
まずこれまでの作業結果を確認してください。
もしゴールをすべて達成できた場合は、結果を検証して、update_goal({ status: "complete" }) を呼んでください。
そうでない場合は、次に必要な作業を続けてください。`

export class Error extends Schema.TaggedError<Error>()("SessionGoal.Error", { message: Schema.String }) {}

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionGoal.Info | undefined>
  readonly set: (sessionID: SessionSchema.ID, objective: string) => Effect.Effect<void, Error>
  readonly status: (sessionID: SessionSchema.ID, status: SessionGoal.Status) => Effect.Effect<void, Error>
  readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly update: (sessionID: SessionSchema.ID, input: SessionGoal.Update) => Effect.Effect<void, Error>
  readonly inspect: (sessionID: SessionSchema.ID) => Effect.Effect<SessionGoal.Monitor>
  readonly enqueue: (sessionID: SessionSchema.ID, active?: ReadonlySet<SessionSchema.ID>) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoal") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    const inbox = yield* SessionInbox.Service
    const teams = yield* SessionTeam.Service
    const kv = yield* KV.Service
    const monitorKey = (id: SessionSchema.ID) => `session.goal-monitor.${id}`
    const readMonitor = (id: SessionSchema.ID) =>
      kv.get(monitorKey(id)).pipe(
        Effect.map((value) =>
          Schema.decodeUnknownSync(
            Schema.Struct({
              times: Schema.Array(Schema.Number),
              approvalWaits: Schema.Number,
              lastUserID: Schema.optionalKey(Schema.String),
            }),
          )(value ?? { times: [], approvalWaits: 0 }),
        ),
      )
    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select({ goal: SessionTable.goal })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return row?.goal ?? undefined
    })
    const notify = (sessionID: SessionSchema.ID, description: string, goal?: SessionGoal.Info, previous?: string) => {
      const changes =
        previous !== undefined && goal && previous !== goal.objective
          ? diffLines(previous, goal.objective)
              .flatMap((part) =>
                part.added || part.removed
                  ? part.value.split("\n").map((line) => `${part.added ? "+" : "-"} ${line}`)
                  : [],
              )
              .join("\n")
          : ""
      return bus.publish(SessionEvent.Synthetic, {
        sessionID,
        description,
        text: [
          description,
          changes ? `変更点:\n${changes}` : "",
          goal
            ? `状態: ${goal.status}${goal.reason ? `\n理由: ${goal.reason}` : ""}\n\n現在のゴール:\n${goal.objective}`
            : "現在のゴールは未設定です。",
        ]
          .filter(Boolean)
          .join("\n\n"),
        metadata: { goalUpdate: true },
      })
    }
    const cancelPending = Effect.fn("SessionGoal.cancelPending")(function* (sessionID: SessionSchema.ID) {
      const pending = (yield* inbox.list(sessionID)).filter(
        (item) => item.type === "synthetic" && item.payload.metadata?.goalContinuation === true,
      )
      yield* Effect.forEach(
        pending,
        (item) => bus.publish(SessionEvent.InboxCancelled, { sessionID, inboxID: item.id }),
        { discard: true },
      )
    })
    const update = (sessionID: SessionSchema.ID, input: SessionGoal.Update) =>
      SessionInbox.serialized(
        sessionID,
        Effect.gen(function* () {
          const goal = yield* get(sessionID)
          if (!goal) return yield* new Error({ message: "No goal is set" })
          const objective = input.objective?.trim() ?? goal.objective
          if (!objective) return yield* new Error({ message: "Goal objective is required" })
          const status = input.status ?? goal.status
          const awaitingApproval = Boolean(input.awaitingApproval ?? (input.status ? false : goal.awaitingApproval))
          const reason =
            input.reason?.trim() ?? (input.status || input.awaitingApproval === false ? undefined : goal.reason)
          if (status === "blocked" && !reason) return yield* new Error({ message: "A blocked goal requires a reason" })
          const edited = objective !== goal.objective
          const changed =
            status !== goal.status || reason !== goal.reason || awaitingApproval !== Boolean(goal.awaitingApproval)
          if (!edited && !changed) return
          yield* cancelPending(sessionID)
          if (edited) yield* bus.publish(SessionEvent.GoalEdited, { sessionID, objective })
          if (changed)
            yield* bus.publish(SessionEvent.GoalStatusChanged, {
              sessionID,
              status,
              ...(reason ? { reason } : {}),
              ...(awaitingApproval ? { awaitingApproval } : {}),
            })
          if (edited || (status === "active" && goal.status !== "active")) yield* kv.remove(monitorKey(sessionID))
          else if (awaitingApproval !== Boolean(goal.awaitingApproval)) {
            yield* kv.set(monitorKey(sessionID), { ...(yield* readMonitor(sessionID)), approvalWaits: 0 })
          }
          yield* notify(
            sessionID,
            edited ? "ゴールが更新されました" : "ゴールの状態が変更されました",
            {
              objective,
              status,
              ...(reason ? { reason } : {}),
              ...(awaitingApproval ? { awaitingApproval } : {}),
            },
            goal.objective,
          )
        }),
      )
    return Service.of({
      get,
      update,
      inspect: (sessionID) =>
        Effect.gen(function* () {
          const monitor = yield* readMonitor(sessionID)
          const now = yield* Clock.currentTimeMillis
          return {
            goal: (yield* get(sessionID)) ?? null,
            continuationCount: monitor.times.filter((time) => now - time < 600_000).length,
            approvalWaits: monitor.approvalWaits,
          }
        }),
      set: (sessionID, objective) =>
        SessionInbox.serialized(
          sessionID,
          Effect.gen(function* () {
            if (!objective.trim()) return yield* new Error({ message: "Goal objective is required" })
            yield* cancelPending(sessionID)
            yield* bus.publish(SessionEvent.GoalSet, { sessionID, objective: objective.trim() })
            yield* kv.remove(monitorKey(sessionID))
            yield* notify(sessionID, "ゴールが設定されました", { objective: objective.trim(), status: "active" })
          }),
        ),
      status: (sessionID, status) => update(sessionID, { status }),
      clear: (sessionID) =>
        SessionInbox.serialized(
          sessionID,
          Effect.gen(function* () {
            yield* cancelPending(sessionID)
            yield* bus.publish(SessionEvent.GoalCleared, { sessionID })
            yield* kv.remove(monitorKey(sessionID))
            yield* notify(sessionID, "ゴールが削除されました")
          }),
        ),
      enqueue: (sessionID, active) =>
        SessionInbox.serialized(
          sessionID,
          Effect.gen(function* () {
            const goal = yield* get(sessionID)
            if (goal?.status !== "active" || (yield* SessionInbox.has(db, sessionID, "input"))) return false
            const membership = yield* teams.membership(sessionID)
            const members = membership
              ? yield* teams.roster(membership)
              : (yield* teams.teamsOf(sessionID)).flatMap((team) => team.entries)
            if (members.length > 0) {
              // Team goals resume only after the execution coordinator observes the whole team idle.
              if (!active || active.has(sessionID)) return false
              for (const member of members) {
                if (active.has(member.sessionID) || (yield* SessionInbox.has(db, member.sessionID, "input")))
                  return false
              }
            }
            const now = yield* Clock.currentTimeMillis
            const monitor = yield* readMonitor(sessionID)
            const times = [...monitor.times.filter((time) => now - time < 600_000), now].slice(-50)
            const lastUser = yield* db
              .select({ id: SessionMessageTable.id })
              .from(SessionMessageTable)
              .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "user")))
              .orderBy(desc(SessionMessageTable.seq))
              .limit(1)
              .get()
              .pipe(Effect.orDie)
            const approvalWaits = goal.awaitingApproval
              ? (monitor.lastUserID === lastUser?.id ? monitor.approvalWaits : 0) + 1
              : 0
            yield* inbox
              .admit({
                sessionID,
                id: SessionMessage.ID.create(),
                item: {
                  type: "synthetic",
                  delivery: "queue",
                  payload: {
                    text: continuation(goal.objective),
                    description: "Goal continuation",
                    metadata: { goalContinuation: true },
                  },
                },
              })
              .pipe(Effect.orDie)
            yield* kv.set(monitorKey(sessionID), {
              times,
              approvalWaits,
              ...(lastUser ? { lastUserID: lastUser.id } : {}),
            })
            if (times.length >= 50 || approvalWaits >= 3) {
              const status = approvalWaits >= 3 ? "blocked" : "paused"
              const reason =
                approvalWaits >= 3
                  ? "承認待ちのまま自動継続が3回続いたため、停止しました。"
                  : "自動継続が10分間に50回発生したため、一時停止しました。"
              yield* bus.publish(SessionEvent.GoalStatusChanged, { sessionID, status, reason })
              yield* notify(sessionID, reason, { objective: goal.objective, status, reason })
            }
            return true
          }),
        ),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Bus.node, SessionInbox.node, SessionTeam.node, KV.node],
})
