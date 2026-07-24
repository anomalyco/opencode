export * as CouncilWorkflow from "./council"

import { Effect } from "effect"
import { AgentV2 } from "../agent"
import { SessionSchema } from "../session/schema"
import { Tool } from "../tool/tool"
import { Hash } from "../util/hash"
import { WorkflowRuntime } from "./runtime"
import { WorkflowSchema } from "./schema"

export interface Settings {
  readonly perspectives: number
  readonly concurrency: number
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
  context: Tool.Context,
  settings: Settings,
  runtime: WorkflowRuntime.Interface,
) {
  return Effect.gen(function* () {
    const runID = `council:${Hash.fast(context.toolCallID).slice(0, 12)}`
    const planID = `${runID}:plan`
    const rootSessionID = runtime.childID(parent.id, planID)
    yield* runtime.progress(
      context,
      { workflow: "council", phase: "planning", session_id: rootSessionID },
      "Council is selecting perspectives and stable issues",
    )
    let planningFailure: string | undefined
    const plan = yield* runtime
      .runChild({
        id: planID,
        parentID: parent.id,
        location: parent.location,
        title: "Council plan",
        agent: AgentV2.ID.make("council-planner"),
        model: settings.models.planner,
        result: WorkflowSchema.CouncilPlan,
        prompt: planPrompt(question, settings),
      })
      .pipe(
        Effect.catch((error) => {
          planningFailure = error.message
          return Effect.succeed(
            WorkflowSchema.CouncilPlan.make({
              rationale: `Council planner failed; using default independent perspectives: ${error.message}`,
              issues: [{ id: "decision", question }],
              perspectives: [],
            }),
          )
        }),
      )
    const normalized = normalizePlan(plan, question, settings)
    yield* runtime.progress(
      context,
      {
        workflow: "council",
        phase: "perspectives",
        session_id: rootSessionID,
        total: normalized.perspectives.length,
      },
      `Council is gathering ${normalized.perspectives.length} perspectives`,
    )
    const perspectiveResults = yield* Effect.forEach(
      normalized.perspectives,
      (perspective) => {
        const id = `${runID}:perspective:${perspective.id}`
        return runtime
          .runChild({
            id,
            parentID: rootSessionID,
            location: parent.location,
            title: `Council: ${perspective.title}`,
            agent: AgentV2.ID.make("council-perspective"),
            model: settings.models.perspective,
            result: WorkflowSchema.CouncilPerspectiveResult,
            prompt: perspectivePrompt(question, normalized.issues, perspective),
          })
          .pipe(
            Effect.map((result) => ({
              perspective,
              result: normalizePerspective(result, perspective, normalized.issues, runtime.childID(rootSessionID, id)),
            })),
            Effect.catch((error) =>
              Effect.succeed({
                perspective,
                error: error instanceof Error ? error.message : String(error),
              }),
            ),
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
        topics: topics.length,
        rounds: topics.length > 0 ? settings.debate.rounds : 0,
      },
      topics.length > 0 ? `Council is debating ${topics.length} issue(s)` : "Council found no debate topic",
    )
    const debate = yield* Effect.forEach(topics, (topic) =>
      debateTopic(question, topic, perspectives, runID, rootSessionID, parent, settings, runtime),
    ).pipe(Effect.map((rounds) => rounds.flat()))
    yield* runtime.progress(
      context,
      { workflow: "council", phase: "synthesizing", session_id: rootSessionID },
      "Council is synthesizing the deliberation",
    )
    let synthesisFailure: string | undefined
    const synthesis = yield* runtime
      .runChild({
        id: `${runID}:synthesis`,
        parentID: rootSessionID,
        location: parent.location,
        title: "Council synthesis",
        agent: AgentV2.ID.make("council-synthesizer"),
        model: settings.models.synthesizer,
        result: WorkflowSchema.CouncilSynthesis,
        prompt: synthesisPrompt(question, plan.rationale, perspectives, perspectiveFailures, debate),
      })
      .pipe(
        Effect.catch((error) => {
          synthesisFailure = error.message
          return Effect.succeed(fallbackSynthesis(normalized.issues, perspectives, perspectiveFailures, error.message))
        }),
      )
    const debateFailures = debate.filter((item) => item.argument.startsWith("Debate stage failed:")).length
    const normalizedSynthesis = normalizeSynthesis(synthesis, normalized.issues)
    const status =
      perspectives.length === 0
        ? "failed"
        : planningFailure || synthesisFailure || perspectiveFailures.length > 0 || debateFailures > 0
          ? synthesis.status === "failed"
            ? "failed"
            : "partial"
          : synthesis.status
    return WorkflowSchema.CouncilOutput.make({
      workflow: "council",
      status,
      summary: normalizedSynthesis.summary,
      root_session_id: rootSessionID,
      perspectives,
      debate,
      consensus: normalizedSynthesis.consensus,
      disagreements: normalizedSynthesis.disagreements,
      recommendations: normalizedSynthesis.recommendations,
      risks: normalizedSynthesis.risks,
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
  settings: Settings,
  runtime: WorkflowRuntime.Interface,
) {
  const participants = selectParticipants(topic, perspectives, settings.debate.participants)
  const runRound = (
    round: number,
    previous: ReadonlyArray<WorkflowSchema.DebateContribution>,
  ): Effect.Effect<ReadonlyArray<WorkflowSchema.DebateContribution>> => {
    if (round > settings.debate.rounds) return Effect.succeed(previous)
    const snapshot = JSON.stringify(previous, undefined, 2)
    return Effect.forEach(
      participants,
      (perspective) => {
        const id = `${runID}:debate:${topic.id}:${round}:${perspective.perspective_id}`
        const sessionID = runtime.childID(parentID, id)
        return runtime
          .runChild({
            id,
            parentID,
            location: parent.location,
            title: `Council debate: ${topic.question}`,
            agent: AgentV2.ID.make("council-debater"),
            model: settings.models.debater,
            result: WorkflowSchema.DebateResult,
            prompt: debatePrompt(question, topic, perspective, perspectives, round, snapshot),
          })
          .pipe(
            Effect.map((result) =>
              WorkflowSchema.DebateContribution.make({
                ...result,
                issue_id: topic.id,
                perspective_id: perspective.perspective_id,
                round,
                session_id: sessionID,
              }),
            ),
            Effect.catch((error) =>
              Effect.succeed(
                WorkflowSchema.DebateContribution.make({
                  issue_id: topic.id,
                  perspective_id: perspective.perspective_id,
                  round,
                  session_id: sessionID,
                  stance: issueFor(perspective, topic.id)?.stance ?? "uncertain",
                  argument: `Debate stage failed: ${error instanceof Error ? error.message : String(error)}`,
                  concessions: [],
                  rebuttals: [],
                  evidence: [],
                }),
              ),
            ),
          )
      },
      { concurrency: settings.concurrency },
    ).pipe(Effect.flatMap((current) => runRound(round + 1, [...previous, ...current])))
  }
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
) {
  return WorkflowSchema.CouncilPerspective.make({
    ...result,
    perspective_id: perspective.id,
    session_id: sessionID,
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

Define stable issues that every perspective will address, then select ${settings.perspectives} genuinely distinct perspectives. Perspectives should expose meaningful tradeoffs rather than merely restating roles. Submit the complete structured plan through workflow_result.`
}

function perspectivePrompt(
  question: string,
  issues: ReadonlyArray<WorkflowSchema.CouncilTopic>,
  perspective: WorkflowSchema.CouncilPerspectiveSpec,
) {
  return `Analyze this question from one Council perspective.

Question:
${question}

Perspective:
${perspective.title}: ${perspective.instructions}

Stable issues:
${JSON.stringify(issues, undefined, 2)}

Inspect the workspace when useful. Address every stable issue using its exact ID and choose one structured stance: support, oppose, conditional, or uncertain. Ground claims in evidence, preserve caveats, and provide recommendations and risks. Submit the complete structured result through workflow_result.`
}

function debatePrompt(
  question: string,
  topic: DebateTopic,
  perspective: WorkflowSchema.CouncilPerspective,
  perspectives: ReadonlyArray<WorkflowSchema.CouncilPerspective>,
  round: number,
  previous: string,
) {
  return `Participate in Council debate round ${round}.

Question:
${question}

Issue:
${topic.id}: ${topic.question}

Your perspective:
${JSON.stringify(perspective, undefined, 2)}

All initial positions:
${JSON.stringify(perspectives, undefined, 2)}

Prior-round snapshot shared identically with every participant:
${previous || "[]"}

${
  topic.adversarial
    ? "The initial positions largely agree. Act as a rigorous red team: identify the strongest credible objection or hidden condition."
    : "Engage the actual disagreement. Respond to opposing evidence, make explicit concessions, and update your stance when warranted."
}

Use the exact issue and perspective IDs. Submit one complete structured contribution through workflow_result.`
}

function synthesisPrompt(
  question: string,
  rationale: string,
  perspectives: ReadonlyArray<WorkflowSchema.CouncilPerspective>,
  failures: ReadonlyArray<string>,
  debate: ReadonlyArray<WorkflowSchema.DebateContribution>,
) {
  return `Synthesize a Council deliberation.

Question:
${question}

Council rationale:
${rationale}

Perspectives:
${JSON.stringify(perspectives, undefined, 2)}

Perspective failures:
${JSON.stringify(failures, undefined, 2)}

Debate:
${JSON.stringify(debate, undefined, 2)}

Do not erase minority positions or unresolved uncertainty. Separate consensus from disagreement, cite stable issue IDs, recommend a course of action with conditions, and preserve risks. Mark the synthesis partial when failures materially limit it. Submit the complete structured synthesis through workflow_result.`
}
