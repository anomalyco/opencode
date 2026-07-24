export * as WorkflowHandoff from "./handoff"

import { WorkflowSchema } from "./schema"

type HeavyOutput = typeof WorkflowSchema.HeavyOutput.Encoded
type CouncilOutput = typeof WorkflowSchema.CouncilOutput.Encoded

export type Session = {
  readonly session_id: string
  readonly status: string
  readonly agent?: string
  readonly title?: string
  readonly stage?: string
  readonly error?: string
}

const HANDOFF_MAX_BYTES = 32 * 1024
const ARCHIVE_NOTE =
  "The complete structured aggregate follows this handoff and is archived when tool-output truncation applies. Full child reports also remain in the durable session transcripts identified below."

export function heavy(output: HeavyOutput, sessions: ReadonlyArray<Session> = []): string {
  const root = output.nodes.find((node) => node.depth === 0) ?? output.nodes[0]
  const sourceManifest = extractSources(output)
  const councilManifest = output.council
    ? [
        {
          kind: "synthesis",
          title: "Council synthesis",
          status: output.council.status,
          session_id: output.council.synthesis_session_id,
        },
        ...output.council.perspectives.map((perspective) => ({
          kind: "perspective",
          title: perspective.perspective_id,
          status: "completed",
          session_id: perspective.session_id,
        })),
        ...output.council.debate.map((contribution) => ({
          kind: "debate",
          title: `${contribution.issue_id}: ${contribution.perspective_id}, round ${contribution.round}`,
          status: contribution.argument.startsWith("Debate stage failed:") ? "failed" : "completed",
          session_id: contribution.session_id,
        })),
      ]
    : []
  const base = {
    workflow: output.workflow,
    status: output.status,
    summary: output.summary,
    root_session_id: output.root_session_id,
    source_manifest: sourceManifest,
    archive_note: ARCHIVE_NOTE,
  }
  const finalReport = root
    ? {
        id: root.id,
        title: root.title,
        status: root.status,
        session_id: root.session_id,
        planning_session_id: root.planning_session_id,
        summary: root.summary,
        decisions: root.decisions,
        findings: root.findings,
        changed_files: root.changed_files,
        validation: root.validation,
        risks: root.risks,
        follow_up: root.follow_up,
      }
    : { status: output.status, summary: output.summary }
  const reports = output.nodes
    .filter((node) => node !== root)
    .map((node) => ({
      id: node.id,
      parent_id: node.parent_id,
      title: node.title,
      status: node.status,
      session_id: node.session_id,
      planning_session_id: node.planning_session_id,
      summary: node.summary,
    }))
  const sessionManifest: ReadonlyArray<Session> =
    sessions.length > 0
      ? sessions
      : uniqueSessions([
          {
            session_id: output.root_session_id,
            status: output.status,
            title: "Heavy root planning",
            stage: "planning",
          },
          ...output.nodes.flatMap((node) => [
            ...(node.planning_session_id && node.planning_session_id !== output.root_session_id
              ? [
                  {
                    session_id: node.planning_session_id,
                    status: node.status,
                    title: `${node.title} planning`,
                    stage: "planning",
                  },
                ]
              : []),
            {
              session_id: node.session_id,
              status: node.status,
              title: node.title,
              stage: "report",
            },
          ]),
          ...(output.council
            ? [
                {
                  session_id: output.council.root_session_id,
                  status: output.council.status,
                  title: "Council planning",
                  stage: "council-planning",
                },
                ...councilManifest.map((report) => ({
                  session_id: report.session_id,
                  status: report.status,
                  title: report.title,
                  stage: report.kind,
                })),
              ]
            : []),
        ])
  const compactRoot = root
    ? {
        status: root.status,
        session_id: root.session_id,
        planning_session_id: root.planning_session_id,
        summary: clip(root.summary, 6_000),
        decisions: clipStrings(root.decisions, 16, 600),
        findings: root.findings.slice(0, 12).map((finding) => ({
          claim: clip(finding.claim, 800),
          evidence: clipStrings(finding.evidence, 3, 500),
        })),
        changed_files: clipStrings(root.changed_files, 40, 300),
        validation: clipStrings(root.validation, 12, 600),
        risks: clipStrings(root.risks, 16, 600),
        follow_up: clipStrings(root.follow_up, 12, 600),
      }
    : finalReport
  const minimalRoot = root
    ? {
        status: root.status,
        session_id: root.session_id,
        planning_session_id: root.planning_session_id,
        summary: clip(root.summary, 4_000),
        decisions: clipStrings(root.decisions, 8, 300),
        findings: root.findings.slice(0, 6).map((finding) => ({
          claim: clip(finding.claim, 400),
          evidence: clipStrings(finding.evidence, 1, 300),
        })),
        changed_files: clipStrings(root.changed_files, 20, 200),
        validation: clipStrings(root.validation, 5, 300),
        risks: clipStrings(root.risks, 6, 300),
        follow_up: clipStrings(root.follow_up, 5, 300),
      }
    : finalReport
  const handoff = fit([
    {
      ...base,
      final_report: finalReport,
      report_manifest: reports,
      council_review: output.council,
      council_report_manifest: councilManifest,
      session_manifest: sessionManifest,
    },
    {
      ...base,
      final_report: compactRoot,
      report_manifest: reports.map((report) => ({ ...report, summary: clip(report.summary, 500) })),
      council_review: output.council ? compactCouncil(output.council) : undefined,
      council_report_manifest: councilManifest,
      session_manifest: sessionManifest.map((session) => ({
        ...session,
        title: session.title ? clip(session.title, 300) : undefined,
        error: session.error ? clip(session.error, 500) : undefined,
      })),
      handoff_compacted: true,
    },
    {
      ...base,
      final_report: minimalRoot,
      report_manifest: reports.map((report) => ({
        id: report.id,
        title: clip(report.title, 200),
        status: report.status,
        session_id: report.session_id,
      })),
      council_review: output.council ? minimalCouncil(output.council) : undefined,
      council_report_manifest: councilManifest,
      session_manifest: sessionManifest.map((session) => ({
        session_id: session.session_id,
        status: session.status,
        agent: session.agent,
        stage: session.stage,
        error: session.error ? clip(session.error, 300) : undefined,
      })),
      handoff_compacted: true,
    },
  ])
  return `${handoff}\n\nFull structured Heavy output:\n${JSON.stringify(output, null, 2)}`
}

