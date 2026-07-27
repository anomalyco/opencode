export * as CouncilWorkflow from "./council"

import { Effect } from "effect"
import { AgentV2 } from "../agent"
import { SessionSchema } from "../session/schema"
import { Hash } from "../util/hash"
import { WorkflowExecution } from "./execution"
import { WorkflowReport } from "./report"
import { WorkflowRuntime } from "./runtime"
import { WorkflowSchema } from "./schema"

export interface Settings {
  readonly perspectives: number
  readonly concurrency: number
  readonly childTimeoutMs: number
  readonly finalizationRetries?: number
  readonly maxPromptBytes?: number
  readonly debate: {
    readonly mode: "auto" | "always" | "off"
    readonly topics: number
    readonly participants: number
    readonly rounds: number
  }
  readonly models: {
    readonly planner?: string
    readonly perspective?: string
    readonly debater?: string
    readonly synthesizer?: string
  }
}

export function run(
  question: string,
  parent: SessionSchema.Info,
  context: WorkflowRuntime.RunContext,
  settings: Settings,
  runtime: WorkflowRuntime.Interface,
  evidenceArtifacts: ReadonlyArray<WorkflowReport.Artifact> = [],
) {
  return Effect.gen(function* () {
    const runID = `council:${Hash.fast(`${context.execution?.id ?? context.toolCallID}:${question}`).slice(0, 12)}`
    const planID = `${runID}:plan`
    const rootSessionID = runtime.childID(parent.id, planID)
    yield* runtime.progress(
      context,
      {
        workflow: "council",
        phase: "planning",
        session_id: rootSessionID,
        root_session_id: rootSessionID,
      },
      "Council is selecting perspectives and stable issues",
    )
    const planned = yield* WorkflowReport.prompt(
      "Council planner",
      planPrompt(question, settings),
      settings.maxPromptBytes,
    )
      .pipe(
        Effect.flatMap((prompt) =>
          runtime.runChild({
            id: planID,
            parentID: parent.id,
            location: parent.location,
            title: "Council plan",
            agent: AgentV2.ID.make("council-planner"),
            model: WorkflowRuntime.resolveModel(parent.model, settings.models.planner),
            timeoutMs: settings.childTimeoutMs,
            finalizationRetries: settings.finalizationRetries,
            maxPromptBytes: settings.maxPromptBytes,
            result: WorkflowSchema.CouncilPlanSubmission,
            prompt,
            progress: {
              context,
              workflow: "council",
              phase: "planning",
              stage: "planning",
              details: {
                node_id: runID,
                node_depth: 0,
              },
            },
          }),
        ),
      )
      .pipe(
        Effect.map((plan) => ({ plan, failure: undefined as string | undefined })),
        Effect.catch((error) =>
          runtime
            .progress(
              context,
              {
                workflow: "council",
                phase: "recovering",
                stage: "planning",
                session_id: rootSessionID,
                root_session_id: rootSessionID,
                error: error.message,
              },
              `Council planner failed; using default perspectives: ${error.message}`,
            )
            .pipe(
              Effect.as({
                plan: WorkflowSchema.CouncilPlan.make({
                  rationale: `Council planner failed; using default independent perspectives: ${error.message}`,
                  issues: [{ id: "decision", question }],
                  perspectives: [],
                }),
                failure: error.message,
              }),
            ),
        ),
      )
    const normalized = normalizePlan(planned.plan, question, settings)
    const perspectiveSessionIDs = normalized.perspectives.map((perspective) =>
      runtime.childID(rootSessionID, `${runID}:perspective:${perspective.id}`),
    )
    yield* runtime.progress(
      context,
      {
        workflow: "council",
        phase: "perspectives",
        session_id: rootSessionID,
        session_ids: perspectiveSessionIDs,
        root_session_id: rootSessionID,
        total: normalized.perspectives.length,
      },
      `Council is gathering ${normalized.perspectives.length} perspectives`,
    )
    const perspectiveResults = yield* Effect.forEach(
      normalized.perspectives,
      (perspective) => {
        const id = `${runID}:perspective:${perspective.id}`
        const sessionID = runtime.childID(rootSessionID, id)
        return WorkflowReport.prompt(
          `Council perspective ${perspective.title}`,
          perspectivePrompt(question, normalized.issues, perspective, evidenceArtifacts),
          settings.maxPromptBytes,
        )
          .pipe(
            Effect.flatMap((prompt) =>
              runtime.runChild({
                id,
                parentID: rootSessionID,
                location: parent.location,
                title: `Council: ${perspective.title}`,
                agent: AgentV2.ID.make("council-perspective"),
                model: WorkflowRuntime.resolveModel(parent.model, settings.models.perspective),
                timeoutMs: settings.childTimeoutMs,
                finalizationRetries: settings.finalizationRetries,
                maxPromptBytes: settings.maxPromptBytes,
                result: WorkflowSchema.CouncilPerspectiveSubmission,
                reportSources: evidenceArtifacts.flatMap((artifact) =>
                  artifact.reportPath
                    ? [{ id: artifact.id, title: artifact.title, reportPath: artifact.reportPath }]
                    : [],
                ),
                reportReadMode: "artifacts",
                prompt,
                progress: {
                  context,
                  workflow: "council",
                  phase: "perspectives",
                  stage: "perspective",
                  details: {
                    node_id: perspective.id,
                    parent_node_id: runID,
                    node_depth: 1,
                  },
                },
              }),
            ),
          )
          .pipe(
            Effect.map((result) => ({
              perspective,
              result: normalizePerspective(
                result,
                perspective,
                normalized.issues,
                sessionID,
                context.execution ? WorkflowExecution.stageReportPath(context.execution, sessionID) : undefined,
              ),
            })),
            Effect.catch((error) => {
              const message = error instanceof Error ? error.message : String(error)
              return runtime
                .progress(
                  context,
                  {
                    workflow: "council",
                    phase: "failed",
                    stage: "perspective",
                    session_id: sessionID,
                    root_session_id: rootSessionID,
                    perspective: perspective.id,
                    error: message,
                  },
                  `Council perspective ${perspective.title} failed: ${message}`,
                )
                .pipe(Effect.as({ perspective, error: message }))
            }),
          )
      },
      { concurrency: settings.concurrency },
    )
    const perspectives = perspectiveResults.flatMap((item) => ("result" in item ? [item.result] : []))
    const perspectiveFailures = perspectiveResults.flatMap((item) => ("error" in item ? [item.error] : []))
    const topics = selectDebateTopics(normalized.issues, perspectives, settings)
    yield* runtime.progress(
      context,
      {
        workflow: "council",
        phase: "debate",
        session_id: rootSessionID,
        root_session_id: rootSessionID,
        topics: topics.length,
        rounds: topics.length > 0 ? settings.debate.rounds : 0,
      },
      topics.length > 0 ? `Council is debating ${topics.length} issue(s)` : "Council found no debate topic",
    )
    const debate = yield* Effect.forEach(topics, (topic) =>
      debateTopic(question, topic, perspectives, runID, rootSessionID, parent, context, settings, runtime),
    ).pipe(Effect.map((rounds) => rounds.flat()))
    const artifacts = [
      ...perspectives.map((perspective) => ({
        id: `perspective-${perspective.session_id}`,
        title: `Perspective: ${perspective.perspective_id}`,
        reportPath: perspective.report_path,
      })),
      ...debate.map((contribution) => ({
        id: `debate-${contribution.session_id}`,
        title: `Debate: ${contribution.issue_id}, ${contribution.perspective_id}, round ${contribution.round}`,
        reportPath: contribution.report_path,
      })),
    ]
    const reports = yield* Effect.promise(() => WorkflowReport.readArtifacts(artifacts))
    const evidenceSessions = context.execution ? yield* WorkflowExecution.sessions(context.execution) : []
    const evidence = yield* Effect.promise(() =>
      WorkflowReport.collectSourceProvenance(
        { perspectives, debate },
        artifacts.map((artifact) => artifact.reportPath),
        evidenceSessions,
      ),
    )
    const synthesisID = runtime.childID(rootSessionID, `${runID}:synthesis`)
    yield* runtime.progress(
      context,
      {
        workflow: "council",
        phase: "synthesizing",
        session_id: synthesisID,
        root_session_id: rootSessionID,
      },
      "Council is synthesizing the deliberation",
    )
    const synthesized = yield* WorkflowReport.prompt(
      "Council synthesis",
      synthesisPrompt(
        question,
        planned.plan.rationale,
        perspectives,
        perspectiveFailures,
        debate,
        artifacts,
        reports,
        evidence,
      ),
      settings.maxPromptBytes,
    )
      .pipe(
        Effect.flatMap((prompt) =>
          runtime.runChild({
            id: `${runID}:synthesis`,
            parentID: rootSessionID,
            location: parent.location,
            title: "Council synthesis",
            agent: AgentV2.ID.make("council-synthesizer"),
            model: WorkflowRuntime.resolveModel(parent.model, settings.models.synthesizer),
            timeoutMs: settings.childTimeoutMs,
            finalizationRetries: settings.finalizationRetries,
            maxPromptBytes: settings.maxPromptBytes,
            result: WorkflowSchema.CouncilSynthesisSubmission,
            validateResult: (result) => validateSynthesisCoverage(artifacts, result.coverage ?? []),
            reportSources: artifacts.flatMap((artifact) =>
              artifact.reportPath ? [{ id: artifact.id, title: artifact.title, reportPath: artifact.reportPath }] : [],
            ),
            prompt,
            reportContentFirst: false,
            reportReadMode: "artifacts",
            progress: {
              context,
              workflow: "council",
              phase: "synthesizing",
              stage: "synthesis",
              details: {
                node_id: `${runID}:synthesis`,
                parent_node_id: runID,
                node_depth: 1,
              },
            },
          }),
        ),
      )
      .pipe(
        Effect.map((result) => ({ result, failure: undefined as string | undefined })),
        Effect.catch((error) =>
          runtime
            .progress(
              context,
              {
                workflow: "council",
                phase: "recovering",
                stage: "synthesis",
                session_id: synthesisID,
                root_session_id: rootSessionID,
                error: error.message,
              },
              `Council synthesis failed; preserving deliberation: ${error.message}`,
            )
            .pipe(
              Effect.as({
                result: fallbackSynthesis(normalized.issues, perspectives, perspectiveFailures, error.message),
                failure: error.message,
              }),
            ),
        ),
      )
    const debateFailures = debate.filter((item) => item.argument.startsWith("Debate stage failed:")).length
    const normalizedSynthesis = normalizeSynthesis(synthesized.result, normalized.issues)
    const recordedCoverage = runtime.reportCoverage?.(synthesisID) ?? []
    const coverage = yield* Effect.promise(() =>
      WorkflowReport.coverage(artifacts, [
        ...(normalizedSynthesis.coverage ?? []),
        ...recordedCoverage.map((item) => ({
          title: artifacts.find((artifact) => artifact.reportPath === item.reportPath)?.title ?? item.reportPath,
          report_path: item.reportPath,
          received: true,
          used: item.disposition === "used" ? [item.detail] : [],
          rejected: item.disposition === "rejected" ? [item.detail] : [],
          unresolved: item.disposition === "unresolved" ? [item.detail] : [],
        })),
      ]),
    )
    const missingCoverage = context.execution ? WorkflowReport.unaccountedCoverage(coverage).length : 0
    const status =
      perspectives.length === 0
        ? "failed"
        : planned.failure ||
            synthesized.failure ||
            perspectiveFailures.length > 0 ||
            debateFailures > 0 ||
            missingCoverage > 0
          ? synthesized.result.status === "failed"
            ? "failed"
            : "partial"
          : synthesized.result.status
    return WorkflowSchema.CouncilOutput.make({
      workflow: "council",
      status,
      summary: normalizedSynthesis.summary,
      root_session_id: rootSessionID,
      synthesis_session_id: synthesisID,
      synthesis_report_path: context.execution
        ? WorkflowExecution.stageReportPath(context.execution, synthesisID)
        : undefined,
      perspectives,
      debate,
      consensus: normalizedSynthesis.consensus,
      disagreements: normalizedSynthesis.disagreements,
      recommendations: normalizedSynthesis.recommendations,
      risks: normalizedSynthesis.risks,
      coverage,
    })
  })
}

