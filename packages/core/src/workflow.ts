export * as Workflow from "./workflow"

import { Context, Effect, Layer, Schema } from "effect"
import { Config } from "./config"
import { ConfigWorkflows } from "./config/workflows"
import { makeGlobalNode } from "./effect/app-node"
import { LocationServiceMap } from "./location-service-map"
import { PluginV2 } from "./plugin"
import { SessionV2 } from "./session"
import { SessionRunnerModel } from "./session/runner/model"
import { ApplicationTools } from "./tool/application-tools"
import { Tool } from "./tool/tool"
import { CouncilWorkflow } from "./workflow/council"
import { WorkflowExecution } from "./workflow/execution"
import { WorkflowHandoff } from "./workflow/handoff"
import { HeavyWorkflow } from "./workflow/heavy"
import { ResearchWorkflow } from "./workflow/research"
import { WorkflowReport } from "./workflow/report"
import { WorkflowRuntime } from "./workflow/runtime"
import { WorkflowSchema } from "./workflow/schema"
import { StudioWorkflow } from "./workflow/studio"

const DEFAULT_CHILD_TIMEOUT_MS = 10 * 60_000
const MAX_CHILD_TIMEOUT_MS = 60 * 60_000

type Configuration = {
  readonly session: SessionV2.Info
  readonly workflows: ConfigWorkflows.Info | undefined
}

type CouncilInput = {
  readonly question: string
  readonly issue_key?: string
  readonly artifact_paths?: ReadonlyArray<string>
}

type ResearchInput = {
  readonly question: string
  readonly effort?: "standard" | "deep" | "frontier"
  readonly capability?: WorkflowSchema.Capability
}

type StudioInput = {
  readonly brief: string
}

export interface Interface {
  readonly heavy: (
    input: { readonly task: string },
    context: WorkflowRuntime.RunContext,
  ) => Effect.Effect<WorkflowSchema.HeavyOutput, Tool.Failure>
  readonly council: (
    input: CouncilInput,
    context: WorkflowRuntime.RunContext,
  ) => Effect.Effect<WorkflowSchema.CouncilOutput, Tool.Failure>
  readonly research: (
    input: ResearchInput,
    context: WorkflowRuntime.RunContext,
  ) => Effect.Effect<WorkflowSchema.ResearchOutput, Tool.Failure>
  readonly studio: (
    input: StudioInput,
    context: WorkflowRuntime.RunContext,
  ) => Effect.Effect<WorkflowSchema.StudioOutput, Tool.Failure>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workflow") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const applications = yield* ApplicationTools.Service
    const locations = yield* LocationServiceMap.Service
    const runtime = yield* WorkflowRuntime.Service
    const sessions = yield* SessionV2.Service
    const accessCoordinator = yield* WorkflowExecution.makeAccessCoordinator()

    const configuration = Effect.fn("Workflow.configuration")(function* (sessionID) {
      const session = yield* sessions.get(sessionID)
      const location = locations.get(session.location)
      yield* PluginV2.Service.use((plugins) => plugins.wait(PluginV2.ID.make("config-provider"))).pipe(
        Effect.provide(location),
      )
      yield* SessionRunnerModel.Service.use((models) => models.resolve(session)).pipe(
        Effect.asVoid,
        Effect.provide(location),
      )
      const documents = yield* Config.Service.pipe(
        Effect.flatMap((config) => config.entries()),
        Effect.provide(location),
      )
      return {
        session,
        workflows: ConfigWorkflows.merge(
          documents.flatMap((document) => (document.type === "document" ? [document.info.workflows] : [])),
        ),
      }
    })

