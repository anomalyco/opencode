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
  workflow: "heavy" | "council" | "research"
  status: WorkflowSchema.Status | "running"
  executionStatus?: WorkflowSchema.ExecutionStatus
  artifactStatus?: WorkflowSchema.ArtifactStatus
  evidenceStatus?: WorkflowSchema.Status
  usage?: WorkflowSchema.Usage
  timing?: WorkflowSchema.RunTiming
  phase?: string
  progress?: string
  activeSessionID?: SessionSchema.ID
  rootSessionID?: SessionSchema.ID
  childSessionIDs: ReadonlyArray<SessionSchema.ID>
  childSessions: ReadonlyArray<ChildSession>
  reports: ReadonlyArray<WorkflowReport>
  reportPath?: string
  councilUsed?: boolean
  error?: string
}

type ChildSession = {
  sessionID: SessionSchema.ID
  parentSessionID?: SessionSchema.ID
  runID?: string
  parentRunID?: string
  status: "queued" | "running" | "completed" | "failed" | "timed_out"
  activity?: "queued" | "provider_active" | "waiting_on_delegation" | "recovering"
  workflow?: "heavy" | "council" | "research"
  agent?: string
  title?: string
  stage?: string
  nodeID?: string
  parentNodeID?: string
  depth?: number
  capability?: string
  dependsOn?: ReadonlyArray<string>
  issue?: string
  round?: number
  reportPath?: string
  promptBytes?: number
  startedAt?: number
  activeAt?: number
  updatedAt?: number
  elapsedMs?: number
  queueMs?: number
  waitingMs?: number
  activeMs?: number
  recoveryAttempts?: number
  usage?: WorkflowSchema.Usage
  error?: string
}

type WorkflowReport = {
  sessionID: SessionSchema.ID
  status: "completed" | "partial" | "failed"
  title: string
  stage: string
  id?: string
  reportPath?: string
}

const HeavyParameters = Schema.Struct({ task: Schema.String })
const CouncilParameters = Schema.Struct({
  question: Schema.String,
  issue_key: Schema.String.pipe(Schema.optional),
  artifact_paths: Schema.Array(Schema.String).pipe(Schema.optional),
})
const ResearchParameters = Schema.Struct({
  question: Schema.String,
  effort: Schema.Literals(["standard", "deep", "frontier"]).pipe(Schema.optional),
  capability: WorkflowSchema.Capability.pipe(Schema.optional),
})

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
            progress.hydrate(output.session_manifest)
            const reports = heavyReports(output)
            const metadata = {
              ...progress.metadata(output.status, output.root_session_id, heavySessionIDs(output), undefined, reports),
              executionStatus: output.execution_status,
              artifactStatus: output.artifact_status,
              evidenceStatus: output.evidence_status,
              usage: output.usage,
              timing: output.timing,
            }
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
            progress.hydrate(output.session_manifest)
            const reports = councilReports(output)
            const metadata = {
              ...progress.metadata(
                output.status,
                output.root_session_id,
                councilSessionIDs(output),
                undefined,
                reports,
              ),
              executionStatus: output.execution_status,
              artifactStatus: output.artifact_status,
              evidenceStatus: output.evidence_status,
              usage: output.usage,
              timing: output.timing,
            }
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

export const ResearchRunTool = Tool.define<
  typeof ResearchParameters,
  Metadata,
  Workflow.Service | AuthCredentialBridge.Service,
  "research_run"