type DebateTopic = WorkflowSchema.CouncilTopic & {
  readonly adversarial: boolean
}

const debateTopic = Effect.fn("CouncilWorkflow.debateTopic")(function* (
  question: string,
  topic: DebateTopic,
  perspectives: ReadonlyArray<WorkflowSchema.CouncilPerspective>,
  runID: string,
  parentID: SessionSchema.ID,
  parent: SessionSchema.Info,
  context: WorkflowRuntime.RunContext,
  settings: Settings,
  runtime: WorkflowRuntime.Interface,
) {
  const participants = selectParticipants(topic, perspectives, settings.debate.participants)
  const runRound = (
    round: number,
    previous: ReadonlyArray<WorkflowSchema.DebateContribution>,
  ): Effect.Effect<ReadonlyArray<WorkflowSchema.DebateContribution>> =>
    Effect.gen(function* () {
      if (round > settings.debate.rounds) return previous
      const snapshot = JSON.stringify(previous, undefined, 2)
      const reports = yield* Effect.promise(() =>
        WorkflowReport.readArtifacts([
          ...perspectives.map((perspective) => ({
            title: `Perspective: ${perspective.perspective_id}`,
            reportPath: perspective.report_path,
          })),
          ...previous.map((contribution) => ({
            title: `Prior debate: ${contribution.issue_id}, ${contribution.perspective_id}, round ${contribution.round}`,
            reportPath: contribution.report_path,
          })),
        ]),
      )
      const current = yield* Effect.forEach(
        participants,
        (perspective) => {
          const id = `${runID}:debate:${topic.id}:${round}:${perspective.perspective_id}`
          const sessionID = runtime.childID(parentID, id)
          return WorkflowReport.prompt(
            `Council debate ${topic.id}, round ${round}`,
            debatePrompt(question, topic, perspective, perspectives, round, snapshot, reports),
            settings.maxPromptBytes,
          ).pipe(
            Effect.flatMap((prompt) =>
              runtime
                .progress(
                  context,
                  {
                    workflow: "council",
                    phase: "debating",
                    session_id: sessionID,
                    root_session_id: parentID,
                    issue: topic.id,
                    perspective: perspective.perspective_id,
                    round,
                  },
                  `Council is debating ${topic.question} in round ${round}`,
                )
                .pipe(
                  Effect.andThen(
                    runtime.runChild({
                      id,
                      parentID,
                      location: parent.location,
                      title: `Council debate: ${topic.question}`,
                      agent: AgentV2.ID.make("council-debater"),
                      model: WorkflowRuntime.resolveModel(parent.model, settings.models.debater),
                      timeoutMs: settings.childTimeoutMs,
                      finalizationRetries: settings.finalizationRetries,
                      maxPromptBytes: settings.maxPromptBytes,
                      result: WorkflowSchema.DebateSubmission,
                      prompt,
                      progress: {
                        context,
                        workflow: "council",
                        phase: "debating",
                        stage: "debate",
                        details: {
                          node_id: `${topic.id}:${perspective.perspective_id}:${round}`,
                          parent_node_id: perspective.perspective_id,
                          node_depth: 2,
                          issue: topic.id,
                          round,
                        },
                      },
                    }),
                  ),
                ),
            ),
            Effect.map((result) =>
              WorkflowSchema.DebateContribution.make({
                ...result,
                issue_id: topic.id,
                perspective_id: perspective.perspective_id,
                round,
                session_id: sessionID,
                report_path: context.execution
                  ? WorkflowExecution.stageReportPath(context.execution, sessionID)
                  : undefined,
              }),
            ),
            Effect.catch((error) => {
              const message = error instanceof Error ? error.message : String(error)
              return runtime
                .progress(
                  context,
                  {
                    workflow: "council",
                    phase: "failed",
                    stage: "debate",
                    session_id: sessionID,
                    root_session_id: parentID,
                    issue: topic.id,
                    perspective: perspective.perspective_id,
                    round,
                    error: message,
                  },
                  `Council debate failed in round ${round}: ${message}`,
                )
                .pipe(
                  Effect.as(
                    WorkflowSchema.DebateContribution.make({
                      issue_id: topic.id,
                      perspective_id: perspective.perspective_id,
                      round,
                      session_id: sessionID,
                      report_path: context.execution
                        ? WorkflowExecution.stageReportPath(context.execution, sessionID)
                        : undefined,
                      stance: issueFor(perspective, topic.id)?.stance ?? "uncertain",
                      argument: `Debate stage failed: ${message}`,
                      concessions: [],
                      rebuttals: [],
                      evidence: [],
                    }),
                  ),
                )
            }),
          )
        },
        { concurrency: settings.concurrency },
      )
      return yield* runRound(round + 1, [...previous, ...current])
    })
  return yield* runRound(1, [])
})