    const execution = Effect.fn("Workflow.execution")(function* (
      workflow: WorkflowExecution.Kind,
      access: WorkflowExecution.Access,
      objective: string,
      context: WorkflowRuntime.RunContext,
      configured: Configuration,
    ) {
      const current = context.execution ?? runtime.execution(context.sessionID)
      if (current)
        return {
          current: yield* WorkflowExecution.delegate(current, {
            workflow,
            objective,
            sessionID: context.sessionID,
            toolCallID: context.toolCallID,
          }),
          root: false,
        }
      const recursion = recursionSettings(configured.workflows)
      return {
        current: yield* WorkflowExecution.make({
          workflow,
          access,
          objective,
          sessionID: context.sessionID,
          toolCallID: context.toolCallID,
          directory: configured.session.location.directory,
          reportDirectory: configured.workflows?.reports?.directory ?? ".opencode/reports",
          maxDepth: recursion.maxDepth,
          maxWorkflows: recursion.maxWorkflows,
          maxConcurrency: recursion.maxConcurrency,
          maxCouncils: recursion.maxCouncils,
          debateDeduplication: recursion.debateDeduplication,
          delegates: delegationSettings(configured.workflows),
          onProgress: context.onProgress,
        }),
        root: true,
      }
    })

    const heavy = Effect.fn("Workflow.heavy")(function* (
      input: { readonly task: string },
      context: WorkflowRuntime.RunContext,
    ) {
      const configured = yield* configuration(context.sessionID).pipe(Effect.mapError(workflowFailure))
      const settings = heavySettings(
        configured.workflows?.heavy,
        configured.workflows?.council,
        configured.workflows?.reports,
      )
      if (!settings)
        return yield* Effect.fail(new Tool.Failure({ message: "Heavy is disabled by workflows.heavy configuration" }))
      const run = yield* execution("heavy", "write", input.task, context, configured)
      const effect = HeavyWorkflow.run(
        input.task,
        configured.session,
        { ...context, execution: run.current },
        settings,
        runtime,
      ).pipe(
        Effect.flatMap((result) =>
          Effect.gen(function* () {
            const delegations = yield* WorkflowExecution.manifest(run.current)
            const sessionManifest = yield* WorkflowExecution.sessions(run.current)
            const root = result.nodes.find((node) => node.depth === 0) ?? result.nodes[0]
            const sourceProvenance = yield* Effect.promise(() =>
              WorkflowReport.collectSourceProvenance(
                result,
                [
                  ...result.nodes.map((node) => node.report_path),
                  ...delegations.map((delegation) => delegation.report_path),
                  result.council?.synthesis_report_path,
                  ...(result.council?.perspectives.map((perspective) => perspective.report_path) ?? []),
                  ...(result.council?.debate.map((contribution) => contribution.report_path) ?? []),
                ],
                sessionManifest,
              ),
            )
            const output = WorkflowSchema.HeavyOutput.make({
              ...result,
              ...WorkflowReport.health(result.status, sessionManifest, root?.coverage ?? [], sourceProvenance),
              final_response: yield* Effect.promise(() => WorkflowReport.readArtifact(root?.report_path)),
              usage: WorkflowReport.aggregateUsage(sessionManifest),
              timing: WorkflowExecution.timing(run.current),
              report_path: run.current.reportPath,
              source_manifest: sourceProvenance.map((source) => source.url),
              source_provenance: sourceProvenance,
              session_manifest: sessionManifest,
              delegations,
            })
            yield* Effect.tryPromise({
              try: () => WorkflowReport.writeHeavy(input.task, output, run.current.reportPath),
              catch: (error) => new Tool.Failure({ message: `Failed to write Heavy report: ${failureMessage(error)}` }),
            })
            yield* WorkflowExecution.complete(run.current, {
              status: output.status,
              executionStatus: output.execution_status,
              artifactStatus: output.artifact_status,
              evidenceStatus: output.evidence_status,
              summary: output.summary,
              rootSessionID: output.root_session_id,
            })
            return output
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const message = failureMessage(error)
            yield* WorkflowExecution.fail(run.current, message)
            const delegations = yield* WorkflowExecution.manifest(run.current)
            yield* Effect.promise(() =>
              WorkflowReport.writeFailure("heavy", input.task, message, run.current.reportPath, delegations).catch(
                () => undefined,
              ),
            )
            return yield* new Tool.Failure({ message: `${message}\nReport: ${run.current.reportPath}` })
          }),
        ),
        Effect.onInterrupt(() =>
          recordInterruption("heavy", input.task, run.current, "Heavy workflow was interrupted"),
        ),
      )
      return yield* run.root
        ? accessCoordinator.withAccess(configured.session.location, WorkflowExecution.access(run.current), effect)
        : effect
    })