>(
  "research_run",
  Effect.gen(function* () {
    const workflow = yield* Workflow.Service
    const credentials = yield* AuthCredentialBridge.Service
    return {
      description:
        "Run adaptive deep research with an evidence graph, hierarchical synthesis, and Council review for consequential disputes.",
      parameters: ResearchParameters,
      execute: (input, context: Tool.Context<Metadata>) => {
        const progress = workflowProgress("research", context)
        return Effect.gen(function* () {
          yield* credentials.sync()
          return yield* workflow.research(input, {
            sessionID: SessionSchema.ID.make(context.sessionID),
            agent: AgentV2.ID.make("research"),
            assistantMessageID: SessionMessage.ID.make(context.messageID),
            toolCallID: context.callID || `${context.messageID}:research_run`,
            onProgress: progress.update,
          })
        }).pipe(
          Effect.raceFirst(waitForAbort(context.abort)),
          Effect.map((output) => {
            progress.hydrate(output.session_manifest)
            const reports = researchReports(output)
            const metadata = {
              ...progress.metadata(
                output.status,
                output.root_session_id,
                researchSessionIDs(output),
                undefined,
                reports,
              ),
              executionStatus: output.execution_status,
              artifactStatus: output.artifact_status,
              evidenceStatus: output.evidence_status,
              usage: output.usage,
              timing: output.timing,
            }
            return {
              title: `Research ${output.status}`,
              metadata,
              output: WorkflowHandoff.research(output, reportSessions(metadata.childSessions)),
            }
          }),
          Effect.catch((error) =>
            Effect.succeed({
              title: "Research failed",
              metadata: progress.metadata("failed", undefined, [], failureMessage(error)),
              output: `Research workflow failed: ${failureMessage(error)}`,
            }),
          ),
        )
      },
    } satisfies Tool.DefWithoutID<typeof ResearchParameters, Metadata>
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
    if (status !== "running")
      state.childSessionIDs.forEach((sessionID) => {
        if (state.childSessions.has(sessionID)) return
        const report = reports.find((item) => item.sessionID === sessionID)
        state.childSessions.set(sessionID, {
          sessionID,
          status: report?.status === "failed" || status === "failed" ? "failed" : "completed",
          workflow: reportWorkflow(report, workflow),
          title: report?.title ?? `${workflowName(workflow)} workflow session`,
          stage: report?.stage,
          reportPath: report?.reportPath,
        })
      })
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
      reportPath: reports.find((report) => report.stage === "final")?.reportPath,
      error,
    } satisfies Metadata
  }

  return {
    metadata,
    hydrate: (sessions: ReadonlyArray<WorkflowSchema.SessionStage> = []) => {
      sessions.forEach((session) => {
        state.childSessionIDs.add(session.session_id)
        const previous = state.childSessions.get(session.session_id)
        state.childSessions.set(session.session_id, {
          sessionID: session.session_id,
          parentSessionID: session.parent_session_id ?? previous?.parentSessionID,
          runID: session.run_id,
          parentRunID: session.parent_run_id ?? previous?.parentRunID,
          status: session.status,
          activity: session.activity,
          workflow: session.workflow,
          agent: session.agent,
          title: session.title,
          stage: session.stage,
          nodeID: session.node_id ?? previous?.nodeID,
          parentNodeID: session.parent_node_id ?? previous?.parentNodeID,
          depth: session.node_depth ?? session.workflow_depth,
          capability: session.capability ?? previous?.capability,
          dependsOn: session.depends_on ?? previous?.dependsOn,
          issue: session.issue ?? previous?.issue,
          round: session.round ?? previous?.round,
          reportPath: session.report_path ?? previous?.reportPath,
          promptBytes: session.prompt_bytes ?? previous?.promptBytes,
          startedAt: session.started_at,
          activeAt: session.active_at,
          updatedAt: session.updated_at,
          elapsedMs: session.elapsed_ms,
          queueMs: session.queue_ms,
          waitingMs: session.waiting_ms,
          activeMs: session.active_ms,
          recoveryAttempts: session.recovery_attempts,
          usage: session.usage,
          error: session.status === "completed" ? undefined : (session.error ?? previous?.error),
        })
      })
    },
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
          parentSessionID: sessionID(input.structured.parent_session_id) ?? previous?.parentSessionID,
          runID: stringValue(input.structured.run_id) ?? previous?.runID,
          parentRunID: stringValue(input.structured.parent_run_id) ?? previous?.parentRunID,
          status,
          activity:
            status === "queued" || status === "running"
              ? (activityValue(input.structured.child_activity) ?? previous?.activity)
              : undefined,
          workflow: workflowValue(input.structured.workflow) ?? previous?.workflow,
          agent: stringValue(input.structured.child_agent) ?? previous?.agent,
          title: stringValue(input.structured.child_title) ?? previous?.title,
          stage: stringValue(input.structured.stage) ?? previous?.stage,
          nodeID: stringValue(input.structured.node_id) ?? previous?.nodeID,
          parentNodeID: stringValue(input.structured.parent_node_id) ?? previous?.parentNodeID,
          depth:
            numberValue(input.structured.node_depth) ?? numberValue(input.structured.workflow_depth) ?? previous?.depth,
          capability: stringValue(input.structured.capability) ?? previous?.capability,
          dependsOn: stringArray(input.structured.depends_on) ?? previous?.dependsOn,
          issue: stringValue(input.structured.issue) ?? previous?.issue,
          round: numberValue(input.structured.round) ?? previous?.round,
          reportPath: stringValue(input.structured.report_path) ?? previous?.reportPath,
          promptBytes: numberValue(input.structured.prompt_bytes) ?? previous?.promptBytes,
          startedAt: numberValue(input.structured.started_at) ?? previous?.startedAt,
          activeAt: numberValue(input.structured.active_at) ?? previous?.activeAt,
          updatedAt: numberValue(input.structured.updated_at) ?? previous?.updatedAt,
          elapsedMs: numberValue(input.structured.elapsed_ms) ?? previous?.elapsedMs,
          queueMs: numberValue(input.structured.queue_ms) ?? previous?.queueMs,
          waitingMs: numberValue(input.structured.waiting_ms) ?? previous?.waitingMs,
          activeMs: numberValue(input.structured.active_ms) ?? previous?.activeMs,
          recoveryAttempts: numberValue(input.structured.recovery_attempts) ?? previous?.recoveryAttempts,
          error: status === "completed" ? undefined : (stringValue(input.structured.error) ?? previous?.error),
        })
      }
      state.phase = typeof input.structured.phase === "string" ? input.structured.phase : state.phase
      state.progress = input.text
      state.activeSessionID = activeSessionID ?? state.activeSessionID
      state.rootSessionID = state.rootSessionID ?? rootSessionID ?? activeSessionID
      state.councilUsed ||= workflow !== "council" && input.structured.workflow === "council"
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
    parent_session_id: session.parentSessionID,
    run_id: session.runID,
    parent_run_id: session.parentRunID,
    status: session.status,
    activity: session.activity,
    workflow: session.workflow,
    agent: session.agent,
    title: session.title,
    stage: session.stage,
    node_id: session.nodeID,
    parent_node_id: session.parentNodeID,
    depth: session.depth,
    depends_on: session.dependsOn,
    report_path: session.reportPath,
    error: session.error,
    usage: session.usage,
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
      reportPath: node.depth === 0 ? output.report_path : node.report_path,
    })),
    ...(output.delegations ?? []).map((delegation) => ({
      sessionID: delegation.root_session_id,
      status: delegation.status,
      title: `${workflowName(delegation.workflow)}: ${delegation.objective}`,
      stage: `${delegation.workflow}-delegation`,
      id: delegation.id,
      reportPath: delegation.report_path,
    })),
    ...(output.council ? councilReports(output.council, "council-") : []),
  ]
}