function normalizePlan(plan: WorkflowSchema.CouncilPlan, question: string, settings: Settings) {
  const issues =
    plan.issues.length > 0
      ? plan.issues.map((issue, index) =>
          WorkflowSchema.CouncilTopic.make({ id: `issue-${index + 1}`, question: issue.question }),
        )
      : [WorkflowSchema.CouncilTopic.make({ id: "issue-1", question })]
  const proposed = plan.perspectives
    .filter(
      (perspective, index, all) =>
        all.findIndex(
          (candidate) => candidate.title.trim().toLowerCase() === perspective.title.trim().toLowerCase(),
        ) === index,
    )
    .slice(0, settings.perspectives)
  const perspectives = [
    ...proposed,
    ...defaultPerspectives.filter((candidate) =>
      proposed.every((perspective) => perspective.title.trim().toLowerCase() !== candidate.title.toLowerCase()),
    ),
  ].slice(0, settings.perspectives)
  return {
    issues,
    perspectives: perspectives.map((perspective, index) =>
      WorkflowSchema.CouncilPerspectiveSpec.make({ ...perspective, id: `perspective-${index + 1}` }),
    ),
  }
}

const defaultPerspectives = [
  { id: "implementation", title: "Implementation", instructions: "Focus on feasibility and execution." },
  { id: "risk", title: "Risk", instructions: "Challenge assumptions and identify failure modes." },
  { id: "user", title: "User impact", instructions: "Focus on user value, friction, and accessibility." },
  { id: "operations", title: "Operations", instructions: "Focus on observability, rollout, and recovery." },
  { id: "security", title: "Security", instructions: "Focus on abuse cases, trust boundaries, and data exposure." },
  { id: "maintenance", title: "Maintenance", instructions: "Focus on long-term complexity and ownership." },
  { id: "performance", title: "Performance", instructions: "Focus on scale, latency, and resource costs." },
  { id: "simplicity", title: "Simplicity", instructions: "Challenge whether a smaller design is sufficient." },
] satisfies ReadonlyArray<WorkflowSchema.CouncilPerspectiveSpec>

