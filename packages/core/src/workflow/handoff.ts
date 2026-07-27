export * as WorkflowHandoff from "./handoff"

import { WorkflowSchema } from "./schema"
import { WorkflowReport } from "./report"

type HeavyOutput = typeof WorkflowSchema.HeavyOutput.Encoded
type CouncilOutput = typeof WorkflowSchema.CouncilOutput.Encoded
type ResearchOutput = typeof WorkflowSchema.ResearchOutput.Encoded

export type Session = {
  readonly session_id: string
  readonly parent_session_id?: string
  readonly run_id?: string
  readonly parent_run_id?: string
  readonly status: string
  readonly activity?: string
  readonly workflow?: "heavy" | "council" | "research"
  readonly agent?: string
  readonly title?: string
  readonly stage?: string
  readonly node_id?: string
  readonly parent_node_id?: string
  readonly depth?: number
  readonly workflow_depth?: number
  readonly depends_on?: ReadonlyArray<string>
  readonly report_path?: string
  readonly error?: string
  readonly usage?: unknown
}

const HANDOFF_MAX_BYTES = 40 * 1024
const ARCHIVE_NOTE =
  "The complete aggregate is preserved in report_path and the durable stage reports. This bounded handoff intentionally omits duplicated report bodies."

export function heavy(output: HeavyOutput, sessions: ReadonlyArray<Session> = []): string {
  const root = output.nodes.find((node) => node.depth === 0) ?? output.nodes[0]
  const sourceManifest = WorkflowReport.extractSources(output)
  const reportLink = output.report_path ? `[Full Heavy report](${output.report_path})` : undefined
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
    execution_status: output.execution_status,
    artifact_status: output.artifact_status,
    evidence_status: output.evidence_status,
    summary: output.summary,
    final_response: withReportLink(output.final_response, reportLink),
    final_response_instruction:
      "Use final_response as the answer body with only minimal formatting repair. It already contains the exact report link: preserve that link verbatim and do not reconstruct its path. Do not reinterpret or contradict the report. Honor evidence_status: explicitly disclose partial evidence and never present unverified or failed sources as verified.",
    usage: output.usage,
    timing: output.timing,
    root_session_id: output.root_session_id,
    report_path: output.report_path,
    report_link: reportLink,
    source_manifest: sourceManifest,
    source_provenance: compactSourceProvenance(output.source_provenance, 32),
    coverage_diagnostics: coverageDiagnostics(root?.coverage),
    archive_note: ARCHIVE_NOTE,
  }
  const finalReport = root
    ? {
        id: root.id,
        title: root.title,
        status: root.status,
        session_id: root.session_id,
        planning_session_id: root.planning_session_id,
        report_path: root.report_path,
        summary: root.summary,
        decisions: root.decisions,
        findings: root.findings,
        changed_files: root.changed_files,
        validation: root.validation,
        risks: root.risks,
        follow_up: root.follow_up,
        coverage: root.coverage,
        plan: root.plan,
        council_routing: root.council_routing,
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
      report_path: node.report_path,
      summary: node.summary,
    }))
  const sessionManifest: ReadonlyArray<Session> =
    sessions.length > 0
      ? sessions
      : output.session_manifest?.length
        ? output.session_manifest
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
                stage: "synthesis",
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
        report_path: root.report_path,
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
        coverage: compactCoverage(root.coverage, 16),
        plan: compactPlan(root.plan, 16),
        council_routing: root.council_routing,
      }
    : finalReport
  const minimalRoot = root
    ? {
        status: root.status,
        session_id: root.session_id,
        planning_session_id: root.planning_session_id,
        report_path: root.report_path,
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
        coverage: compactCoverage(root.coverage, 8),
        plan: compactPlan(root.plan, 8),
        council_routing: root.council_routing,
      }
    : finalReport
  const handoff = fit([
    {
      ...base,
      final_report: finalReport,
      report_manifest: reports,
      delegation_manifest: output.delegations ?? [],
      council_review: output.council,
      council_report_manifest: councilManifest,
      session_manifest: sessionManifest,
    },
    {
      ...base,
      final_report: compactRoot,
      report_manifest: reports.map((report) => ({ ...report, summary: clip(report.summary, 500) })),
      delegation_manifest: compactDelegations(output.delegations),
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
        report_path: report.report_path,
      })),
      delegation_manifest: minimalManifest(output.delegations, 16),
      council_review: output.council ? minimalCouncil(output.council) : undefined,
      council_report_manifest: councilManifest,
      session_manifest: sessionManifest.map((session) => ({
        session_id: session.session_id,
        parent_session_id: session.parent_session_id,
        run_id: session.run_id,
        parent_run_id: session.parent_run_id,
        status: session.status,
        workflow: session.workflow,
        agent: session.agent,
        stage: session.stage,
        node_id: session.node_id,
        parent_node_id: session.parent_node_id,
        depth: session.depth ?? session.workflow_depth,
        depends_on: session.depends_on,
        report_path: session.report_path,
        error: session.error ? clip(session.error, 300) : undefined,
      })),
      handoff_compacted: true,
    },
  ])
  return handoff
}

