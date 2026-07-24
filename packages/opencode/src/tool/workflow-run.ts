import { AgentV2 } from "@opencode-ai/core/agent"
import { waitForAbort } from "@opencode-ai/core/process"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Workflow } from "@opencode-ai/core/workflow"
import { WorkflowHandoff } from "@opencode-ai/core/workflow/handoff"
import { WorkflowRuntime } from "@opencode-ai/core/workflow/runtime"
import { WorkflowSchema } from "@opencode-ai/core/workflow/schema"
import { Effect, Schema } from "effect"
import { AuthCredentialBridge } from "@/auth/credential-bridge"
import { Tool } from "./tool"

type Metadata = {
  [key: string]: unknown
  workflow: "heavy" | "council"
  status: WorkflowSchema.Status | "running"
  phase?: string
  progress?: string
  activeSessionID?: SessionSchema.ID
  rootSessionID?: SessionSchema.ID
  childSessionIDs: ReadonlyArray<SessionSchema.ID>
  childSessions: ReadonlyArray<ChildSession>
  reports: ReadonlyArray<WorkflowReport>
  councilUsed?: boolean
  error?: string
}

type ChildSession = {
  sessionID: SessionSchema.ID
  status: "running" | "completed" | "failed" | "timed_out"
  agent?: string
  title?: string
  stage?: string
  startedAt?: number
  updatedAt?: number
  elapsedMs?: number
  error?: string
}

type WorkflowReport = {
  sessionID: SessionSchema.ID
  status: "completed" | "partial" | "failed"
  title: string
  stage: string
  id?: string
}

const HeavyParameters = Schema.Struct({ task: Schema.String })
const CouncilParameters = Schema.Struct({ question: Schema.String })

export const HeavyRunTool = Tool.define<
  typeof HeavyParameters,
  Metadata,
  Workflow.Service | AuthCredentialBridge.Service,
  "heavy_run"
>(
  "heavy_run",
  Effect.gen(function* () {
    const workflow = yield* Workflow.Service
    const credentials = yield* AuthCredentialBridge.Service
    return {
      description:
        "Execute the complete objective as a recursive, write-capable Heavy workflow with durable child sessions.",
      parameters: HeavyParameters,
      execute: (input, context: Tool.Context<Metadata>) => {
        const progress = workflowProgress("heavy", context)
        return Effect.gen(function* () {
          yield* credentials.sync()
          return yield* workflow.heavy(input, {
            sessionID: SessionSchema.ID.make(context.sessionID),
            agent: AgentV2.ID.make("heavy"),
            assistantMessageID: SessionMessage.ID.make(context.messageID),
            toolCallID: context.callID || `${context.messageID}:heavy_run`,
            onProgress: progress.update,
          })
        }).pipe(
          Effect.raceFirst(waitForAbort(context.abort)),
          Effect.map((output) => {
            const reports = heavyReports(output)
            const metadata = progress.metadata(
              output.status,
              output.root_session_id,
              heavySessionIDs(output),
              undefined,
              reports,
            )
            return {
              title: `Heavy ${output.status}`,
              metadata,
              output: WorkflowHandoff.heavy(output, reportSessions(metadata.childSessions)),
            }
          }),
          Effect.catch((error) =>
            Effect.succeed({
              title: "Heavy failed",
              metadata: progress.metadata("failed", undefined, [], failureMessage(error)),
              output: `Heavy workflow failed: ${failureMessage(error)}`,
            }),
          ),
        )
      },
    } satisfies Tool.DefWithoutID<typeof HeavyParameters, Metadata>
  }),
)

export const CouncilRunTool = Tool.define<
  typeof CouncilParameters,
  Metadata,
  Workflow.Service | AuthCredentialBridge.Service,
  "council_run"
>(
  "council_run",
  Effect.gen(function* () {
    const workflow = yield* Workflow.Service
    const credentials = yield* AuthCredentialBridge.Service
    return {
      description:
        "Convene independent Council perspectives, run structured debate, and synthesize consensus and disagreement.",
      parameters: CouncilParameters,
      execute: (input, context: Tool.Context<Metadata>) => {
        const progress = workflowProgress("council", context)
        return Effect.gen(function* () {
          yield* credentials.sync()
          return yield* workflow.council(input, {
            sessionID: SessionSchema.ID.make(context.sessionID),
            agent: AgentV2.ID.make("council"),
            assistantMessageID: SessionMessage.ID.make(context.messageID),
            toolCallID: context.callID || `${context.messageID}:council_run`,
            onProgress: progress.update,
          })
        }).pipe(
          Effect.raceFirst(waitForAbort(context.abort)),
          Effect.map((output) => {
            const reports = councilReports(output)
            const metadata = progress.metadata(
              output.status,
              output.root_session_id,
              reports.map((report) => report.sessionID),
              undefined,
              reports,
            )
            return {
              title: `Council ${output.status}`,
              metadata,
              output: WorkflowHandoff.council(output, reportSessions(metadata.childSessions)),
            }
          }),
          Effect.catch((error) =>
            Effect.succeed({
              title: "Council failed",
              metadata: progress.metadata("failed", undefined, [], failureMessage(error)),
              output: `Council workflow failed: ${failureMessage(error)}`,
            }),
          ),
        )
      },
    } satisfies Tool.DefWithoutID<typeof CouncilParameters, Metadata>
  }),
)