function normalizePerspective(
  result: WorkflowSchema.CouncilPerspectiveResult,
  perspective: WorkflowSchema.CouncilPerspectiveSpec,
  issues: ReadonlyArray<WorkflowSchema.CouncilTopic>,
  sessionID: SessionSchema.ID,
  reportPath: string | undefined,
) {
  return WorkflowSchema.CouncilPerspective.make({
    ...result,
    perspective_id: perspective.id,
    session_id: sessionID,
    report_path: reportPath,
    issues: issues.map((issue) => {
      const reported = result.issues.find((candidate) => candidate.id === issue.id)
      return WorkflowSchema.CouncilIssue.make({
        id: issue.id,
        question: issue.question,
        stance: reported?.stance ?? "uncertain",
        rationale: reported?.rationale ?? "This perspective did not take a position on the issue.",
        evidence: reported?.evidence ?? [],
      })
    }),
  })
}

function selectDebateTopics(
  issues: ReadonlyArray<WorkflowSchema.CouncilTopic>,
  perspectives: ReadonlyArray<WorkflowSchema.CouncilPerspective>,
  settings: Settings,
) {
  if (settings.debate.mode === "off" || issues.length === 0 || perspectives.length === 0) return []
  const disagreements = issues.filter((issue) => {
    const stances = new Set(perspectives.map((perspective) => issueFor(perspective, issue.id)?.stance ?? "uncertain"))
    stances.delete("uncertain")
    return stances.size > 1
  })
  if (settings.debate.mode === "always")
    return issues.slice(0, settings.debate.topics).map((issue) => ({ ...issue, adversarial: false }))
  if (disagreements.length > 0)
    return disagreements.slice(0, settings.debate.topics).map((issue) => ({ ...issue, adversarial: false }))
  return [{ ...issues[0], adversarial: true }]
}