export function council(output: CouncilOutput, sessions: ReadonlyArray<Session> = []): string {
  const sourceManifest = extractSources(output)
  const base = {
    workflow: output.workflow,
    status: output.status,
    summary: output.summary,
    root_session_id: output.root_session_id,
    source_manifest: sourceManifest,
    archive_note: ARCHIVE_NOTE,
  }
  const finalReport = {
    status: output.status,
    session_id: output.synthesis_session_id,
    summary: output.summary,
    consensus: output.consensus,
    disagreements: output.disagreements,
    recommendations: output.recommendations,
    risks: output.risks,
  }
  const sessionManifest: ReadonlyArray<Session> =
    sessions.length > 0
      ? sessions
      : uniqueSessions([
          {
            session_id: output.root_session_id,
            status: output.status,
            title: "Council planning",
            stage: "planning",
          },
          ...output.perspectives.map((perspective) => ({
            session_id: perspective.session_id,
            status: "completed",
            title: perspective.perspective_id,
            stage: "perspective",
          })),
          ...output.debate.map((contribution) => ({
            session_id: contribution.session_id,
            status: "completed",
            title: `${contribution.issue_id}: ${contribution.perspective_id}`,
            stage: "debate",
          })),
          {
            session_id: output.synthesis_session_id,
            status: output.status,
            title: "Council synthesis",
            stage: "synthesis",
          },
        ])
  const handoff = fit([
    {
      ...base,
      final_report: finalReport,
      perspective_reports: output.perspectives,
      debate_reports: output.debate,
      session_manifest: sessionManifest,
    },
    {
      ...base,
      final_report: {
        status: output.status,
        session_id: output.synthesis_session_id,
        summary: clip(output.summary, 6_000),
        consensus: clipStrings(output.consensus, 20, 600),
        disagreements: output.disagreements.slice(0, 12).map((item) => ({
          issue_id: item.issue_id,
          question: clip(item.question, 600),
          positions: clipStrings(item.positions, 8, 600),
        })),
        recommendations: clipStrings(output.recommendations, 20, 600),
        risks: clipStrings(output.risks, 20, 600),
      },
      perspective_reports: output.perspectives.map((perspective) => ({
        perspective_id: perspective.perspective_id,
        session_id: perspective.session_id,
        summary: clip(perspective.summary, 1_000),
        issues: perspective.issues.slice(0, 8).map((issue) => ({
          id: issue.id,
          stance: issue.stance,
          rationale: clip(issue.rationale, 500),
        })),
        recommendations: clipStrings(perspective.recommendations, 8, 500),
        risks: clipStrings(perspective.risks, 8, 500),
      })),
      debate_reports: output.debate.map((contribution) => ({
        issue_id: contribution.issue_id,
        perspective_id: contribution.perspective_id,
        round: contribution.round,
        stance: contribution.stance,
        argument: clip(contribution.argument, 700),
        session_id: contribution.session_id,
      })),
      session_manifest: sessionManifest,
      handoff_compacted: true,
    },
    {
      ...base,
      final_report: {
        status: output.status,
        session_id: output.synthesis_session_id,
        summary: clip(output.summary, 4_000),
        consensus: clipStrings(output.consensus, 10, 300),
        disagreements: output.disagreements.slice(0, 8).map((item) => ({
          issue_id: item.issue_id,
          question: clip(item.question, 300),
          positions: clipStrings(item.positions, 4, 300),
        })),
        recommendations: clipStrings(output.recommendations, 10, 300),
        risks: clipStrings(output.risks, 10, 300),
      },
      perspective_reports: output.perspectives.map((perspective) => ({
        perspective_id: perspective.perspective_id,
        session_id: perspective.session_id,
        summary: clip(perspective.summary, 500),
        issues: perspective.issues.map((issue) => ({ id: issue.id, stance: issue.stance })),
      })),
      debate_reports: output.debate.map((contribution) => ({
        issue_id: contribution.issue_id,
        perspective_id: contribution.perspective_id,
        round: contribution.round,
        stance: contribution.stance,
        session_id: contribution.session_id,
      })),
      session_manifest: sessionManifest.map((session) => ({
        session_id: session.session_id,
        status: session.status,
        agent: session.agent,
        stage: session.stage,
        error: session.error ? clip(session.error, 300) : undefined,
      })),
      handoff_compacted: true,
    },
  ])
  return `${handoff}\n\nFull structured Council output:\n${JSON.stringify(output, null, 2)}`
}

