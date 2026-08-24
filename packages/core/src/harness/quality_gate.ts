export * as QualityGate from "./quality_gate"

import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { SessionTodo } from "../session/todo"
import { PartTable } from "../session/sql"
import { SessionSchema } from "../session/schema"
import { makeLocationNode } from "../effect/app-node"
import { eq } from "drizzle-orm"

export const QualityGateResult = Schema.Struct({
  passed: Schema.Boolean,
  score: Schema.Number,
  completedTodos: Schema.Number,
  totalTodos: Schema.Number,
  failedTools: Schema.Array(Schema.String),
  verificationCommands: Schema.Array(Schema.String),
  issues: Schema.Array(Schema.String),
  summary: Schema.String,
}).annotate({
  identifier: "QualityGate.QualityGateResult",
})

export type QualityGateResult = typeof QualityGateResult.Type

export interface Interface {
  readonly evaluateSession: (
    sessionID: string,
  ) => Effect.Effect<QualityGateResult>
}

export class Service extends Context.Service<Service, Interface>()(
  "@opencode/v2/QualityGate",
) {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getCommand(data: unknown): string {
  if (!isRecord(data)) return ""

  const state = isRecord(data.state) ? data.state : {}
  const input = isRecord(state.input) ? state.input : {}

  if (typeof input.command === "string") {
    return input.command
  }

  return ""
}

// Language-agnostic verification detection.
// The Quality Gate does not execute commands.
// It only checks commands already executed by the agent.
function isVerificationCommand(command: string): boolean {
  return /\b(test|tests|pytest|lint|typecheck|type-check|build|verify|check)\b/i.test(
    command,
  )
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const todosSvc = yield* SessionTodo.Service

    const evaluateSession = Effect.fn(
      "QualityGate.evaluateSession",
    )(function* (sessionID: string) {
      console.log("🔥 QUALITY GATE CALLED:", sessionID)

      const typedSessionID = SessionSchema.ID.make(sessionID)

      // 1. Get session todos
      const todos = yield* todosSvc
        .get(typedSessionID)
        .pipe(Effect.orElseSucceed(() => []))

      const totalTodos = todos.length

      const completedTodos = todos.filter(
        (todo) => todo.status === "completed",
      ).length

      // 2. Get actual tool history
      const parts = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.session_id, typedSessionID))
        .all()
        .pipe(Effect.orElseSucceed(() => []))

      const failedTools: string[] = []
      const verificationCommands: string[] = []
      const verificationFailures: string[] = []

      // 3. Analyze tool executions
      for (const part of parts) {
        const rawData = part.data

        if (!isRecord(rawData)) {
          continue
        }

        const data = rawData as Record<string, unknown>

        if (data.type !== "tool") {
          continue
        }

        const toolName =
          typeof (data as any).tool === "string"
            ? (data as any).tool
            : "unknown tool"

        const state = isRecord((data as any).state)
          ? (data as any).state
          : {}

        const status =
          typeof state.status === "string"
            ? state.status
            : "unknown"

        // Check failed tools
        if (
          status === "failed" ||
          status === "error"
        ) {
          failedTools.push(toolName)
        }

        // Extract actual command
        const command = getCommand(data)

        if (!command) {
          continue
        }

        // Detect verification commands dynamically
        if (isVerificationCommand(command)) {
          verificationCommands.push(command)

          if (
            status === "failed" ||
            status === "error"
          ) {
            verificationFailures.push(command)
          }
        }
      }

      // 4. Find issues
      const issues: string[] = []

      if (
        totalTodos > 0 &&
        completedTodos < totalTodos
      ) {
        issues.push(
          `${totalTodos - completedTodos} todo(s) are unfinished.`,
        )
      }

      if (failedTools.length > 0) {
        issues.push(
          `Failed tools: ${failedTools.join(", ")}`,
        )
      }

      if (verificationCommands.length === 0) {
        issues.push(
          "No verification command was detected.",
        )
      }

      if (verificationFailures.length > 0) {
        issues.push(
          `Verification failed: ${verificationFailures.join(", ")}`,
        )
      }

      // 5. Calculate score from actual evidence
      let score = 5

      if (
        totalTodos > 0 &&
        completedTodos < totalTodos
      ) {
        score -= 2
      }

      if (failedTools.length > 0) {
        score -= 1
      }

      if (verificationCommands.length === 0) {
        score -= 1
      }

      if (verificationFailures.length > 0) {
        score -= 2
      }

      score = Math.max(0, Math.min(5, score))

      // 6. Final Quality Gate decision
      const todosAreComplete =
        totalTodos === 0 ||
        completedTodos === totalTodos

      const toolsAreSuccessful =
        failedTools.length === 0

      const verificationIsSuccessful =
        verificationCommands.length > 0 &&
        verificationFailures.length === 0

      const passed =
        todosAreComplete &&
        toolsAreSuccessful &&
        verificationIsSuccessful

      // 7. Create summary
      const summary = passed
        ? "The task has complete todos, successful tools, and successful verification."
        : "The task has insufficient or failed execution evidence."

      console.log("========== QUALITY GATE ==========")
      console.log({
        passed,
        score,
        completedTodos,
        totalTodos,
        failedTools,
        verificationCommands,
        issues,
        summary,
      })
      console.log("==================================")

      return {
        passed,
        score,
        completedTodos,
        totalTodos,
        failedTools,
        verificationCommands,
        issues,
        summary,
      }
    })

    return Service.of({
      evaluateSession,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, SessionTodo.node],
})