    const council = Effect.fn("Workflow.council")(function* (input: CouncilInput, context: WorkflowRuntime.RunContext) {
      const configured = yield* configuration(context.sessionID).pipe(Effect.mapError(workflowFailure))
      const settings = councilSettings(configured.workflows?.council, configured.workflows?.reports)
      if (!settings)
        return yield* Effect.fail(
          new Tool.Failure({ message: "Council is disabled by workflows.council configuration" }),
        )
      const current = context.execution ?? runtime.execution(context.sessionID)
      const coordination = current
        ? yield* WorkflowExecution.claimCouncil(current, {
            objective: input.question,
            issueKey: input.issue_key,
            artifactPaths: input.artifact_paths,
          })
        : undefined
      if (current && coordination && !coordination.owner)
        return yield* WorkflowExecution.awaitCouncil(current, coordination.claim)
      const run = yield* execution("council", "write", input.question, context, configured).pipe(
        Effect.tapError((error) =>
          current && coordination
            ? WorkflowExecution.failCouncil(current, coordination.claim, workflowFailure(error))
            : Effect.void,
        ),
      )
      if (coordination) yield* WorkflowExecution.bindCouncil(run.current, coordination.claim, run.current.id)
      const effect = CouncilWorkflow.run(
        input.question,
        configured.session,
        { ...context, execution: run.current },
        settings,
        runtime,
      ).pipe(
        Effect.flatMap((result) =>
          Effect.gen(function* () {
            const delegations = yield* WorkflowExecution.manifest(run.current)
            const sessionManifest = yield* WorkflowExecution.sessions(run.current)
            const sourceProvenance = yield* Effect.promise(() =>
              WorkflowReport.collectSourceProvenance(
                result,
                [
                  result.synthesis_report_path,
                  ...result.perspectives.map((perspective) => perspective.report_path),
                  ...result.debate.map((contribution) => contribution.report_path),
                  ...delegations.map((delegation) => delegation.report_path),
                ],
                sessionManifest,
              ),
            )
            const output = WorkflowSchema.CouncilOutput.make({
              ...result,
              ...WorkflowReport.health(result.status, sessionManifest, result.coverage ?? [], sourceProvenance),
              final_response: yield* Effect.promise(() => WorkflowReport.readArtifact(result.synthesis_report_path)),
              usage: WorkflowReport.aggregateUsage(sessionManifest),
              timing: WorkflowExecution.timing(run.current),
              report_path: run.current.reportPath,
              source_manifest: sourceProvenance.map((source) => source.url),
              source_provenance: sourceProvenance,
              session_manifest: sessionManifest,
              delegations,
            })
            yield* Effect.tryPromise({
              try: () => WorkflowReport.writeCouncil(input.question, output, run.current.reportPath),
              catch: (error) =>
                new Tool.Failure({ message: `Failed to write Council report: ${failureMessage(error)}` }),
            })
            yield* WorkflowExecution.complete(run.current, {
              status: output.status,
              executionStatus: output.execution_status,
              artifactStatus: output.artifact_status,
              evidenceStatus: output.evidence_status,
              summary: output.summary,
              rootSessionID: output.root_session_id,
            })
            return output
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const message = failureMessage(error)
            yield* WorkflowExecution.fail(run.current, message)
            const delegations = yield* WorkflowExecution.manifest(run.current)
            yield* Effect.promise(() =>
              WorkflowReport.writeFailure(
                "council",
                input.question,
                message,
                run.current.reportPath,
                delegations,
              ).catch(() => undefined),
            )
            return yield* new Tool.Failure({ message: `${message}\nReport: ${run.current.reportPath}` })
          }),
        ),
        Effect.onInterrupt(() =>
          recordInterruption("council", input.question, run.current, "Council workflow was interrupted"),
        ),
      )
      const executed = run.root
        ? accessCoordinator.withAccess(configured.session.location, WorkflowExecution.access(run.current), effect)
        : effect
      return yield* coordination
        ? executed.pipe(
            Effect.tap((output) => WorkflowExecution.completeCouncil(coordination.claim, output)),
            Effect.tapError((error) =>
              WorkflowExecution.failCouncil(run.current, coordination.claim, workflowFailure(error)),
            ),
            Effect.onInterrupt(() =>
              WorkflowExecution.failCouncil(
                run.current,
                coordination.claim,
                new Tool.Failure({ message: "Coordinated Council workflow was interrupted" }),
              ),
            ),
          )
        : executed
    })