function selectParticipants(
  topic: DebateTopic,
  perspectives: ReadonlyArray<WorkflowSchema.CouncilPerspective>,
  count: number,
) {
  const representatives = perspectives.filter(
    (perspective, index) =>
      perspectives.findIndex(
        (candidate) => issueFor(candidate, topic.id)?.stance === issueFor(perspective, topic.id)?.stance,
      ) === index,
  )
  const ordered = [...representatives, ...perspectives.filter((perspective) => !representatives.includes(perspective))]
  return ordered.slice(0, Math.max(1, count))
}

function issueFor(perspective: WorkflowSchema.CouncilPerspective, issueID: string) {
  return perspective.issues.find((issue) => issue.id === issueID)
}

function normalizeSynthesis(
  synthesis: WorkflowSchema.CouncilSynthesis,
  issues: ReadonlyArray<WorkflowSchema.CouncilTopic>,
) {
  return WorkflowSchema.CouncilSynthesis.make({
    ...synthesis,
    disagreements: synthesis.disagreements.map((disagreement, index) => {
      const issue =
        issues.find((candidate) => candidate.id === disagreement.issue_id) ??
        issues.find((candidate) => candidate.question === disagreement.question) ??
        issues[Math.min(index, issues.length - 1)]
      return {
        ...disagreement,
        issue_id: issue.id,
        question: issue.question,
      }
    }),
  })
}

