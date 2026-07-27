export * as WorkflowRuntime from "./runtime"

import path from "node:path"
import { appendFile, mkdir } from "node:fs/promises"
import { Context, DateTime, Deferred, Effect, Layer, Option, Result, Schema } from "effect"
import { AgentV2 } from "../agent"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { SessionV2 } from "../session"
import { SessionEvent } from "../session/event"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { SessionTools } from "../tool/session-tools"
import { Tool } from "../tool/tool"
import { Hash } from "../util/hash"
import { WorkflowExecution } from "./execution"
import { WorkflowSchema } from "./schema"

const ReportChunk = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(200)),
  content: Schema.String.check(Schema.isMaxLength(512_000)),
  coverage: Schema.Array(
    Schema.Struct({
      report_path: Schema.String,
      disposition: Schema.Literals(["used", "rejected", "unresolved"]),
      detail: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
    }),
  )
    .check(Schema.isMaxLength(100))
    .pipe(Schema.optional),
})
const ContentReportChunk = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(200)),
  content: Schema.String.check(Schema.isMaxLength(512_000)),
})
const ReportReceipt = Schema.Struct({
  report_path: Schema.String,
  bytes_written: Schema.Number,
  chunks_written: Schema.Number,
  coverage_recorded: Schema.Number,
})
const ReportReadInput = Schema.Struct({
  report_paths: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
})
const ArtifactReadInput = Schema.Union([
  Schema.Struct({ all: Schema.Literal(true) }),
  Schema.Struct({
    artifact_ids: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  }),
])
const ReportReadOutput = Schema.Struct({
  reports: Schema.Array(
    Schema.Struct({
      artifact_id: Schema.String.pipe(Schema.optional),
      title: Schema.String,
      report_path: Schema.String,
      content: Schema.String,
    }),
  ),
})
const DEFAULT_RECOVERY_PROMPT_BYTES = 512 * 1024

export type ReportSource = {
  readonly id?: string
  readonly title: string
  readonly reportPath: string
}

export type ReportCoverage = {
  readonly reportPath: string
  readonly disposition: "used" | "rejected" | "unresolved"
  readonly detail: string
}

