export * as QualityGate from "./quality-gate"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { PartTable, SessionTable } from "../session/sql"
import { SessionSchema } from "../session/schema"
import { SessionTodo } from "../session/todo"

export const QualityGateResult = Schema.Struct({
  passed: Schema.Boolean,
  score: Schema.Number,
  completedTodos: Schema.Number,
  totalTodos: Schema.Number,
  failedTools: Schema.Array(Schema.String),
  verificationCommands: Schema.Array(Schema.String),
  passedVerificationCommands: Schema.Array(Schema.String),
  failedVerificationCommands: Schema.Array(Schema.String),
  issues: Schema.Array(Schema.String),
  failureReasons: Schema.Array(Schema.String),
  summary: Schema.String,
}).annotate({ identifier: "QualityGate.QualityGateResult" })

export type QualityGateResult = typeof QualityGateResult.Type

export interface Interface {
  readonly evaluateSession: (sessionID: string) => Effect.Effect<QualityGateResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/QualityGate") {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toolStatus(data: Record<string, unknown>) {
  return isRecord(data.state) && typeof data.state.status === "string" ? data.state.status : "unknown"
}

function toolFailed(data: Record<string, unknown>) {
  if (toolStatus(data) === "error") return true
  return isRecord(data.state) && typeof data.state.metadata === "object" && data.state.metadata !== null
    ? typeof (data.state.metadata as Record<string, unknown>).exit === "number" &&
        (data.state.metadata as Record<string, unknown>).exit !== 0
    : false
}

function toolEvidence(data: Record<string, unknown>) {
  if (typeof data.tool !== "string") return "unknown tool"
  if (isRecord(data.state) && isRecord(data.state.input) && typeof data.state.input.command === "string") {
    return data.state.input.command
  }
  return data.tool
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const todosSvc = yield* SessionTodo.Service

    const evaluateSession = Effect.fn("QualityGate.evaluateSession")(function* (sessionID: string) {
      const typedSessionID = SessionSchema.ID.make(sessionID)
      const todos = yield* todosSvc.get(typedSessionID).pipe(Effect.orDie)
      const parts = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.session_id, typedSessionID))
        .all()
        .pipe(Effect.orDie)

      const failedTools: string[] = []
      const verificationCommands: string[] = []
      const passedVerificationCommands: string[] = []
      const failedVerificationCommands: string[] = []

      for (const part of parts) {
        const data: unknown = part.data
        if (!isRecord(data) || data.type !== "tool") continue

        const toolName = typeof data.tool === "string" ? data.tool : "unknown tool"
        const status = toolStatus(data)
        const failed = toolFailed(data)
        if (failed) failedTools.push(toolName)

        const evidence = toolEvidence(data)
        verificationCommands.push(evidence)
        if (!failed && status === "completed") passedVerificationCommands.push(evidence)
        else failedVerificationCommands.push(evidence)
      }

      const totalTodos = todos.length
      const completedTodos = todos.filter((todo) => todo.status === "completed").length
      const issues: string[] = []
      if (totalTodos > 0 && completedTodos < totalTodos) issues.push(`${totalTodos - completedTodos} todo(s) are unfinished.`)
      if (failedTools.length > 0) issues.push(`Failed tools: ${failedTools.join(", ")}`)
      if (verificationCommands.length === 0) issues.push("No completed tool evidence was recorded.")
      if (failedVerificationCommands.length > 0) {
        issues.push(`Verification failed: ${failedVerificationCommands.join(", ")}`)
      }

      const todosAreComplete = totalTodos === 0 || completedTodos === totalTodos
      const passed =
        todosAreComplete &&
        failedTools.length === 0 &&
        passedVerificationCommands.length > 0 &&
        failedVerificationCommands.length === 0
      const score = Math.max(
        0,
        5 -
          (todosAreComplete ? 0 : 2) -
          (failedTools.length > 0 ? 1 : 0) -
          (verificationCommands.length === 0 ? 1 : 0) -
          (failedVerificationCommands.length > 0 ? 2 : 0),
      )
      const result: QualityGateResult = {
        passed,
        score,
        completedTodos,
        totalTodos,
        failedTools,
        verificationCommands,
        passedVerificationCommands,
        failedVerificationCommands,
        issues,
        failureReasons: issues,
        summary: passed
          ? "The task has complete todos, successful tools, and successful verification."
          : "The task has insufficient or failed execution evidence.",
      }
      const session = yield* db
        .select({ metadata: SessionTable.metadata })
        .from(SessionTable)
        .where(eq(SessionTable.id, typedSessionID))
        .get()
        .pipe(Effect.orDie)
      if (!session) return yield* Effect.die(`Session ${sessionID} was not found while persisting Quality Gate result.`)

      const updatedMetadata = { ...(session.metadata ?? {}), qualityGate: result }

      yield* db
        .update(SessionTable)
        .set({ metadata: updatedMetadata })
        .where(eq(SessionTable.id, typedSessionID))
        .run()
        .pipe(Effect.orDie)

      return result
    })

    return Service.of({ evaluateSession })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node, SessionTodo.node] })