function fallbackSynthesis(
  issues: ReadonlyArray<WorkflowSchema.CouncilTopic>,
  perspectives: ReadonlyArray<WorkflowSchema.CouncilPerspective>,
  failures: ReadonlyArray<string>,
  error: string,
) {
  return WorkflowSchema.CouncilSynthesis.make({
    status: perspectives.length > 0 ? "partial" : "failed",
    summary:
      perspectives
        .map((perspective) => perspective.summary)
        .filter(Boolean)
        .join("\n\n") || `Council synthesis failed: ${error}`,
    consensus: [],
    disagreements: issues.map((issue) => ({
      issue_id: issue.id,
      question: issue.question,
      positions: perspectives.flatMap((perspective) => {
        const position = issueFor(perspective, issue.id)
        return position ? [`${perspective.perspective_id}: ${position.stance} — ${position.rationale}`] : []
      }),
    })),
    recommendations: perspectives.flatMap((perspective) => perspective.recommendations),
    risks: [
      ...perspectives.flatMap((perspective) => perspective.risks),
      ...failures,
      `Council synthesis failed: ${error}`,
    ],
  })
}

function planPrompt(question: string, settings: Settings) {
  return `Design a Council deliberation for this question:

${question}

Define stable issues that every perspective will address, then select ${settings.perspectives} genuinely distinct perspectives. Perspectives should expose meaningful tradeoffs rather than merely restating roles. Do not research or answer the question while planning. If you delegate, pass only a strict subproblem and never the complete Council question. Preserve extended rationale in workflow_report and submit a compact structured plan through workflow_result.`
}

function perspectivePrompt(
  question: string,
  issues: ReadonlyArray<WorkflowSchema.CouncilTopic>,
  perspective: WorkflowSchema.CouncilPerspectiveSpec,
  evidenceArtifacts: ReadonlyArray<WorkflowReport.Artifact>,
) {
  return `Analyze this question from one Council perspective.

Question:
${question}

Perspective:
${perspective.title}: ${perspective.instructions}

Stable issues:
${JSON.stringify(issues, undefined, 2)}

Authorized evidence artifacts:
${JSON.stringify(
  evidenceArtifacts.map((artifact) => ({
    artifact_id: artifact.id,
    title: artifact.title,
    available: artifact.reportPath !== undefined,
  })),
  undefined,
  2,
)}

${evidenceArtifacts.length > 0 ? "Read all authorized evidence artifacts with workflow_read_reports({ all: true }) before reaching conclusions." : ""}

Inspect the workspace when useful. Address every stable issue using its exact ID and choose one structured stance: support, oppose, conditional, or uncertain. Ground claims in evidence, preserve source URLs in the evidence that depends on them, preserve caveats, and provide recommendations and risks.

Delegate only a strict subproblem: use Heavy when one evidence question needs multi-step decomposition, or another Council when a narrower branch-local disputed premise needs its own debate. Never delegate the complete Council question unchanged, and leave whole-question disputes for this Council's synthesis. When recursively calling Council, supply a stable issue_key and the exact artifact_paths framing the dispute. Preserve the full analysis in workflow_report, then submit a compact structured index through workflow_result.`
}

function debatePrompt(
  question: string,
  topic: DebateTopic,
  perspective: WorkflowSchema.CouncilPerspective,
  perspectives: ReadonlyArray<WorkflowSchema.CouncilPerspective>,
  round: number,
  previous: string,
  reports: string,
) {
  return `Participate in Council debate round ${round}.

Question:
${question}

Issue:
${topic.id}: ${topic.question}

Your perspective:
${JSON.stringify(perspective, undefined, 2)}

All initial positions:
${JSON.stringify(
  perspectives.map((item) => ({
    perspective_id: item.perspective_id,
    summary: item.summary,
    issues: item.issues,
    report_path: item.report_path,
  })),
  undefined,
  2,
)}

Prior-round snapshot shared identically with every participant:
${previous || "[]"}

Durable perspective and prior-round reports, loaded deterministically:
${reports}

${
  topic.adversarial
    ? "The initial positions largely agree. Act as a rigorous red team: identify the strongest credible objection or hidden condition."
    : "Engage the actual disagreement. Respond to opposing evidence, make explicit concessions, and update your stance when warranted."
}

Use the exact issue and perspective IDs. Preserve the complete argument and evidence in workflow_report, then submit one compact structured contribution through workflow_result.`
}