function fit(candidates: ReadonlyArray<Record<string, unknown>>) {
  for (const candidate of candidates) {
    const serialized = JSON.stringify(candidate)
    if (Buffer.byteLength(serialized, "utf8") <= HANDOFF_MAX_BYTES) return serialized
  }
  const candidate = candidates.at(-1) ?? {}
  const finalReport = record(candidate.final_report)
  const councilReview = record(candidate.council_review)
  return JSON.stringify({
    workflow: candidate.workflow,
    status: candidate.status,
    summary: clip(typeof candidate.summary === "string" ? candidate.summary : "", 4_000),
    root_session_id: candidate.root_session_id,
    final_report: finalReport
      ? {
          status: finalReport.status,
          session_id: finalReport.session_id,
          summary: clip(typeof finalReport.summary === "string" ? finalReport.summary : "", 3_000),
        }
      : undefined,
    report_manifest: minimalManifest(candidate.report_manifest, 16),
    council_review: councilReview
      ? {
          status: councilReview.status,
          synthesis_session_id: councilReview.synthesis_session_id,
          summary: clip(typeof councilReview.summary === "string" ? councilReview.summary : "", 1_000),
        }
      : undefined,
    council_report_manifest: minimalManifest(candidate.council_report_manifest, 16),
    perspective_reports: minimalManifest(candidate.perspective_reports, 8),
    debate_reports: minimalManifest(candidate.debate_reports, 8),
    session_manifest: minimalManifest(candidate.session_manifest, 32),
    source_manifest: Array.isArray(candidate.source_manifest)
      ? candidate.source_manifest
          .slice(0, 12)
          .filter((source): source is string => typeof source === "string")
          .map((source) => clip(source, 500))
      : [],
    archive_note: ARCHIVE_NOTE,
    handoff_compacted: true,
    report_counts: {
      reports: Array.isArray(candidate.report_manifest) ? candidate.report_manifest.length : undefined,
      perspectives: Array.isArray(candidate.perspective_reports) ? candidate.perspective_reports.length : undefined,
      debate: Array.isArray(candidate.debate_reports) ? candidate.debate_reports.length : undefined,
      council: Array.isArray(candidate.council_report_manifest) ? candidate.council_report_manifest.length : undefined,
      sessions: Array.isArray(candidate.session_manifest) ? candidate.session_manifest.length : undefined,
    },
  })
}