    const research = Effect.fn("Workflow.research")(function* (
      input: ResearchInput,
      context: WorkflowRuntime.RunContext,
    ) {
      const configured = yield* configuration(context.sessionID).pipe(Effect.mapError(workflowFailure))
      const parentExecution = context.execution ?? runtime.execution(context.sessionID)
      const configuredSettings = researchSettings(
        configured.workflows?.research,
        configured.workflows?.council,
        configured.workflows?.reports,
        input,
      )
      if (!configuredSettings)
        return yield* Effect.fail(
          new Tool.Failure({ message: "Research is disabled by workflows.research configuration" }),
        )
      const settings =
        parentExecution?.workflow === "studio"
          ? {
              ...configuredSettings,
              effort: "standard" as const,
              capability: "read" as const,
              minDepth: 1,
              maxDepth: 1,
              maxBranchesPerNode: 1,
              tasksPerWave: Math.min(configuredSettings.tasksPerWave, 2),
              maxWaves: 1,
              maxNodes: Math.min(configuredSettings.maxNodes, 3),
              debateSensitivity: "off" as const,
              maxDebatesPerNode: 0,
              minimumReportWords: Math.min(configuredSettings.minimumReportWords, 800),
              council: undefined,
            }
          : configuredSettings
      const run = yield* execution("research", settings.capability, input.question, context, configured)
      const effect = ResearchWorkflow.run(
        input.question,
        configured.session,
        { ...context, execution: run.current },
        settings,
        runtime,
      ).pipe(
        Effect.flatMap((result) =>
          Effect.gen(function* () {
            const delegations = yield* WorkflowExecution.manifest(run.current)
            const sessionManifest = yield* WorkflowExecution.sessions(run.current)
            const root = result.nodes.find((node) => node.depth === 0) ?? result.nodes[0]
            const sourceProvenance = yield* Effect.promise(() =>
              WorkflowReport.collectSourceProvenance(
                result,
                [
                  ...result.nodes.map((node) => node.report_path),
                  ...result.nodes.flatMap((node) =>
                    node.waves.flatMap((wave) => wave.tasks.map((task) => task.report_path)),
                  ),
                  ...result.councils.flatMap((review) => [
                    review.output.report_path,
                    review.output.synthesis_report_path,
                    ...review.output.perspectives.map((perspective) => perspective.report_path),
                    ...review.output.debate.map((contribution) => contribution.report_path),
                  ]),
                  ...delegations.map((delegation) => delegation.report_path),
                ],
                sessionManifest,
              ),
            )
            const graph = ResearchWorkflow.reconcileEvidence(result.graph, sourceProvenance)
            const rawGraph = result.raw_graph
              ? ResearchWorkflow.reconcileEvidence(result.raw_graph, sourceProvenance)
              : undefined
            const evaluation = yield* Effect.promise(() =>
              ResearchWorkflow.evaluate(result.nodes, graph, result.councils, settings.minimumReportWords, {
                sessions: sessionManifest,
                delegations,
                sources: sourceProvenance,
              }),
            )
            const output = WorkflowSchema.ResearchOutput.make({
              ...result,
              raw_graph: rawGraph,
              graph,
              evaluation,
              ...WorkflowReport.health(result.status, sessionManifest, root?.result.coverage ?? [], sourceProvenance),
              final_response: yield* Effect.promise(() => WorkflowReport.readArtifact(root?.report_path)),
              usage: WorkflowReport.aggregateUsage(sessionManifest),
              timing: WorkflowExecution.timing(run.current),
              report_path: run.current.reportPath,
              trace_path: WorkflowReport.researchTracePath(run.current.reportPath),
              graph_path: WorkflowReport.researchGraphPath(run.current.reportPath),
              raw_graph_path: WorkflowReport.researchRawGraphPath(run.current.reportPath),
              source_manifest: sourceProvenance.map((source) => source.url),
              source_provenance: sourceProvenance,
              session_manifest: sessionManifest,
              delegations,
            })
            yield* Effect.tryPromise({
              try: () => WorkflowReport.writeResearch(input.question, output, run.current.reportPath),
              catch: (error) =>
                new Tool.Failure({ message: `Failed to write Research report: ${failureMessage(error)}` }),
            })
            yield* WorkflowExecution.complete(run.current, {
              status: output.status,
              executionStatus: output.execution_status,
              artifactStatus: output.artifact_status,
              evidenceStatus: output.evidence_status,
              summary: output.summary,
              rootSessionID: output.root_session_id,
            })
            return output
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const message = failureMessage(error)
            yield* WorkflowExecution.fail(run.current, message)
            const delegations = yield* WorkflowExecution.manifest(run.current)
            yield* Effect.promise(() =>
              WorkflowReport.writeFailure(
                "research",
                input.question,
                message,
                run.current.reportPath,
                delegations,
              ).catch(() => undefined),
            )
            return yield* new Tool.Failure({ message: `${message}\nReport: ${run.current.reportPath}` })
          }),
        ),
        Effect.onInterrupt(() =>
          recordInterruption("research", input.question, run.current, "Research workflow was interrupted"),
        ),
      )
      return yield* run.root
        ? accessCoordinator.withAccess(configured.session.location, WorkflowExecution.access(run.current), effect)
        : effect
    })