export function council(output: CouncilOutput, sessions: ReadonlyArray<Session> = []): string {
  const sourceManifest = WorkflowReport.extractSources(output)
  const reportLink = output.report_path ? `[Full Council report](${output.report_path})` : undefined
  const base = {
    workflow: output.workflow,
    status: output.status,
    execution_status: output.execution_status,
    artifact_status: output.artifact_status,
    evidence_status: output.evidence_status,
    summary: output.summary,
    final_response: withReportLink(output.final_response, reportLink),
    final_response_instruction:
      "Use final_response as the answer body with only minimal formatting repair. It already contains the exact report link: preserve that link verbatim and do not reconstruct its path. Do not reinterpret or contradict the report. Honor evidence_status: explicitly disclose partial evidence and never present unverified or failed sources as verified.",
    usage: output.usage,
    timing: output.timing,
    root_session_id: output.root_session_id,
    report_path: output.report_path,
    report_link: reportLink,
    source_manifest: sourceManifest,
    source_provenance: compactSourceProvenance(output.source_provenance, 32),
    coverage_diagnostics: coverageDiagnostics(output.coverage),
    archive_note: ARCHIVE_NOTE,
  }
  const finalReport = {
    status: output.status,
    session_id: output.synthesis_session_id,
    report_path: output.synthesis_report_path,
    summary: output.summary,
    consensus: output.consensus,
    disagreements: output.disagreements,
    recommendations: output.recommendations,
    risks: output.risks,
    coverage: output.coverage,
  }
  const sessionManifest: ReadonlyArray<Session> =
    sessions.length > 0
      ? sessions
      : output.session_manifest?.length
        ? output.session_manifest
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
      delegation_manifest: output.delegations ?? [],
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
        coverage: compactCoverage(output.coverage, 16),
      },
      delegation_manifest: compactDelegations(output.delegations),
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
        coverage: compactCoverage(output.coverage, 8),
      },
      delegation_manifest: minimalManifest(output.delegations, 16),
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
        parent_session_id: session.parent_session_id,
        run_id: session.run_id,
        parent_run_id: session.parent_run_id,
        status: session.status,
        workflow: session.workflow,
        agent: session.agent,
        stage: session.stage,
        node_id: session.node_id,
        parent_node_id: session.parent_node_id,
        depth: session.depth ?? session.workflow_depth,
        depends_on: session.depends_on,
        report_path: session.report_path,
        error: session.error ? clip(session.error, 300) : undefined,
      })),
      handoff_compacted: true,
    },
  ])
  return handoff
}