function minimalManifest(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return []
  return value.slice(0, maximum).flatMap((item) => {
    const current = record(item)
    if (!current) return []
    return [
      {
        id: current.id,
        kind: current.kind,
        title: typeof current.title === "string" ? clip(current.title, 100) : undefined,
        status: current.status,
        stage: current.stage,
        session_id: current.session_id,
        perspective_id: current.perspective_id,
        issue_id: current.issue_id,
        round: current.round,
      },
    ]
  })
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function compactCouncil(output: CouncilOutput) {
  return {
    status: output.status,
    summary: clip(output.summary, 4_000),
    root_session_id: output.root_session_id,
    synthesis_session_id: output.synthesis_session_id,
    consensus: clipStrings(output.consensus, 12, 500),
    disagreements: output.disagreements.slice(0, 8).map((item) => ({
      issue_id: item.issue_id,
      question: clip(item.question, 400),
      positions: clipStrings(item.positions, 6, 400),
    })),
    recommendations: clipStrings(output.recommendations, 12, 500),
    risks: clipStrings(output.risks, 12, 500),
  }
}

function minimalCouncil(output: CouncilOutput) {
  return {
    status: output.status,
    summary: clip(output.summary, 2_000),
    root_session_id: output.root_session_id,
    synthesis_session_id: output.synthesis_session_id,
    consensus: clipStrings(output.consensus, 6, 300),
    disagreements: output.disagreements.slice(0, 4).map((item) => ({
      issue_id: item.issue_id,
      question: clip(item.question, 300),
      positions: clipStrings(item.positions, 3, 300),
    })),
    recommendations: clipStrings(output.recommendations, 6, 300),
    risks: clipStrings(output.risks, 6, 300),
  }
}

function extractSources(value: unknown) {
  const sources = new Set<string>()
  const visit = (current: unknown): void => {
    if (typeof current === "string") {
      Array.from(current.matchAll(/https?:\/\/[^\s<>"'`]+/g), (match) => match[0].replace(/[),.;:\]}]+$/g, "")).forEach(
        (source) => sources.add(source),
      )
      return
    }
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!current || typeof current !== "object") return
    Object.values(current).forEach(visit)
  }
  visit(value)
  return Array.from(sources).slice(0, 100)
}

function uniqueSessions(sessions: ReadonlyArray<Session>) {
  return Array.from(new Map(sessions.map((session) => [session.session_id, session])).values())
}

function clipStrings(values: ReadonlyArray<string>, maxItems: number, maxChars: number) {
  const clipped = values.slice(0, maxItems).map((value) => clip(value, maxChars))
  if (values.length <= maxItems) return clipped
  return [...clipped, `[${values.length - maxItems} more entries remain in the archived report]`]
}

function clip(value: string, maxChars: number) {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`
}