    const studio = Effect.fn("Workflow.studio")(function* (input: StudioInput, context: WorkflowRuntime.RunContext) {
      const configured = yield* configuration(context.sessionID).pipe(Effect.mapError(workflowFailure))
      const settings = studioSettings(configured.workflows?.studio, configured.workflows?.reports)
      if (!settings)
        return yield* Effect.fail(new Tool.Failure({ message: "Studio is disabled by workflows.studio configuration" }))
      const run = yield* execution("studio", "read", input.brief, context, configured)
      const effect = StudioWorkflow.run(
        input.brief,
        configured.session,
        { ...context, execution: run.current },
        settings,
        runtime,
      ).pipe(
        Effect.flatMap((result) =>
          Effect.gen(function* () {
            const delegations = yield* WorkflowExecution.manifest(run.current)
            const sessionManifest = yield* WorkflowExecution.sessions(run.current)
            const sourceProvenance = yield* Effect.promise(() =>
              WorkflowReport.collectSourceProvenance(
                { delegations },
                delegations.map((delegation) => delegation.report_path),
                sessionManifest,
              ),
            )
            const usage = WorkflowReport.aggregateUsage(sessionManifest)
            const initial = WorkflowSchema.StudioOutput.make({
              ...result,
              ...WorkflowReport.health(
                result.status,
                sessionManifest,
                result.synthesis.coverage ?? [],
                sourceProvenance,
              ),
              usage,
              timing: WorkflowExecution.timing(run.current),
              report_path: run.current.reportPath,
              synthesis_report_path: run.current.reportPath,
              trace_path: WorkflowReport.studioTracePath(run.current.reportPath),
              source_manifest: sourceProvenance.map((source) => source.url),
              source_provenance: sourceProvenance,
              session_manifest: sessionManifest,
              delegations,
            })
            yield* Effect.tryPromise({
              try: () => WorkflowReport.writeStudio(input.brief, initial, run.current.reportPath),
              catch: (error) =>
                new Tool.Failure({ message: `Failed to write Studio report: ${failureMessage(error)}` }),
            })
            const output = WorkflowSchema.StudioOutput.make({
              ...initial,
              final_response: yield* Effect.promise(() => WorkflowReport.readArtifact(run.current.reportPath)),
              evaluation: yield* Effect.promise(() =>
                StudioWorkflow.evaluate(
                  result.plan,
                  result.concepts,
                  result.critique,
                  result.synthesis,
                  run.current.reportPath,
                  settings.minimumReportWords,
                  { sessions: sessionManifest, delegations, usage },
                ),
              ),
            })
            yield* Effect.tryPromise({
              try: () => WorkflowReport.writeStudio(input.brief, output, run.current.reportPath),
              catch: (error) =>
                new Tool.Failure({ message: `Failed to finalize Studio trace: ${failureMessage(error)}` }),
            })
            yield* WorkflowExecution.complete(run.current, {
              status: output.status,
              executionStatus: output.execution_status,
              artifactStatus: output.artifact_status,
              evidenceStatus: output.evidence_status,
              summary: output.summary,
              rootSessionID: output.root_session_id,
            })
            return output
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const message = failureMessage(error)
            yield* WorkflowExecution.fail(run.current, message)
            const delegations = yield* WorkflowExecution.manifest(run.current)
            yield* Effect.promise(() =>
              WorkflowReport.writeFailure("studio", input.brief, message, run.current.reportPath, delegations).catch(
                () => undefined,
              ),
            )
            return yield* new Tool.Failure({ message: `${message}\nReport: ${run.current.reportPath}` })
          }),
        ),
        Effect.onInterrupt(() =>
          recordInterruption("studio", input.brief, run.current, "Studio workflow was interrupted"),
        ),
      )
      return yield* run.root
        ? accessCoordinator.withAccess(configured.session.location, WorkflowExecution.access(run.current), effect)
        : effect
    })