export function research(output: ResearchOutput, sessions: ReadonlyArray<Session> = []): string {
  const root = output.nodes.find((node) => node.depth === 0) ?? output.nodes[0]
  const reportLink = output.report_path ? `[Full Research report](${output.report_path})` : undefined
  const base = {
    workflow: output.workflow,
    status: output.status,
    execution_status: output.execution_status,
    artifact_status: output.artifact_status,
    evidence_status: output.evidence_status,
    summary: output.summary,
    final_response: withReportLink(output.final_response, reportLink),
    final_response_instruction:
      "Use final_response as the answer body with only minimal formatting repair. It is the standalone root-authored Research document and already contains the exact report link; preserve that link verbatim. Honor evidence_status, claim confidence, unresolved gaps, and source verification.",
    usage: output.usage,
    timing: output.timing,
    root_session_id: output.root_session_id,
    report_path: output.report_path,
    trace_path: output.trace_path,
    graph_path: output.graph_path,
    raw_graph_path: output.raw_graph_path,
    evaluation: output.evaluation,
    report_link: reportLink,
    source_manifest: output.source_manifest ?? WorkflowReport.extractSources(output),
    source_provenance: compactSourceProvenance(output.source_provenance, 32),
    coverage_diagnostics: coverageDiagnostics(root?.result.coverage),
    archive_note: ARCHIVE_NOTE,
  }
  const finalReport = root
    ? {
        status: root.result.status,
        session_id: root.synthesis_session_id,
        report_path: root.report_path,
        summary: root.result.summary,
        conclusions: root.result.conclusions,
        recommendations: root.result.recommendations,
        limitations: root.result.limitations,
        claims: root.result.claims,
        gaps: root.result.gaps,
        disputes: root.result.disputes,
        coverage: root.result.coverage,
      }
    : { status: output.status, summary: output.summary }
  const reportManifest = output.nodes.flatMap((node) => [
    {
      id: node.id,
      title: node.title,
      status: node.result.status,
      stage: node.depth === 0 ? "final" : "branch-synthesis",
      session_id: node.synthesis_session_id,
      report_path: node.depth === 0 ? output.report_path : node.report_path,
      depth: node.depth,
    },
    ...node.waves.flatMap((wave) =>
      wave.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        stage: "evidence",
        session_id: task.session_id,
        report_path: task.report_path,
        depth: node.depth + 1,
      })),
    ),
  ])
  const sessionManifest: ReadonlyArray<Session> =
    sessions.length > 0
      ? sessions
      : output.session_manifest?.length
        ? output.session_manifest
        : uniqueSessions(
            output.nodes.flatMap((node) => [
              {
                session_id: node.planning_session_id,
                status: node.result.status,
                workflow: "research",
                title: `${node.title} contract`,
                stage: "planning",
              },
              ...node.waves.flatMap((wave) => [
                ...wave.tasks.map((task) => ({
                  session_id: task.session_id,
                  status: task.status,
                  workflow: "research" as const,
                  title: task.title,
                  stage: "evidence",
                  report_path: task.report_path,
                })),
                {
                  session_id: wave.assessment_session_id,
                  status: "completed",
                  workflow: "research" as const,
                  title: `${node.title} wave ${wave.number} assessment`,
                  stage: "assessment",
                },
              ]),
              {
                session_id: node.synthesis_session_id,
                status: node.result.status,
                workflow: "research",
                title: node.title,
                stage: "synthesis",
                report_path: node.report_path,
              },
            ]),
          )
  const compactGraph = {
    claims: output.graph.claims.slice(0, 24).map((claim) => ({
      id: claim.id,
      statement: clip(claim.statement, 700),
      kind: claim.kind,
      status: claim.status,
      confidence: claim.confidence,
      evidence_ids: claim.evidence_ids.slice(0, 8),
      contradicts: claim.contradicts.slice(0, 6),
    })),
    evidence: output.graph.evidence.slice(0, 32).map((evidence) => ({
      id: evidence.id,
      summary: clip(evidence.summary, 600),
      claim_ids: evidence.claim_ids.slice(0, 8),
      stance: evidence.stance,
      source_type: evidence.source_type,
      verification: evidence.verification,
      url: evidence.url,
    })),
    gaps: output.graph.gaps.slice(0, 16),
    disputes: output.graph.disputes.slice(0, 12),
    assumptions: clipStrings(output.graph.assumptions, 12, 400),
  }
  return fit([
    {
      ...base,
      final_report: finalReport,
      research_contract: root?.contract,
      adaptive_waves: root?.waves,
      claim_graph: output.graph,
      report_manifest: reportManifest,
      council_reviews: output.councils,
      delegation_manifest: output.delegations ?? [],
      session_manifest: sessionManifest,
    },
    {
      ...base,
      final_report: root
        ? {
            status: root.result.status,
            session_id: root.synthesis_session_id,
            report_path: root.report_path,
            summary: clip(root.result.summary, 6_000),
            conclusions: clipStrings(root.result.conclusions, 16, 600),
            recommendations: clipStrings(root.result.recommendations, 16, 600),
            limitations: clipStrings(root.result.limitations, 16, 600),
            coverage: compactCoverage(root.result.coverage, 16),
          }
        : finalReport,
      research_contract: root
        ? {
            objective: root.contract.objective,
            deliverables: root.contract.deliverables,
            assumptions: root.contract.assumptions,
            unknowns: root.contract.unknowns,
            falsifiers: root.contract.falsifiers,
          }
        : undefined,
      adaptive_waves: root?.waves.map((wave) => ({
        number: wave.number,
        information_gain: wave.assessment.information_gain,
        coverage: wave.assessment.coverage,
        decision: wave.assessment.decision,
        stop_reason: wave.stop_reason,
        tasks: wave.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          session_id: task.session_id,
          report_path: task.report_path,
          artifact_id: task.artifact_id,
          reused: task.reused,
        })),
      })),
      claim_graph: compactGraph,
      report_manifest: reportManifest,
      council_reviews: output.councils.map((review) => ({
        dispute_id: review.dispute_id,
        dispute_ids: review.dispute_ids,
        question: clip(review.question, 500),
        status: review.output.status,
        report_path: review.output.report_path,
        summary: clip(review.output.summary, 1_000),
      })),
      delegation_manifest: compactDelegations(output.delegations),
      session_manifest: sessionManifest,
      handoff_compacted: true,
    },
    {
      ...base,
      final_report: root
        ? {
            status: root.result.status,
            session_id: root.synthesis_session_id,
            summary: clip(root.result.summary, 4_000),
            conclusions: clipStrings(root.result.conclusions, 8, 300),
            recommendations: clipStrings(root.result.recommendations, 8, 300),
            limitations: clipStrings(root.result.limitations, 8, 300),
          }
        : finalReport,
      claim_graph: {
        claims: compactGraph.claims.slice(0, 12),
        gaps: compactGraph.gaps.slice(0, 8),
        disputes: compactGraph.disputes.slice(0, 8),
      },
      report_manifest: handoffManifest(reportManifest, 24),
      council_reviews: output.councils.map((review) => ({
        dispute_id: review.dispute_id,
        dispute_ids: review.dispute_ids,
        status: review.output.status,
        report_path: review.output.report_path,
      })),
      delegation_manifest: minimalManifest(output.delegations, 16),
      session_manifest: minimalManifest(sessionManifest, 48),
      handoff_compacted: true,
    },
  ])
}