function synthesisPrompt(
  question: string,
  rationale: string,
  perspectives: ReadonlyArray<WorkflowSchema.CouncilPerspective>,
  failures: ReadonlyArray<string>,
  debate: ReadonlyArray<WorkflowSchema.DebateContribution>,
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  reports: string,
  evidence: ReadonlyArray<WorkflowSchema.SourceReference>,
) {
  return `Synthesize a Council deliberation.

Question:
${question}

Council rationale:
${rationale}

Perspectives:
${JSON.stringify(
  perspectives.map((perspective) => ({
    perspective_id: perspective.perspective_id,
    summary: perspective.summary,
    issues: perspective.issues,
    recommendations: perspective.recommendations,
    risks: perspective.risks,
    report_path: perspective.report_path,
  })),
  undefined,
  2,
)}

Perspective failures:
${JSON.stringify(failures, undefined, 2)}

Debate:
${JSON.stringify(
  debate.map((contribution) => ({
    issue_id: contribution.issue_id,
    perspective_id: contribution.perspective_id,
    round: contribution.round,
    stance: contribution.stance,
    argument: contribution.argument,
    report_path: contribution.report_path,
  })),
  undefined,
  2,
)}

Direct synthesis artifact inventory:
${JSON.stringify(
  artifacts.map((artifact) => ({
    artifact_id: artifact.id,
    title: artifact.title,
    report_path: artifact.reportPath,
  })),
  undefined,
  2,
)}

Durable perspective and debate reports, loaded deterministically:
${reports}

Evidence ledger derived from tool execution:
${JSON.stringify(evidence, undefined, 2)}

The evidence ledger is authoritative for verification status. Never present an unverified or failed source as directly verified, and explicitly qualify conclusions that depend on partial evidence. Failed direct checks remain relevant provenance even when a participant omitted the URL from prose.

The durable reports above are canonical and must be incorporated, including material omitted from bounded indexes. In each workflow_report section, record coverage dispositions for the durable reports that materially informed that section. Also include one consolidated entry for every durable report in workflow_result.coverage using its exact title and report_path. Briefly record findings used, conclusions explicitly rejected, and unresolved contradictions; never claim receipt of a missing artifact. The engine merges both coverage channels deterministically. Do not erase minority positions, source URLs, or unresolved uncertainty. Separate consensus from disagreement, cite stable issue IDs, recommend a course of action with conditions, and preserve risks. Mark the synthesis partial when failures materially limit it.

The workflow_report is the authored Council document, not an executive recap or navigation page. Choose its outline from the question and the deliberation itself; do not impose a domain-specific stock template. Reconstruct the reasoning and preserve the material detail, competing positions, concessions, uncertainty, and conclusions needed for a standalone treatment. Treat every coverage entry as a content obligation: explain the important information used from it instead of merely recording that it was reviewed. Never use "see the perspective report" or "see the debate report" as a substitute for incorporating information, and never paste whole participant reports together. Use workflow_report repeatedly, normally one call per major section, when that is needed to author a complete document.

Put the complete subject-adaptive standalone document in workflow_report, then submit a compact structured synthesis through workflow_result.`
}

function validateSynthesisCoverage(
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  coverage: ReadonlyArray<WorkflowSchema.ArtifactCoverage>,
) {
  const missing = artifacts.filter(
    (artifact) =>
      artifact.reportPath &&
      !coverage.some(
        (entry) =>
          entry.report_path === artifact.reportPath &&
          entry.used.length + entry.rejected.length + entry.unresolved.length > 0,
      ),
  )
  if (missing.length === 0) return
  return `Council synthesis coverage must include one substantive disposition for every direct perspective and debate report. Missing: ${missing
    .map((artifact) => `${artifact.title} (${artifact.reportPath})`)
    .join(", ")}`
}