    yield* applications.register({
      heavy_run: Tool.make({
        description:
          "Execute a recursive Heavy workflow. It may inspect, edit, run commands, and test through bounded child sessions.",
        input: Schema.Struct({ task: Schema.String }),
        output: WorkflowSchema.HeavyOutput,
        execute: heavy,
        toModelOutput: ({ output }) => [{ type: "text", text: WorkflowHandoff.heavy(output) }],
      }),
      council_run: Tool.make({
        description:
          "Convene a Council of independent perspectives, run structured debate, and synthesize consensus and disagreement.",
        input: Schema.Struct({
          question: Schema.String,
          issue_key: Schema.String.pipe(Schema.optional),
          artifact_paths: Schema.Array(Schema.String).pipe(Schema.optional),
        }),
        output: WorkflowSchema.CouncilOutput,
        execute: council,
        toModelOutput: ({ output }) => [{ type: "text", text: WorkflowHandoff.council(output) }],
      }),
      research_run: Tool.make({
        description:
          "Run adaptive deep research with an evidence graph, hierarchical synthesis, and Council review for consequential disputes.",
        input: Schema.Struct({
          question: Schema.String,
          effort: Schema.Literals(["standard", "deep", "frontier"]).pipe(Schema.optional),
          capability: WorkflowSchema.Capability.pipe(Schema.optional),
        }),
        output: WorkflowSchema.ResearchOutput,
        execute: research,
        toModelOutput: ({ output }) => [{ type: "text", text: WorkflowHandoff.research(output) }],
      }),
      studio_run: Tool.make({
        description:
          "Develop several materially distinct creative concepts, compare them against an inferred brief, and author a standalone direction document.",
        input: Schema.Struct({ brief: Schema.String }),
        output: WorkflowSchema.StudioOutput,
        execute: studio,
        toModelOutput: ({ output }) => [{ type: "text", text: WorkflowHandoff.studio(output) }],
      }),
    })

    return Service.of({ heavy, council, research, studio })
  }),
)