function fit(candidates: ReadonlyArray<Record<string, unknown>>) {
  for (const candidate of candidates) {
    const serialized = JSON.stringify(candidate)
    if (Buffer.byteLength(serialized, "utf8") <= HANDOFF_MAX_BYTES) return serialized
  }
  const candidate = candidates.at(-1) ?? {}
  const finalReport = record(candidate.final_report)
  const councilReview = record(candidate.council_review)
  const response = typeof candidate.final_response === "string" ? candidate.final_response : ""
  const fallback = {
    workflow: candidate.workflow,
    status: candidate.status,
    execution_status: candidate.execution_status,
    artifact_status: candidate.artifact_status,
    evidence_status: candidate.evidence_status,
    summary: clip(typeof candidate.summary === "string" ? candidate.summary : "", 2_000),
    final_response: "",
    final_response_instruction: candidate.final_response_instruction,
    usage: candidate.usage,
    timing: candidate.timing,
    root_session_id: candidate.root_session_id,
    report_path: candidate.report_path,
    trace_path: candidate.trace_path,
    graph_path: candidate.graph_path,
    raw_graph_path: candidate.raw_graph_path,
    report_link: candidate.report_link,
    final_report: finalReport
      ? {
          status: finalReport.status,
          session_id: finalReport.session_id,
          summary: clip(typeof finalReport.summary === "string" ? finalReport.summary : "", 1_000),
          plan: compactPlan(finalReport.plan, 12),
          council_routing: finalReport.council_routing,
        }
      : undefined,
    report_manifest: handoffManifest(candidate.report_manifest, 16),
    delegation_manifest: handoffManifest(candidate.delegation_manifest, 8),
    council_review: councilReview
      ? {
          status: councilReview.status,
          synthesis_session_id: councilReview.synthesis_session_id,
          summary: clip(typeof councilReview.summary === "string" ? councilReview.summary : "", 500),
        }
      : undefined,
    council_report_manifest: handoffManifest(candidate.council_report_manifest, 16),
    perspective_reports: handoffManifest(candidate.perspective_reports, 8),
    debate_reports: handoffManifest(candidate.debate_reports, 8),
    session_manifest: minimalManifest(candidate.session_manifest, 32).map((session) => ({
      status: session.status,
      session_id: session.session_id,
      parent_session_id: session.parent_session_id,
      workflow: session.workflow,
      title: session.title,
      stage: session.stage,
      report_path: session.report_path,
      error: session.error,
    })),
    source_manifest: Array.isArray(candidate.source_manifest)
      ? candidate.source_manifest
          .slice(0, 12)
          .filter((source): source is string => typeof source === "string")
          .map((source) => clip(source, 500))
      : [],
    source_provenance: compactSourceProvenance(candidate.source_provenance, 12).map((source) => ({
      url: source.url,
      kind: source.kind,
      verification: source.verification,
      direct_checks: source.direct_checks,
      search_discoveries: source.search_discoveries,
    })),
    coverage_diagnostics: candidate.coverage_diagnostics,
    archive_note: ARCHIVE_NOTE,
    handoff_compacted: true,
    report_counts: {
      reports: Array.isArray(candidate.report_manifest) ? candidate.report_manifest.length : undefined,
      perspectives: Array.isArray(candidate.perspective_reports) ? candidate.perspective_reports.length : undefined,
      debate: Array.isArray(candidate.debate_reports) ? candidate.debate_reports.length : undefined,
      council: Array.isArray(candidate.council_report_manifest) ? candidate.council_report_manifest.length : undefined,
      delegations: Array.isArray(candidate.delegation_manifest) ? candidate.delegation_manifest.length : undefined,
      sessions: Array.isArray(candidate.session_manifest) ? candidate.session_manifest.length : undefined,
    },
  }
  return fitResponse(fallback, response)
}