export interface ChildInput<Result extends Tool.SchemaType<any>> {
  readonly id: string
  readonly parentID: SessionSchema.ID
  readonly location: Location.Ref
  readonly title: string
  readonly agent: AgentV2.ID
  readonly model?: ModelV2.Ref
  readonly timeoutMs: number
  readonly finalizationRetries?: number
  readonly maxPromptBytes?: number
  readonly prompt: string
  readonly result: Result
  readonly validateResult?: (result: Schema.Schema.Type<Result>) => string | undefined
  readonly reportSources?: ReadonlyArray<ReportSource>
  readonly report?: boolean
  readonly reportPath?: string
  readonly reportMode?: "sections" | "document"
  readonly reportContentFirst?: boolean
  readonly reportReadMode?: "paths" | "artifacts"
  readonly progress?: {
    readonly context: RunContext
    readonly workflow: "heavy" | "council" | "research" | "studio"
    readonly phase: string
    readonly stage: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}

export interface Progress {
  readonly structured: Record<string, unknown>
  readonly text: string
}

export interface RunContext extends Tool.Context {
  readonly onProgress?: (input: Progress) => Effect.Effect<void>
  readonly execution?: WorkflowExecution.Context
}

export interface Interface {
  readonly childID: (parentID: SessionSchema.ID, id: string) => SessionSchema.ID
  readonly execution: (sessionID: SessionSchema.ID) => WorkflowExecution.Context | undefined
  readonly runChild: <Result extends Tool.SchemaType<any>>(
    input: ChildInput<Result>,
  ) => Effect.Effect<Schema.Schema.Type<Result>, Tool.Failure>
  readonly reportReads?: (sessionID: SessionSchema.ID) => ReadonlyArray<string>
  readonly reportCoverage?: (sessionID: SessionSchema.ID) => ReadonlyArray<ReportCoverage>
  readonly progress: (context: RunContext, structured: Record<string, unknown>, text: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkflowRuntime") {}

export function resolveModel(parent: ModelV2.Ref | undefined, override: string | undefined): ModelV2.Ref | undefined {
  if (!override) return parent
  const parsed = ModelV2.parse(override)
  return { id: parsed.modelID, providerID: parsed.providerID }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const sessions = yield* SessionV2.Service
    const sessionTools = yield* SessionTools.Service
    const executions = new Map<SessionSchema.ID, WorkflowExecution.Context>()
    const reportReads = new Map<SessionSchema.ID, Set<string>>()
    const reportCoverage = new Map<SessionSchema.ID, Array<ReportCoverage>>()
    const childID = (parentID: SessionSchema.ID, id: string) =>
      SessionSchema.ID.make(`ses_workflow_${Hash.fast(`${parentID}:${id}`)}`)
    const progress = Effect.fn("WorkflowRuntime.progress")(function* (
      context: RunContext,
      structured: Record<string, unknown>,
      text: string,
    ) {
      yield* events.publish(SessionEvent.Tool.Progress, {
        sessionID: context.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: context.assistantMessageID,
        callID: context.toolCallID,
        structured,
        content: [{ type: "text", text }],
      })
      if (context.execution) {
        yield* WorkflowExecution.progress(context.execution, { structured, text })
        return
      }
      if (context.onProgress) yield* context.onProgress({ structured, text })
    })

    return Service.of({
      childID,
      execution: (sessionID) => executions.get(sessionID),
      reportReads: (sessionID) => [...(reportReads.get(sessionID) ?? [])],
      reportCoverage: (sessionID) => [...(reportCoverage.get(sessionID) ?? [])],
      runChild: Effect.fn("WorkflowRuntime.runChild")(function* <Result extends Tool.SchemaType<any>>(
        input: ChildInput<Result>,
      ) {
        return yield* Effect.gen(function* () {
          const id = childID(input.parentID, input.id)
          const execution = input.progress?.context.execution
          const reportPath =
            input.report === false
              ? undefined
              : (input.reportPath ?? (execution ? WorkflowExecution.stageReportPath(execution, id) : undefined))
          if (execution) yield* WorkflowExecution.recordSession(execution, id)
          yield* sessions.create({
            id,
            parentID: input.parentID,
            location: input.location,
            title: input.title,
            agent: input.agent,
            model: input.model,
          })
          const startedAt = DateTime.toEpochMillis(yield* DateTime.now)
          const timing: {
            activeAt?: number
            recoveryAttempts: number
            childExecution?: WorkflowExecution.Context
          } = { recoveryAttempts: 0 }
          const report = Effect.fnUntraced(function* (
            status: "queued" | "running" | "completed" | "failed" | "timed_out",
            activity: WorkflowSchema.SessionStage["activity"],
            text: string,
            error?: string,
            stageUsage?: WorkflowSchema.Usage,
            stageSources?: ReadonlyArray<WorkflowSchema.SourceObservation>,
            stageTools?: { readonly calls: number; readonly errors: number },
          ) {
            if (!input.progress) return
            const updatedAt = DateTime.toEpochMillis(yield* DateTime.now)
            const waitingMs = timing.childExecution?.wait.elapsed ?? 0
            const queueMs = timing.activeAt === undefined ? updatedAt - startedAt : timing.activeAt - startedAt
            if (execution)
              yield* WorkflowExecution.recordStage(
                execution,
                WorkflowSchema.SessionStage.make({
                  session_id: id,
                  parent_session_id: input.parentID,
                  run_id: execution.id,
                  parent_run_id: execution.parentID,
                  workflow: input.progress.workflow,
                  workflow_depth: execution.depth,
                  status,
                  activity,
                  agent: input.agent,
                  title: input.title,
                  stage: input.progress.stage,
                  node_depth: nonNegativeNumber(input.progress.details?.node_depth),
                  node_id: stringValue(input.progress.details?.node_id),
                  parent_node_id: stringValue(input.progress.details?.parent_node_id),
                  capability: capabilityValue(input.progress.details?.capability),
                  depends_on: stringArray(input.progress.details?.depends_on),
                  issue: stringValue(input.progress.details?.issue),
                  round: positiveNumber(input.progress.details?.round),
                  report_path: reportPath,
                  prompt_bytes: Buffer.byteLength(input.prompt, "utf8"),
                  started_at: startedAt,
                  active_at: timing.activeAt,
                  updated_at: updatedAt,
                  elapsed_ms: Math.max(0, updatedAt - startedAt),
                  queue_ms: Math.max(0, queueMs),
                  waiting_ms: Math.max(0, waitingMs),
                  active_ms: Math.max(0, updatedAt - (timing.activeAt ?? updatedAt) - waitingMs),
                  recovery_attempts: timing.recoveryAttempts,
                  tool_calls: stageTools?.calls,
                  tool_errors: stageTools?.errors,
                  usage: stageUsage,
                  sources: stageSources,
                  error,
                }),
              )
            yield* progress(
              input.progress.context,
              {
                ...input.progress.details,
                workflow: input.progress.workflow,
                phase: input.progress.phase,
                stage: input.progress.stage,
                child_status: status,
                child_activity: activity,
                session_id: id,
                parent_session_id: input.parentID,
                child_agent: input.agent,
                child_title: input.title,
                run_id: execution?.id,
                parent_run_id: execution?.parentID,
                workflow_depth: execution?.depth,
                report_path: reportPath,
                prompt_bytes: Buffer.byteLength(input.prompt, "utf8"),
                started_at: startedAt,
                active_at: timing.activeAt,
                updated_at: updatedAt,
                elapsed_ms: Math.max(0, updatedAt - startedAt),
                queue_ms: Math.max(0, queueMs),
                waiting_ms: Math.max(0, waitingMs),
                active_ms: Math.max(0, updatedAt - (timing.activeAt ?? updatedAt) - waitingMs),
                recovery_attempts: timing.recoveryAttempts,
                usage: stageUsage,
                sources: stageSources,
                ...(error === undefined ? {} : { error }),
              },
              text,
            )
          })
          const decode = Schema.decodeUnknownOption(input.result)
          const history = yield* sessions.messages({ sessionID: id, order: "desc" })
          const priorReads = new Set(
            history
              .flatMap((message) => (message.type === "assistant" ? message.content : []))
              .flatMap((part) =>
                part.type === "tool" && part.name === "workflow_read_reports" && part.state.status === "completed"
                  ? [
                      ...(Array.isArray(part.state.input.report_paths)
                        ? part.state.input.report_paths.filter((item): item is string => typeof item === "string")
                        : []),
                      ...(Array.isArray(part.state.input.artifact_ids)
                        ? part.state.input.artifact_ids
                            .filter((item): item is string => typeof item === "string")
                            .flatMap((artifactID) => {
                              const source = input.reportSources?.find((candidate) => candidate.id === artifactID)
                              return source ? [source.reportPath] : []
                            })
                        : []),
                      ...(part.state.input.all === true
                        ? (input.reportSources ?? []).map((source) => source.reportPath)
                        : []),
                    ]
                  : [],
              ),
          )
          const priorCoverage = history
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .flatMap((part) =>
              part.type === "tool" &&
              part.name === "workflow_report" &&
              part.state.status === "completed" &&
              Array.isArray(part.state.input.coverage)
                ? part.state.input.coverage.flatMap((item) =>
                    item &&
                    typeof item === "object" &&
                    "report_path" in item &&
                    typeof item.report_path === "string" &&
                    "disposition" in item &&
                    (item.disposition === "used" ||
                      item.disposition === "rejected" ||
                      item.disposition === "unresolved") &&
                    "detail" in item &&
                    typeof item.detail === "string"
                      ? [
                          {
                            reportPath: item.report_path,
                            disposition: item.disposition,
                            detail: item.detail,
                          },
                        ]
                      : [],
                  )
                : [],
            )
          reportReads.set(id, priorReads)
          reportCoverage.set(id, priorCoverage)
          const previous = history
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .flatMap((part) =>
              part.type === "tool" && part.name === "workflow_result" && part.state.status === "completed"
                ? [part.state.structured]
                : [],
            )
            .map((structured) => decode(structured))
            .find(Option.isSome)
          if (previous) {
            if (reportPath) yield* Effect.promise(() => ensureStageReport(reportPath, input.title, previous.value))
            yield* report(
              "completed",
              undefined,
              `${input.title} was already completed`,
              undefined,
              summarizeUsage(history),
              sourceObservations(history),
              toolActivity(history),
            )
            return previous.value
          }

          return yield* Effect.scoped(
            Effect.gen(function* () {
              const childExecution = execution ? WorkflowExecution.forChild(execution, input.agent, id) : undefined
              timing.childExecution = childExecution
              if (execution)
                yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    executions.set(id, childExecution!)
                  }),
                  () =>
                    Effect.sync(() => {
                      executions.delete(id)
                    }),
                )
              const completed = yield* Deferred.make<Schema.Schema.Type<Result>>()
              const sources = new Map(input.reportSources?.map((source) => [source.reportPath, source]) ?? [])
              const artifacts = new Map(
                input.reportSources?.flatMap((source) => (source.id ? [[source.id, source] as const] : [])) ?? [],
              )
              yield* sessionTools.register(id, {
                ...(sources.size > 0
                  ? {
                      workflow_read_reports: Tool.make({
                        description:
                          input.reportReadMode === "artifacts"
                            ? "Read authorized durable workflow artifacts. Prefer { all: true }; the runtime resolves the authorized inventory so the model never has to transcribe opaque artifact IDs."
                            : "Read one batch of authorized durable workflow reports. Use the exact paths from the supplied inventory. Reads are tracked for final-report coverage validation.",
                        input: input.reportReadMode === "artifacts" ? ArtifactReadInput : ReportReadInput,
                        output: ReportReadOutput,
                        execute: (request) =>
                          Effect.tryPromise({
                            try: async () => {
                              const requested =
                                "all" in request
                                  ? Array.from(artifacts, ([artifactID, source]) => ({
                                      artifactID,
                                      reportPath: undefined,
                                      source,
                                    }))
                                  : "artifact_ids" in request
                                    ? request.artifact_ids.map((artifactID) => ({
                                        artifactID,
                                        reportPath: undefined,
                                        source: artifacts.get(artifactID),
                                      }))
                                    : request.report_paths.map((reportPath) => ({
                                        artifactID: undefined,
                                        reportPath,
                                        source: sources.get(reportPath),
                                      }))
                              const unknown = requested.filter((item) => !item.source)
                              if (unknown.length > 0)
                                throw new Error(
                                  `Unauthorized workflow report ${input.reportReadMode === "artifacts" ? "reference" : "path"}(s): ${unknown
                                    .map((item) => item.artifactID ?? item.reportPath ?? "unknown")
                                    .join(", ")}`,
                                )
                              const reports = await Promise.all(
                                requested.map(async (item) => {
                                  const source = item.source!
                                  const file = Bun.file(source.reportPath)
                                  if (!(await file.exists()))
                                    throw new Error(`Workflow report is unavailable: ${source.reportPath}`)
                                  const content = await file.text()
                                  return {
                                    artifact_id: item.artifactID,
                                    title: source.title,
                                    report_path: source.reportPath,
                                    content,
                                  }
                                }),
                              )
                              requested.forEach((item) => priorReads.add(item.source!.reportPath))
                              return { reports }
                            },
                            catch: (error) =>
                              new Tool.Failure({
                                message: `Failed to read workflow reports: ${
                                  error instanceof Error ? error.message : String(error)
                                }`,
                              }),
                          }),
                      }),
                    }
                  : {}),
                ...(reportPath
                  ? {
                      workflow_report: Tool.make({
                        description:
                          input.reportContentFirst !== false
                            ? "Persist Markdown content to this stage's durable report immediately. Coverage and audit metadata belong in workflow_result and can never reject report text."
                            : "Append one Markdown section to this stage's durable report. When authorized report sources are supplied, coverage dispositions may record how this section used, rejected, or left them unresolved. Large sections are split into bounded UTF-8 writes automatically.",
                        input: input.reportContentFirst !== false ? ContentReportChunk : ReportChunk,
                        output: ReportReceipt,
                        execute: (chunk) => {
                          const submitted = reportCoverageInput(chunk)
                          const unknown = submitted.filter((item) => !sources.has(item.report_path))
                          if (unknown.length > 0)
                            return Effect.fail(
                              new Tool.Failure({
                                message: `Unauthorized workflow report coverage path(s): ${unknown
                                  .map((item) => item.report_path)
                                  .join(", ")}`,
                              }),
                            )
                          if (submitted.some((item) => !item.detail.trim()))
                            return Effect.fail(
                              new Tool.Failure({
                                message: "Workflow report coverage details must contain a substantive disposition.",
                              }),
                            )
                          const coverage = submitted.map((item) => ({
                            reportPath: item.report_path,
                            disposition: item.disposition,
                            detail: item.detail.trim(),
                          }))
                          return Effect.tryPromise({
                            try: async () => {
                              const chunks =
                                input.reportMode === "document"
                                  ? await appendDocumentReport(reportPath, chunk.content)
                                  : await appendStageReport(reportPath, input.title, chunk.title, chunk.content)
                              priorCoverage.push(...coverage)
                              return {
                                report_path: reportPath,
                                bytes_written: Buffer.byteLength(chunk.content, "utf8"),
                                chunks_written: chunks,
                                coverage_recorded: coverage.length,
                              }
                            },
                            catch: (error) =>
                              new Tool.Failure({
                                message: `Failed to append workflow report: ${
                                  error instanceof Error ? error.message : String(error)
                                }`,
                              }),
                          })
                        },
                      }),
                    }
                  : {}),
                workflow_result: Tool.asTerminal(
                  Tool.make({
                    description:
                      "Submit the complete structured result for this workflow stage. Call this exactly once when done.",
                    input: input.result,
                    output: input.result,
                    execute: (result) => {
                      const failure = input.validateResult?.(result)
                      if (failure) return Effect.fail(new Tool.Failure({ message: failure }))
                      return Deferred.succeed(completed, result).pipe(Effect.as(result))
                    },
                  }),
                ),
              })
              yield* sessions.prompt({
                id: SessionMessage.ID.make(`msg_workflow_${Hash.fast(`${input.parentID}:${input.id}`)}`),
                sessionID: id,
                prompt: {
                  text: `${input.prompt}

Durable reporting:
${
  reportPath
    ? input.reportMode === "document"
      ? `Use workflow_report once to write the complete standalone Markdown document directly to ${reportPath}. Report text is persisted independently of workflow_result metadata. Then call workflow_result with its compact structured ledger.`
      : `Use workflow_report one or more times to preserve the complete detailed Markdown analysis at ${reportPath}. Then call workflow_result with a compact synthesis that fits its bounded fields. Do not repeat the full report in summary.`
    : "Keep workflow_result compact enough to complete as one valid tool call."
}`,
                },
                resume: false,
              })
              yield* report("queued", "queued", `${input.title} is queued`)
              const resume = (remaining: number): Effect.Effect<void, unknown> =>
                sessions.resume(id).pipe(
                  Effect.onInterrupt(() => sessions.interrupt(id)),
                  Effect.catch((error) => {
                    if (remaining <= 0 || !transientFailure(error)) return Effect.fail(error)
                    timing.recoveryAttempts++
                    return report(
                      "running",
                      "recovering",
                      `${input.title} hit a transient provider failure; retrying finalization`,
                      errorMessage(error),
                    ).pipe(Effect.andThen(Effect.sleep(250)), Effect.andThen(resume(remaining - 1)))
                  }),
                )
              const providerState: { failure?: unknown; reportAvailable: boolean } = { reportAvailable: false }
              const provider = Effect.gen(function* () {
                const initial = yield* Effect.result(resume(input.finalizationRetries ?? 1))
                if (yield* Deferred.isDone(completed)) return
                const artifact =
                  reportPath && (yield* Effect.promise(() => Bun.file(reportPath).exists()))
                    ? yield* Effect.promise(() => Bun.file(reportPath).text())
                    : undefined
                if (!artifact) {
                  if (Result.isFailure(initial)) {
                    providerState.failure = initial.failure
                    return
                  }
                  timing.recoveryAttempts++
                  yield* report(
                    "running",
                    "recovering",
                    `${input.title} ended without a structured result; retrying finalization`,
                  )
                  yield* sessions.prompt({
                    id: SessionMessage.ID.make(
                      `msg_workflow_${Hash.fast(`${input.parentID}:${input.id}:result-recovery`)}`,
                    ),
                    sessionID: id,
                    prompt: {
                      text: `Recover the incomplete workflow finalization from your existing reasoning. Do not repeat the work and do not call workflow_report. Call workflow_result exactly once with the complete structured result required by the original prompt.`,
                    },
                    resume: false,
                  })
                  const recovered = yield* Effect.result(resume(input.finalizationRetries ?? 1))
                  if (Result.isFailure(recovered)) providerState.failure = recovered.failure
                  return
                }
                providerState.reportAvailable = true
                timing.recoveryAttempts++
                yield* report(
                  "running",
                  "recovering",
                  `${input.title} preserved a durable report; recovering its structured result`,
                  Result.isFailure(initial) ? errorMessage(initial.failure) : undefined,
                )
                const recoveryPrompt = `Recover the interrupted workflow finalization from the durable report below. Do not repeat research or call workflow_report. Read the report, then call workflow_result exactly once with a compact structured synthesis. Preserve uncertainty and mark the result partial when the report does not support a complete answer.

Durable report: ${reportPath}

--- BEGIN DURABLE REPORT ---
${artifact}
--- END DURABLE REPORT ---`
                const recoveryBytes = Buffer.byteLength(recoveryPrompt, "utf8")
                if (recoveryBytes > (input.maxPromptBytes ?? DEFAULT_RECOVERY_PROMPT_BYTES)) {
                  providerState.failure = new Tool.Failure({
                    message: `Durable report recovery requires ${recoveryBytes} bytes, exceeding workflows.reports.max_prompt_bytes (${input.maxPromptBytes ?? DEFAULT_RECOVERY_PROMPT_BYTES})`,
                  })
                  return
                }
                yield* sessions.prompt({
                  id: SessionMessage.ID.make(
                    `msg_workflow_${Hash.fast(`${input.parentID}:${input.id}:report-recovery`)}`,
                  ),
                  sessionID: id,
                  prompt: {
                    text: recoveryPrompt,
                  },
                  resume: false,
                })
                const recovered = yield* Effect.result(resume(input.finalizationRetries ?? 1))
                if (Result.isFailure(recovered)) providerState.failure = recovered.failure
              })
              const active = Effect.gen(function* () {
                timing.activeAt = DateTime.toEpochMillis(yield* DateTime.now)
                yield* report("running", "provider_active", `${input.title} is running`)
                return yield* childExecution
                  ? Effect.raceFirst(
                      provider.pipe(Effect.asSome),
                      waitForActiveTimeout(childExecution, timing.activeAt, input.timeoutMs).pipe(
                        Effect.as(Option.none()),
                      ),
                    )
                  : provider.pipe(Effect.timeoutOption(input.timeoutMs))
              })
              const resumed = yield* childExecution
                ? input.agent === "heavy-writer" || input.agent === "research-writer"
                  ? childExecution.writer.withPermit(WorkflowExecution.withWorker(childExecution, active))
                  : WorkflowExecution.withWorker(childExecution, active)
                : active
              if (Option.isNone(resumed)) {
                const message = `${input.title} timed out after ${input.timeoutMs} ms`
                const messages = yield* sessions.messages({ sessionID: id, order: "desc" })
                yield* report(
                  "timed_out",
                  undefined,
                  message,
                  message,
                  summarizeUsage(messages),
                  sourceObservations(messages),
                  toolActivity(messages),
                )
                return yield* new Tool.Failure({ message })
              }
              if (yield* Deferred.isDone(completed)) {
                const result = yield* Deferred.await(completed)
                if (reportPath) yield* Effect.promise(() => ensureStageReport(reportPath, input.title, result))
                const messages = yield* sessions.messages({ sessionID: id, order: "desc" })
                yield* report(
                  "completed",
                  undefined,
                  `${input.title} completed`,
                  undefined,
                  summarizeUsage(messages),
                  sourceObservations(messages),
                  toolActivity(messages),
                )
                return result
              }
              const messages = yield* sessions.messages({ sessionID: id, order: "desc" })
              const attempt = messages
                .flatMap((message) => (message.type === "assistant" ? message.content : []))
                .find((part) => part.type === "tool" && part.name === "workflow_result")
              const message = providerState.failure
                ? `Workflow child ${id} could not finalize its structured result after provider recovery: ${errorMessage(providerState.failure)}${providerState.reportAvailable && reportPath ? `; durable report preserved at ${reportPath}` : ""}`
                : attempt?.type === "tool" && attempt.state.status === "pending"
                  ? `Workflow child ${id} ended with incomplete workflow_result input after ${attempt.state.input.length} characters; the tool JSON was likely truncated or malformed`
                  : attempt?.type === "tool" && attempt.state.status === "error"
                    ? `Workflow child ${id} submitted an invalid workflow_result: ${errorMessage(attempt.state.error)}`
                    : `Workflow child ${id} ended without submitting workflow_result`
              if (providerState.reportAvailable && reportPath) {
                const fallback = decode({
                  status: "partial",
                  summary: `Structured finalization failed, but the complete durable report remains available at ${reportPath}.`,
                  rationale: `Recovered from the durable report at ${reportPath}; the structured plan was unavailable.`,
                  argument: `Structured finalization failed; use the durable report at ${reportPath}.`,
                  risks: [message],
                  unresolved: [message],
                })
                if (Option.isSome(fallback)) {
                  yield* report(
                    "failed",
                    undefined,
                    `${input.title} preserved its report but could not finalize structured output`,
                    message,
                    summarizeUsage(messages),
                    sourceObservations(messages),
                    toolActivity(messages),
                  )
                  return fallback.value
                }
              }
              yield* report(
                "failed",
                undefined,
                `${input.title} failed: ${message}`,
                message,
                summarizeUsage(messages),
                sourceObservations(messages),
                toolActivity(messages),
              )
              return yield* new Tool.Failure({ message })
            }),
          ).pipe(
            Effect.onInterrupt(() => {
              const message = `${input.title} was interrupted`
              return report("failed", undefined, message, message)
            }),
          )
        }).pipe(
          Effect.mapError((error) =>
            error instanceof Tool.Failure ? error : new Tool.Failure({ message: String(error) }),
          ),
        )
      }),
      progress,
    })
  }),
)