function workflowProgress(workflow: Metadata["workflow"], context: Tool.Context<Metadata>) {
  const state: {
    phase?: string
    progress?: string
    activeSessionID?: SessionSchema.ID
    rootSessionID?: SessionSchema.ID
    childSessionIDs: Set<SessionSchema.ID>
    childSessions: Map<SessionSchema.ID, ChildSession>
    councilUsed: boolean
  } = { childSessionIDs: new Set(), childSessions: new Map(), councilUsed: false }

  const metadata = (
    status: Metadata["status"],
    rootSessionID?: SessionSchema.ID,
    childSessionIDs: ReadonlyArray<SessionSchema.ID> = [],
    error?: string,
    reports: ReadonlyArray<WorkflowReport> = [],
  ) => {
    if (rootSessionID) state.rootSessionID = rootSessionID
    if (state.rootSessionID) state.childSessionIDs.add(state.rootSessionID)
    childSessionIDs.forEach((sessionID) => state.childSessionIDs.add(sessionID))
    return {
      workflow,
      status,
      phase: status === "running" ? state.phase : status,
      progress: state.progress,
      activeSessionID: status === "running" ? state.activeSessionID : undefined,
      rootSessionID: state.rootSessionID,
      childSessionIDs: [...state.childSessionIDs],
      childSessions: [...state.childSessions.values()],
      reports,
      councilUsed: state.councilUsed || reports.some((report) => report.stage.startsWith("council")),
      error,
    } satisfies Metadata
  }

  return {
    metadata,
    update: (input: WorkflowRuntime.Progress) => {
      const rootSessionID = sessionID(input.structured.root_session_id)
      const activeSessionID = sessionID(input.structured.session_id)
      const childSessionIDs = Array.isArray(input.structured.session_ids)
        ? input.structured.session_ids.flatMap((value) => {
            const id = sessionID(value)
            return id ? [id] : []
          })
        : []
      const status = childStatus(input.structured.child_status)
      if (activeSessionID && status) {
        const previous = state.childSessions.get(activeSessionID)
        state.childSessions.set(activeSessionID, {
          sessionID: activeSessionID,
          status,
          agent: stringValue(input.structured.child_agent) ?? previous?.agent,
          title: stringValue(input.structured.child_title) ?? previous?.title,
          stage: stringValue(input.structured.stage) ?? previous?.stage,
          startedAt: numberValue(input.structured.started_at) ?? previous?.startedAt,
          updatedAt: numberValue(input.structured.updated_at) ?? previous?.updatedAt,
          elapsedMs: numberValue(input.structured.elapsed_ms) ?? previous?.elapsedMs,
          error: stringValue(input.structured.error) ?? previous?.error,
        })
      }
      state.phase = typeof input.structured.phase === "string" ? input.structured.phase : state.phase
      state.progress = input.text
      state.activeSessionID = activeSessionID ?? state.activeSessionID
      state.rootSessionID = state.rootSessionID ?? rootSessionID ?? activeSessionID
      state.councilUsed ||= workflow === "heavy" && input.structured.workflow === "council"
      return context.metadata({
        title: input.text,
        metadata: metadata("running", state.rootSessionID, [
          ...(activeSessionID ? [activeSessionID] : []),
          ...childSessionIDs,
        ]),
      })
    },
  }
}

function reportSessions(sessions: ReadonlyArray<ChildSession>): ReadonlyArray<WorkflowHandoff.Session> {
  return sessions.map((session) => ({
    session_id: session.sessionID,
    status: session.status,
    agent: session.agent,
    title: session.title,
    stage: session.stage,
    error: session.error,
  }))
}

function heavyReports(output: WorkflowSchema.HeavyOutput): ReadonlyArray<WorkflowReport> {
  return [
    ...output.nodes.map((node) => ({
      sessionID: node.session_id,
      status: node.status,
      title: node.title,
      stage: node.depth === 0 ? "final" : node.planning_session_id ? "synthesis" : "execution",
      id: node.id,
    })),
    ...(output.council ? councilReports(output.council, "council-") : []),
  ]
}

function heavySessionIDs(output: WorkflowSchema.HeavyOutput): ReadonlyArray<SessionSchema.ID> {
  return [
    ...new Set([
      output.root_session_id,
      ...output.nodes.flatMap((node) => [
        ...(node.planning_session_id ? [node.planning_session_id] : []),
        node.session_id,
      ]),
      ...(output.council
        ? [
            output.council.root_session_id,
            output.council.synthesis_session_id,
            ...output.council.perspectives.map((perspective) => perspective.session_id),
            ...output.council.debate.map((contribution) => contribution.session_id),
          ]
        : []),
    ]),
  ]
}

function councilReports(output: WorkflowSchema.CouncilOutput, stagePrefix = ""): ReadonlyArray<WorkflowReport> {
  return [
    {
      sessionID: output.synthesis_session_id,
      status: output.status,
      title: "Council synthesis",
      stage: `${stagePrefix}final`,
    },
    ...output.perspectives.map((perspective) => ({
      sessionID: perspective.session_id,
      status: "completed" as const,
      title: `Council: ${perspective.perspective_id}`,
      stage: `${stagePrefix}perspective`,
      id: perspective.perspective_id,
    })),
    ...output.debate.map((contribution) => ({
      sessionID: contribution.session_id,
      status: contribution.argument.startsWith("Debate stage failed:") ? ("failed" as const) : ("completed" as const),
      title: `Council debate: ${contribution.issue_id}, round ${contribution.round}`,
      stage: `${stagePrefix}debate`,
      id: `${contribution.issue_id}:${contribution.perspective_id}:${contribution.round}`,
    })),
  ]
}

function sessionID(value: unknown) {
  return typeof value === "string" && value ? SessionSchema.ID.make(value) : undefined
}

function childStatus(value: unknown): ChildSession["status"] | undefined {
  if (value === "running" || value === "completed" || value === "failed" || value === "timed_out") return value
  return undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