function fitResponse(candidate: Record<string, unknown>, response: string) {
  const serialize = (value: string) => JSON.stringify({ ...candidate, final_response: value })
  if (Buffer.byteLength(serialize(response), "utf8") <= HANDOFF_MAX_BYTES) return serialize(response)
  const reportLink =
    typeof candidate.report_link === "string" && response.endsWith(candidate.report_link)
      ? candidate.report_link
      : undefined
  const suffix = reportLink ? `\n\n${reportLink}` : ""
  const body = reportLink ? response.slice(0, -reportLink.length).trimEnd() : response
  let low = 0
  let high = body.length
  let result = ""
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const value = `${middle < body.length ? `${body.slice(0, Math.max(0, middle - 1))}…` : body}${suffix}`
    const serialized = serialize(value)
    if (Buffer.byteLength(serialized, "utf8") <= HANDOFF_MAX_BYTES) {
      result = serialized
      low = middle + 1
      continue
    }
    high = middle - 1
  }
  if (result) return result
  return JSON.stringify({
    workflow: candidate.workflow,
    status: candidate.status,
    execution_status: candidate.execution_status,
    artifact_status: candidate.artifact_status,
    evidence_status: candidate.evidence_status,
    summary: candidate.summary,
    final_response: "",
    report_path: candidate.report_path,
    trace_path: candidate.trace_path,
    graph_path: candidate.graph_path,
    raw_graph_path: candidate.raw_graph_path,
    report_link: candidate.report_link,
    archive_note: ARCHIVE_NOTE,
    handoff_compacted: true,
  })
}

function withReportLink(response: string | undefined, reportLink: string | undefined) {
  if (!reportLink) return response
  if (!response?.trim()) return reportLink
  if (response.includes(reportLink)) return response
  return `${response.trimEnd()}\n\n${reportLink}`
}

function handoffManifest(value: unknown, maximum: number) {
  return minimalManifest(value, maximum).map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    status: item.status,
    execution_status: item.execution_status,
    artifact_status: item.artifact_status,
    evidence_status: item.evidence_status,
    stage: item.stage,
    session_id: item.session_id,
    workflow: item.workflow,
    depth: item.depth,
    report_path: typeof item.report_path === "string" ? clip(item.report_path, 300) : undefined,
  }))
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
        execution_status: current.execution_status,
        artifact_status: current.artifact_status,
        evidence_status: current.evidence_status,
        stage: current.stage,
        session_id: current.session_id,
        perspective_id: current.perspective_id,
        issue_id: current.issue_id,
        round: current.round,
        workflow: current.workflow,
        depth: current.depth,
        parent_id: current.parent_id,
        parent_session_id: current.parent_session_id,
        run_id: current.run_id,
        parent_run_id: current.parent_run_id,
        node_id: current.node_id,
        parent_node_id: current.parent_node_id,
        workflow_depth: current.workflow_depth,
        depends_on: current.depends_on,
        root_session_id: current.root_session_id,
        session_ids: current.session_ids,
        report_path: current.report_path,
        error: typeof current.error === "string" ? clip(current.error, 300) : undefined,
      },
    ]
  })
}