function workflowFailure(error: unknown) {
  return error instanceof Tool.Failure ? error : new Tool.Failure({ message: String(error) })
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function recordInterruption(
  workflow: WorkflowExecution.Kind,
  objective: string,
  context: WorkflowExecution.Context,
  message: string,
) {
  return Effect.gen(function* () {
    yield* WorkflowExecution.fail(context, message)
    const delegations = yield* WorkflowExecution.manifest(context)
    yield* Effect.promise(() =>
      WorkflowReport.writeFailure(workflow, objective, message, context.reportPath, delegations).catch(() => undefined),
    )
  })
}

function heavySettings(
  input: boolean | ConfigWorkflows.Heavy | undefined,
  councilInput: boolean | ConfigWorkflows.Council | undefined,
  reports: ConfigWorkflows.Reports | undefined,
): HeavyWorkflow.Settings | undefined {
  if (input === false || (typeof input === "object" && input.enabled === false)) return undefined
  const config = typeof input === "object" ? input : undefined
  const maxDepth = Math.min(config?.max_depth ?? 2, 5)
  const requestedCouncilMode =
    config?.council === true
      ? "required"
      : config?.council === false
        ? "off"
        : config?.council === "always"
          ? "required"
          : (config?.council ?? "auto")
  const council = councilSettings(councilInput, reports)
  return {
    maxDepth,
    tasksPerNode: Math.min(config?.tasks_per_node ?? 4, 8),
    maxNodes: Math.max(maxDepth + 1, Math.min(config?.max_nodes ?? 24, 64)),
    concurrency: Math.min(config?.concurrency ?? 4, 8),
    childTimeoutMs: Math.min(config?.child_timeout ?? DEFAULT_CHILD_TIMEOUT_MS, MAX_CHILD_TIMEOUT_MS),
    finalizationRetries: Math.min(reports?.finalization_retries ?? 1, 3),
    maxPromptBytes: Math.min(reports?.max_prompt_bytes ?? 512 * 1024, 16 * 1024 * 1024),
    onFailure: config?.on_failure ?? "keep",
    councilMode: council ? requestedCouncilMode : "off",
    council: requestedCouncilMode === "off" ? undefined : council,
    models: config?.models ?? {},
  }
}

function councilSettings(
  input: boolean | ConfigWorkflows.Council | undefined,
  reports?: ConfigWorkflows.Reports,
): CouncilWorkflow.Settings | undefined {
  if (input === false || (typeof input === "object" && input.enabled === false)) return undefined
  const config = typeof input === "object" ? input : undefined
  return {
    perspectives: Math.max(2, Math.min(config?.perspectives ?? 3, 8)),
    concurrency: Math.min(config?.concurrency ?? 4, 8),
    childTimeoutMs: Math.min(config?.child_timeout ?? DEFAULT_CHILD_TIMEOUT_MS, MAX_CHILD_TIMEOUT_MS),
    finalizationRetries: Math.min(reports?.finalization_retries ?? 1, 3),
    maxPromptBytes: Math.min(reports?.max_prompt_bytes ?? 512 * 1024, 16 * 1024 * 1024),
    debate: {
      mode: config?.debate?.mode ?? "auto",
      topics: Math.min(config?.debate?.topics ?? 1, 4),
      participants: Math.max(2, Math.min(config?.debate?.participants ?? 3, 6)),
      rounds: Math.min(config?.debate?.rounds ?? 2, 4),
    },
    models: config?.models ?? {},
  }
}

function researchSettings(
  input: boolean | ConfigWorkflows.Research | undefined,
  councilInput: boolean | ConfigWorkflows.Council | undefined,
  reports: ConfigWorkflows.Reports | undefined,
  request: ResearchInput,
): ResearchWorkflow.Settings | undefined {
  if (input === false || (typeof input === "object" && input.enabled === false)) return undefined
  const config = typeof input === "object" ? input : undefined
  const effort = request.effort ?? config?.effort ?? "deep"
  const delegates = new Set(config?.delegates ?? (["research", "council"] as const))
  const preset =
    effort === "standard"
      ? {
          minDepth: 1,
          maxDepth: 2,
          maxBranchesPerNode: 2,
          minEvidencePerBranch: 2,
          tasksPerWave: 4,
          maxWaves: 2,
          maxNodes: 16,
          minimumReportWords: 1_200,
        }
      : effort === "frontier"
        ? {
            minDepth: 3,
            maxDepth: 4,
            maxBranchesPerNode: 5,
            minEvidencePerBranch: 3,
            tasksPerWave: 6,
            maxWaves: 5,
            maxNodes: 64,
            minimumReportWords: 4_000,
          }
        : {
            minDepth: 2,
            maxDepth: 3,
            maxBranchesPerNode: 4,
            minEvidencePerBranch: 2,
            tasksPerWave: 5,
            maxWaves: 3,
            maxNodes: 32,
            minimumReportWords: 2_500,
          }
  const council = delegates.has("council") ? councilSettings(councilInput, reports) : undefined
  const maxDepth = delegates.has("research") ? Math.min(config?.max_depth ?? preset.maxDepth, 6) : 1
  return {
    effort,
    capability: request.capability ?? config?.capability ?? "read",
    minDepth: Math.min(config?.min_depth ?? preset.minDepth, maxDepth),
    maxDepth,
    maxBranchesPerNode: Math.min(config?.max_branches_per_node ?? preset.maxBranchesPerNode, 8),
    minEvidencePerBranch: Math.min(config?.min_evidence_per_branch ?? preset.minEvidencePerBranch, 8),
    tasksPerWave: Math.min(config?.tasks_per_wave ?? preset.tasksPerWave, 8),
    maxWaves: Math.min(config?.max_waves ?? preset.maxWaves, 8),
    maxNodes: Math.max(2, Math.min(config?.max_nodes ?? preset.maxNodes, 128)),
    concurrency: Math.min(config?.concurrency ?? 4, 8),
    childTimeoutMs: Math.min(config?.child_timeout ?? DEFAULT_CHILD_TIMEOUT_MS, MAX_CHILD_TIMEOUT_MS),
    maxTimeMs: config?.max_time,
    maxTokens: config?.max_tokens,
    debateSensitivity: council ? (config?.debate_sensitivity ?? "balanced") : "off",
    maxDebatesPerNode: Math.min(config?.max_debates_per_node ?? 1, 4),
    freshnessDays: config?.freshness_days,
    minimumReportWords: config?.minimum_report_words ?? preset.minimumReportWords,
    finalizationRetries: Math.min(reports?.finalization_retries ?? 1, 3),
    maxPromptBytes: Math.min(reports?.max_prompt_bytes ?? 512 * 1024, 16 * 1024 * 1024),
    onFailure: config?.on_failure ?? "keep",
    council,
    models: config?.models ?? {},
  }
}

function studioSettings(
  input: boolean | ConfigWorkflows.Studio | undefined,
  reports: ConfigWorkflows.Reports | undefined,
): StudioWorkflow.Settings | undefined {
  if (input === false || (typeof input === "object" && input.enabled === false)) return undefined
  const config = typeof input === "object" ? input : undefined
  return {
    concepts: Math.max(3, Math.min(config?.concepts ?? 4, 5)),
    concurrency: Math.min(config?.concurrency ?? 4, 5),
    childTimeoutMs: Math.min(config?.child_timeout ?? DEFAULT_CHILD_TIMEOUT_MS, MAX_CHILD_TIMEOUT_MS),
    minimumReportWords: config?.minimum_report_words ?? 400,
    finalizationRetries: Math.min(reports?.finalization_retries ?? 1, 3),
    maxPromptBytes: Math.min(reports?.max_prompt_bytes ?? 512 * 1024, 16 * 1024 * 1024),
    models: config?.models ?? {},
  }
}

function recursionSettings(input: ConfigWorkflows.Info | undefined) {
  return {
    maxDepth: Math.min(input?.recursion?.max_depth ?? 3, 8),
    maxWorkflows: Math.min(input?.recursion?.max_workflows ?? 16, 64),
    maxConcurrency: Math.min(input?.recursion?.max_concurrency ?? 8, 64),
    maxCouncils: Math.min(input?.recursion?.max_councils ?? 8, 32),
    debateDeduplication: input?.recursion?.debate_deduplication ?? "semantic",
  }
}

function delegationSettings(input: ConfigWorkflows.Info | undefined) {
  const heavy = typeof input?.heavy === "object" ? input.heavy : undefined
  const council = typeof input?.council === "object" ? input.council : undefined
  const research = typeof input?.research === "object" ? input.research : undefined
  const studio = typeof input?.studio === "object" ? input.studio : undefined
  const councilDisabled = input?.council === false || council?.enabled === false
  const researchDisabled = input?.research === false || research?.enabled === false
  const heavyCouncilDisabled = councilDisabled || heavy?.council === false || heavy?.council === "off"
  const heavyDelegates = (heavy?.delegates ?? (["heavy", "council"] as const)).filter(
    (workflow) => workflow !== "council" || !heavyCouncilDisabled,
  )
  return {
    heavy: new Set(heavyDelegates),
    council: new Set(council?.delegates ?? (["heavy", "council"] as const)),
    research: new Set(
      (research?.delegates ?? (["research", "council"] as const)).filter(
        (workflow) => workflow !== "council" || !councilDisabled,
      ),
    ),
    studio: new Set((studio?.delegates ?? []).filter((workflow) => workflow !== "research" || !researchDisabled)),
  }
}

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [ApplicationTools.node, LocationServiceMap.node, SessionV2.node, WorkflowRuntime.node],
})