function waitForActiveTimeout(
  context: WorkflowExecution.Context,
  startedAt: number,
  timeoutMs: number,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now)
    const remaining = timeoutMs - WorkflowExecution.activeElapsed(context, startedAt, now)
    if (remaining <= 0) return
    yield* Effect.sleep(Math.min(remaining, 250))
    yield* waitForActiveTimeout(context, startedAt, timeoutMs)
  })
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return JSON.stringify(error) ?? "Unknown error"
}

async function appendStageReport(reportPath: string, stage: string, title: string, content: string) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  const exists = await Bun.file(reportPath).exists()
  const chunks = utf8Chunks(normalizeReportSection(content), 16_000)
  await appendFile(reportPath, `${exists ? "\n\n" : `# ${stage}\n\n`}## ${title}\n\n`, "utf8")
  await chunks.reduce((writing, chunk) => writing.then(() => appendFile(reportPath, chunk, "utf8")), Promise.resolve())
  await appendFile(reportPath, "\n", "utf8")
  return chunks.length
}

async function appendDocumentReport(reportPath: string, content: string) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  const exists = await Bun.file(reportPath).exists()
  const chunks = utf8Chunks(content.trim(), 16_000)
  if (!exists) await Bun.write(reportPath, chunks[0])
  if (exists) await appendFile(reportPath, `\n\n${chunks[0]}`, "utf8")
  await chunks
    .slice(1)
    .reduce((writing, chunk) => writing.then(() => appendFile(reportPath, chunk, "utf8")), Promise.resolve())
  await appendFile(reportPath, "\n", "utf8")
  return chunks.length
}