function compactDelegations(value: HeavyOutput["delegations"]) {
  return (value ?? []).slice(0, 24).map((delegation) => ({
    id: delegation.id,
    parent_id: delegation.parent_id,
    parent_session_id: delegation.parent_session_id,
    workflow: delegation.workflow,
    depth: delegation.depth,
    objective: clip(delegation.objective, 500),
    status: delegation.status,
    execution_status: delegation.execution_status,
    artifact_status: delegation.artifact_status,
    evidence_status: delegation.evidence_status,
    summary: clip(delegation.summary, 1_000),
    root_session_id: delegation.root_session_id,
    session_ids: delegation.session_ids,
    report_path: delegation.report_path,
    timing: delegation.timing,
  }))
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function compactCouncil(output: CouncilOutput) {
  return {
    status: output.status,
    execution_status: output.execution_status,
    artifact_status: output.artifact_status,
    evidence_status: output.evidence_status,
    summary: clip(output.summary, 4_000),
    final_response: output.final_response ? clip(output.final_response, 12_000) : undefined,
    usage: output.usage,
    timing: output.timing,
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
    timing: output.timing,
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

function uniqueSessions(sessions: ReadonlyArray<Session>) {
  return Array.from(new Map(sessions.map((session) => [session.session_id, session])).values())
}

function compactCoverage(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return []
  return value.slice(0, maximum).flatMap((item) => {
    const current = record(item)
    if (!current) return []
    return [
      {
        title: typeof current.title === "string" ? clip(current.title, 200) : undefined,
        report_path: current.report_path,
        received: current.received,
        used: Array.isArray(current.used)
          ? clipStrings(
              current.used.filter((entry): entry is string => typeof entry === "string"),
              2,
              300,
            )
          : [],
        rejected: Array.isArray(current.rejected)
          ? clipStrings(
              current.rejected.filter((entry): entry is string => typeof entry === "string"),
              2,
              300,
            )
          : [],
        unresolved: Array.isArray(current.unresolved)
          ? clipStrings(
              current.unresolved.filter((entry): entry is string => typeof entry === "string"),
              2,
              300,
            )
          : [],
      },
    ]
  })
}

function compactPlan(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return []
  return value.slice(0, maximum).flatMap((item) => {
    const current = record(item)
    if (!current) return []
    return [
      {
        id: current.id,
        node_id: current.node_id,
        title: typeof current.title === "string" ? clip(current.title, 200) : undefined,
        disposition: current.disposition,
        status: current.status,
        reason: typeof current.reason === "string" ? clip(current.reason, 300) : undefined,
        session_id: current.session_id,
        report_path: typeof current.report_path === "string" ? clip(current.report_path, 300) : undefined,
        relationship: current.relationship,
        contribution: typeof current.contribution === "string" ? clip(current.contribution, 300) : undefined,
        exclusions: Array.isArray(current.exclusions)
          ? current.exclusions
              .filter((exclusion): exclusion is string => typeof exclusion === "string")
              .slice(0, 4)
              .map((exclusion) => clip(exclusion, 200))
          : [],
      },
    ]
  })
}

function compactSourceProvenance(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return []
  return value.slice(0, maximum).flatMap((item) => {
    const current = record(item)
    if (!current || typeof current.url !== "string") return []
    return [
      {
        url: clip(current.url, 500),
        kind: current.kind,
        verification: current.verification,
        direct_checks: current.direct_checks,
        search_discoveries: current.search_discoveries,
        report_paths: Array.isArray(current.report_paths)
          ? current.report_paths
              .filter((reportPath): reportPath is string => typeof reportPath === "string")
              .slice(0, 8)
              .map((reportPath) => clip(reportPath, 500))
          : [],
      },
    ]
  })
}

function coverageDiagnostics(value: ReadonlyArray<WorkflowSchema.ArtifactCoverage> | undefined) {
  const unaccounted = (value ?? []).filter(
    (item) =>
      !item.received ||
      item.unresolved.some(
        (entry) =>
          entry === "The durable report was unavailable when synthesis started." ||
          entry === "The synthesis did not record how this artifact affected its conclusions.",
      ),
  )
  return {
    coverage_complete: unaccounted.length === 0,
    unaccounted_artifacts: unaccounted.map((item) => ({
      title: item.title,
      report_path: item.report_path,
      unresolved: item.unresolved,
    })),
  }
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