function heavySessionIDs(output: WorkflowSchema.HeavyOutput): ReadonlyArray<SessionSchema.ID> {
  return [
    ...new Set([
      output.root_session_id,
      ...(output.session_manifest?.map((session) => session.session_id) ?? []),
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
      ...(output.delegations ?? []).flatMap((delegation) => [
        delegation.root_session_id,
        ...(delegation.session_ids ?? []),
      ]),
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
      reportPath: output.report_path,
    },
    ...output.perspectives.map((perspective) => ({
      sessionID: perspective.session_id,
      status: "completed" as const,
      title: `Council: ${perspective.perspective_id}`,
      stage: `${stagePrefix}perspective`,
      id: perspective.perspective_id,
      reportPath: perspective.report_path,
    })),
    ...output.debate.map((contribution) => ({
      sessionID: contribution.session_id,
      status: contribution.argument.startsWith("Debate stage failed:") ? ("failed" as const) : ("completed" as const),
      title: `Council debate: ${contribution.issue_id}, round ${contribution.round}`,
      stage: `${stagePrefix}debate`,
      id: `${contribution.issue_id}:${contribution.perspective_id}:${contribution.round}`,
      reportPath: contribution.report_path,
    })),
    ...(output.delegations ?? []).map((delegation) => ({
      sessionID: delegation.root_session_id,
      status: delegation.status,
      title: `${workflowName(delegation.workflow)}: ${delegation.objective}`,
      stage: `${delegation.workflow}-delegation`,
      id: delegation.id,
      reportPath: delegation.report_path,
    })),
  ]
}

function councilSessionIDs(output: WorkflowSchema.CouncilOutput): ReadonlyArray<SessionSchema.ID> {
  return [
    ...new Set([
      output.root_session_id,
      ...(output.session_manifest?.map((session) => session.session_id) ?? []),
      output.synthesis_session_id,
      ...output.perspectives.map((perspective) => perspective.session_id),
      ...output.debate.map((contribution) => contribution.session_id),
      ...(output.delegations ?? []).flatMap((delegation) => [
        delegation.root_session_id,
        ...(delegation.session_ids ?? []),
      ]),
    ]),
  ]
}

function researchReports(output: WorkflowSchema.ResearchOutput): ReadonlyArray<WorkflowReport> {
  return [
    ...output.nodes.flatMap((node) => [
      {
        sessionID: node.synthesis_session_id,
        status: node.result.status,
        title: node.title,
        stage: node.depth === 0 ? "final" : "research-branch",
        id: node.id,
        reportPath: node.depth === 0 ? output.report_path : node.report_path,
      },
      ...node.waves.flatMap((wave) =>
        wave.tasks.map((task) => ({
          sessionID: task.session_id,
          status: task.status,
          title: task.title,
          stage: "research-evidence",
          id: task.id,
          reportPath: task.report_path,
        })),
      ),
    ]),
    ...output.councils.flatMap((review) => councilReports(review.output, "council-")),
    ...(output.delegations ?? []).map((delegation) => ({
      sessionID: delegation.root_session_id,
      status: delegation.status,
      title: `${workflowName(delegation.workflow)}: ${delegation.objective}`,
      stage: `${delegation.workflow}-delegation`,
      id: delegation.id,
      reportPath: delegation.report_path,
    })),
  ]
}

function researchSessionIDs(output: WorkflowSchema.ResearchOutput): ReadonlyArray<SessionSchema.ID> {
  return [
    ...new Set([
      output.root_session_id,
      ...(output.session_manifest?.map((session) => session.session_id) ?? []),
      ...output.nodes.flatMap((node) => [
        node.planning_session_id,
        node.synthesis_session_id,
        ...node.waves.flatMap((wave) => [wave.assessment_session_id, ...wave.tasks.map((task) => task.session_id)]),
      ]),
      ...output.councils.flatMap((review) => [
        review.output.root_session_id,
        review.output.synthesis_session_id,
        ...review.output.perspectives.map((perspective) => perspective.session_id),
        ...review.output.debate.map((contribution) => contribution.session_id),
      ]),
      ...(output.delegations ?? []).flatMap((delegation) => [
        delegation.root_session_id,
        ...(delegation.session_ids ?? []),
      ]),
    ]),
  ]
}

function sessionID(value: unknown) {
  return typeof value === "string" && value ? SessionSchema.ID.make(value) : undefined
}

function childStatus(value: unknown): ChildSession["status"] | undefined {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "timed_out")
    return value
  return undefined
}

function activityValue(value: unknown): ChildSession["activity"] | undefined {
  if (value === "queued" || value === "provider_active" || value === "waiting_on_delegation" || value === "recovering")
    return value
  return undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function workflowValue(value: unknown): ChildSession["workflow"] | undefined {
  if (value === "heavy" || value === "council" || value === "research") return value
  return undefined
}

function reportWorkflow(report: WorkflowReport | undefined, fallback: Metadata["workflow"]) {
  if (report?.stage.startsWith("heavy")) return "heavy"
  if (report?.stage.startsWith("council")) return "council"
  if (report?.stage.startsWith("research")) return "research"
  return fallback
}

function workflowName(workflow: Metadata["workflow"]) {
  if (workflow === "heavy") return "Heavy"
  if (workflow === "council") return "Council"
  return "Research"
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