function normalizeReportSection(value: string) {
  const lines = value.trim().split(/\r?\n/)
  const first = lines.findIndex((line) => line.trim())
  const withoutTitle =
    first >= 0 && /^ {0,3}#[ \t]+/.test(lines[first]) ? lines.filter((_line, index) => index !== first) : lines
  const headings = reportSectionLines(withoutTitle)
  const minimum = headings.reduce((level, line) => {
    const heading = line.value.match(/^ {0,3}(#{1,6})[ \t]+/)
    return heading ? Math.min(level, heading[1].length) : level
  }, 7)
  const shift = minimum > 6 ? 0 : Math.max(0, 3 - minimum)
  const headingIndices = new Set(headings.map((heading) => heading.index))
  return withoutTitle
    .map((line, index) =>
      headingIndices.has(index)
        ? line.replace(/^( {0,3})(#{1,6})([ \t]+)/, (_match, indent, hashes, spacing) => {
            return `${indent}${"#".repeat(Math.min(6, hashes.length + shift))}${spacing}`
          })
        : line,
    )
    .join("\n")
    .trim()
}

function reportSectionLines(lines: ReadonlyArray<string>) {
  const state: {
    fence: { readonly character: string; readonly length: number } | undefined
  } = { fence: undefined }
  return lines.flatMap((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      const character = marker[1][0]
      if (!state.fence) state.fence = { character, length: marker[1].length }
      else if (state.fence.character === character && marker[1].length >= state.fence.length) state.fence = undefined
      return []
    }
    if (state.fence) return []
    if (!/^ {0,3}#{1,6}[ \t]+/.test(line)) return []
    return [{ index, value: line }]
  })
}

async function ensureStageReport(reportPath: string, title: string, result: unknown) {
  if (await Bun.file(reportPath).exists()) return
  await mkdir(path.dirname(reportPath), { recursive: true })
  await Bun.write(
    reportPath,
    [
      `# ${title}`,
      "",
      "The stage submitted only its bounded structured result.",
      "",
      "```json",
      JSON.stringify(result, null, 2),
      "```",
      "",
    ].join("\n"),
  )
}

function utf8Chunks(value: string, maximum: number) {
  const bytes = Buffer.from(value)
  const chunks: string[] = []
  for (let start = 0; start < bytes.length; ) {
    const requested = Math.min(start + maximum, bytes.length)
    const end =
      requested === bytes.length
        ? requested
        : (Array.from({ length: Math.min(4, requested - start) }, (_, offset) => requested - offset).find(
            (index) => index === bytes.length || (bytes[index] & 0xc0) !== 0x80,
          ) ?? requested)
    chunks.push(bytes.subarray(start, end).toString("utf8"))
    start = end
  }
  return chunks.length > 0 ? chunks : [""]
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

function capabilityValue(value: unknown) {
  if (value === "read" || value === "write") return value
  return undefined
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function reportCoverageInput(value: unknown) {
  if (!value || typeof value !== "object" || !("coverage" in value) || !Array.isArray(value.coverage)) return []
  return value.coverage.filter(
    (
      item,
    ): item is {
      readonly report_path: string
      readonly disposition: "used" | "rejected" | "unresolved"
      readonly detail: string
    } =>
      item !== null &&
      typeof item === "object" &&
      "report_path" in item &&
      typeof item.report_path === "string" &&
      "disposition" in item &&
      (item.disposition === "used" || item.disposition === "rejected" || item.disposition === "unresolved") &&
      "detail" in item &&
      typeof item.detail === "string",
  )
}

function transientFailure(error: unknown) {
  if (error && typeof error === "object") {
    if ("retryable" in error && error.retryable === true) return true
    const reason = "reason" in error && error.reason && typeof error.reason === "object" ? error.reason : undefined
    if (
      reason &&
      "_tag" in reason &&
      (reason._tag === "Transport" || reason._tag === "RateLimit" || reason._tag === "ProviderInternal")
    )
      return true
  }
  return /(?:http transport failed|fetch failed|network|connection (?:closed|reset)|econnreset|econnrefused|etimedout|timeout|timed out|429|5\d\d)/i.test(
    errorMessage(error),
  )
}

function summarizeUsage(messages: ReadonlyArray<SessionMessage.Message>) {
  const assistants = messages.filter((message): message is SessionMessage.Assistant => message.type === "assistant")
  const totals = assistants.reduce(
    (current, message) => ({
      input: current.input + (message.tokens?.input ?? 0),
      output: current.output + (message.tokens?.output ?? 0),
      reasoning: current.reasoning + (message.tokens?.reasoning ?? 0),
      cache_read: current.cache_read + (message.tokens?.cache.read ?? 0),
      cache_write: current.cache_write + (message.tokens?.cache.write ?? 0),
      cost: current.cost + (message.cost ?? 0),
    }),
    { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost: 0 },
  )
  return WorkflowSchema.Usage.make({
    ...totals,
    cost_status:
      assistants.some((message) => message.cost !== undefined && message.cost > 0) || totals.input + totals.output === 0
        ? "reported"
        : "unavailable",
    scope: "child_sessions",
  })
}

function toolActivity(messages: ReadonlyArray<SessionMessage.Message>) {
  const tools = messages
    .filter((message): message is SessionMessage.Assistant => message.type === "assistant")
    .flatMap((message) => message.content)
    .filter((part): part is SessionMessage.AssistantTool => part.type === "tool")
  return {
    calls: tools.length,
    errors: tools.filter((part) => part.state.status === "error").length,
  }
}

export function sourceObservations(messages: ReadonlyArray<SessionMessage.Message>) {
  const rank = { unverified: 0, failed: 1, verified: 2 } as const
  const observations = new Map<
    string,
    {
      verification: WorkflowSchema.SourceObservation["verification"]
      method: NonNullable<WorkflowSchema.SourceObservation["method"]>
    }
  >()
  const add = (
    value: unknown,
    verification: WorkflowSchema.SourceObservation["verification"],
    method: NonNullable<WorkflowSchema.SourceObservation["method"]>,
  ) => {
    if (typeof value !== "string") return
    const candidate = value.trim().replace(/[.,;:!?\]}]+$/g, "")
    if (!URL.canParse(candidate)) return
    const url = new URL(candidate).href
    const previous = observations.get(url)
    if (!previous || rank[verification] > rank[previous.verification] || method === "direct")
      observations.set(url, { verification, method })
  }
  messages
    .filter((message): message is SessionMessage.Assistant => message.type === "assistant")
    .flatMap((message) => message.content)
    .filter((part): part is SessionMessage.AssistantTool => part.type === "tool")
    .forEach((part) => {
      const direct = ["webfetch", "web_fetch", "web_open", "open_url"].includes(part.name)
      if (direct && part.state.status !== "pending") {
        add(part.state.input.url, part.state.status === "completed" ? "verified" : "failed", "direct")
        return
      }
      if (!part.name.toLowerCase().includes("search") || part.state.status !== "completed") return
      part.state.content
        .filter((item) => item.type === "text")
        .flatMap((item) => sourceURLs(item.text))
        .forEach((url) => add(url, "unverified", "search"))
    })
  return Array.from(observations, ([url, observation]) =>
    WorkflowSchema.SourceObservation.make({ url, ...observation }),
  )
}

function sourceURLs(value: string) {
  return Array.from(value.matchAll(/https?:\/\/[^\s<>"'`()\\\u2013\u2014]+/gu)).flatMap((match) => {
    const candidate = match[0].replace(/[.,;:!?\]}]+$/g, "")
    return URL.canParse(candidate) ? [new URL(candidate).href] : []
  })
}

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [EventV2.node, SessionV2.node, SessionTools.node],
})
