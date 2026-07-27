export * as WorkflowReport from "./report"

import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { Tool } from "../tool/tool"
import { WorkflowSchema } from "./schema"

export type Artifact = {
  readonly id?: string
  readonly title: string
  readonly reportPath?: string
  readonly kind?: string
  readonly sessionID?: string
  readonly status?: string
}

const DEFAULT_MAX_PROMPT_BYTES = 512 * 1024
const MAX_EVIDENCE_REFERENCES_PER_CLAIM = 5

export async function writeHeavy(objective: string, output: WorkflowSchema.HeavyOutput, reportPath: string) {
  const root = output.nodes.find((node) => node.depth === 0) ?? output.nodes[0]
  const synthesis = await readArtifact(root?.report_path)
  const body = [
    "# Heavy Report",
    "",
    "## Objective",
    "",
    objective,
    "",
    "## Main Document",
    "",
    ...(synthesis
      ? [nestedBody(synthesis, 2), ""]
      : [
          root?.summary || output.summary,
          ...section("Decisions", root?.decisions ?? []),
          ...findings(root?.findings ?? []),
          ...section("Changed Files", root?.changed_files ?? []),
          ...section("Validation", root?.validation ?? []),
          ...section("Risks", root?.risks ?? []),
          ...section("Follow-up", root?.follow_up ?? []),
        ]),
    ...researchArtifacts(
      [
        ...output.nodes
          .filter((node) => node.parent_id === root?.id)
          .map((node) => ({ title: node.title, reportPath: node.report_path })),
        ...(output.council
          ? [
              {
                title: "Council review",
                reportPath: output.council.report_path ?? output.council.synthesis_report_path,
              },
            ]
          : []),
      ],
      reportPath,
    ),
  ].join("\n")
  await write(reportPath, withContents(body))
  await write(heavyTracePath(reportPath), heavyTrace(objective, output, reportPath, root))
}

export async function writeCouncil(question: string, output: WorkflowSchema.CouncilOutput, reportPath: string) {
  const synthesis = await readArtifact(output.synthesis_report_path)
  const body = [
    "# Council Report",
    "",
    "## Question",
    "",
    question,
    "",
    "## Main Document",
    "",
    ...(synthesis
      ? [nestedBody(synthesis, 2), ""]
      : [
          output.summary,
          "",
          ...section("Consensus", output.consensus),
          ...disagreements(output.disagreements),
          ...section("Recommendations", output.recommendations),
          ...section("Risks", output.risks),
        ]),
    ...researchArtifacts(
      [
        ...output.perspectives.map((perspective) => ({
          title: `Perspective: ${perspective.perspective_id}`,
          reportPath: perspective.report_path,
        })),
        ...output.debate.map((contribution) => ({
          title: `Debate: ${contribution.issue_id} — ${contribution.perspective_id}, round ${contribution.round}`,
          reportPath: contribution.report_path,
        })),
        ...(output.delegations ?? []).map((delegation) => ({
          title: `${workflowName(delegation.workflow)}: ${delegation.objective}`,
          reportPath: delegation.report_path,
        })),
      ],
      reportPath,
    ),
  ].join("\n")
  await write(reportPath, withContents(body))
  await write(councilTracePath(reportPath), councilTrace(question, output, reportPath))
}

export async function writeResearch(objective: string, output: WorkflowSchema.ResearchOutput, reportPath: string) {
  const root = output.nodes.find((node) => node.depth === 0) ?? output.nodes[0]
  const artifacts = [
    ...(root?.waves.flatMap((wave) =>
      wave.tasks.map((task) => ({
        title: task.title,
        reportPath: task.report_path,
      })),
    ) ?? []),
    ...output.councils
      .filter((review) => review.node_id === root?.id)
      .map((review) => ({
        title: `Council: ${review.question}`,
        reportPath: review.output.report_path ?? review.output.synthesis_report_path,
      })),
  ]
  const direct = root?.report_path === reportPath && (await Bun.file(reportPath).exists())
  const synthesis = direct ? await Bun.file(reportPath).text() : await readArtifact(root?.report_path)
  const evidenceReferences = researchEvidenceReferences(output.graph, reportPath)
  const body = direct
    ? [
        synthesis?.trimEnd() ?? "",
        ...(synthesis?.includes("\n## Evidence References\n") ? [] : ["", ...evidenceReferences]),
        ...(synthesis?.includes("\n## Research Artifacts\n") ? [] : ["", ...researchArtifacts(artifacts, reportPath)]),
      ].join("\n")
    : [
        "# Research Report",
        "",
        "## Objective",
        "",
        objective,
        "",
        "## Main Document",
        "",
        ...(synthesis
          ? [nestedBody(synthesis, 2), ""]
          : [
              root?.result.summary || output.summary,
              ...section("Conclusions", root?.result.conclusions ?? []),
              ...section("Recommendations", root?.result.recommendations ?? []),
              ...section("Limitations", root?.result.limitations ?? []),
            ]),
        ...evidenceReferences,
        ...researchArtifacts(artifacts, reportPath),
      ].join("\n")
  await write(reportPath, direct ? body : withContents(body))
  await write(researchTracePath(reportPath), researchTrace(objective, output, reportPath, root))
  await writeJSON(researchGraphPath(reportPath), output.graph)
  if (output.raw_graph) await writeJSON(researchRawGraphPath(reportPath), output.raw_graph)
}

export async function writeFailure(
  workflow: "heavy" | "council" | "research",
  objective: string,
  error: string,
  reportPath: string,
  delegated: ReadonlyArray<WorkflowSchema.Delegation> = [],
) {
  await write(
    reportPath,
    [
      `# ${workflowName(workflow)} Report`,
      "",
      "- Status: **failed**",
      `- Report: \`${reportPath}\``,
      "",
      `## ${workflow === "council" ? "Question" : "Objective"}`,
      "",
      objective,
      "",
      "## Failure",
      "",
      error,
      "",
      ...delegations(delegated, reportPath),
    ].join("\n"),
  )
}

export async function collectSources(
  value: unknown,
  reportPaths: ReadonlyArray<string | undefined>,
  sessions: ReadonlyArray<WorkflowSchema.SessionStage> = [],
) {
  return (await collectSourceProvenance(value, reportPaths, sessions)).map((source) => source.url)
}

export async function collectSourceProvenance(
  value: unknown,
  reportPaths: ReadonlyArray<string | undefined>,
  sessions: ReadonlyArray<WorkflowSchema.SessionStage> = [],
) {
  const paths = Array.from(new Set(reportPaths.filter((item): item is string => item !== undefined)))
  const reports = await Promise.all(
    paths.map(async (reportPath) => ({
      reportPath,
      content: (await Bun.file(reportPath).exists()) ? await Bun.file(reportPath).text() : "",
    })),
  )
  const references = new Map<
    string,
    {
      reportPaths: Set<string>
      observed: Set<"verified" | "unverified" | "failed">
      reported: Set<"verified" | "unverified" | "failed">
      directChecks: number
      searchDiscoveries: number
    }
  >(
    extractSources(value).map((url) => [
      url,
      {
        reportPaths: new Set<string>(),
        observed: new Set<"verified" | "unverified" | "failed">(),
        reported: new Set<"verified" | "unverified" | "failed">(),
        directChecks: 0,
        searchDiscoveries: 0,
      },
    ]),
  )
  reports.forEach((report) =>
    sourceOccurrences(report.content).forEach((source) => {
      const reference = references.get(source.url) ?? {
        reportPaths: new Set<string>(),
        observed: new Set<"verified" | "unverified" | "failed">(),
        reported: new Set<"verified" | "unverified" | "failed">(),
        directChecks: 0,
        searchDiscoveries: 0,
      }
      reference.reportPaths.add(report.reportPath)
      reference.reported.add(verification(source.context))
      references.set(source.url, reference)
    }),
  )
  sessions.forEach((session) =>
    session.sources?.forEach((source) => {
      const url = normalizeSourceURL(source.url)
      if (!url) return
      const reference = references.get(url) ?? {
        reportPaths: new Set<string>(),
        observed: new Set<"verified" | "unverified" | "failed">(),
        reported: new Set<"verified" | "unverified" | "failed">(),
        directChecks: 0,
        searchDiscoveries: 0,
      }
      if (!references.has(url) && source.method !== "direct") return
      if (session.report_path) reference.reportPaths.add(session.report_path)
      reference.observed.add(source.verification)
      if (source.method === "direct") reference.directChecks++
      if (source.method === "search") reference.searchDiscoveries++
      references.set(url, reference)
    }),
  )
  return Array.from(references, ([url, reference]) =>
    WorkflowSchema.SourceReference.make({
      url,
      report_paths: [...reference.reportPaths],
      kind: sourceKind(url),
      ...(reference.directChecks > 0 ? { direct_checks: reference.directChecks } : {}),
      ...(reference.searchDiscoveries > 0 ? { search_discoveries: reference.searchDiscoveries } : {}),
      verification: reference.observed.has("verified")
        ? "verified"
        : reference.observed.has("failed")
          ? "failed"
          : reference.observed.has("unverified")
            ? "unverified"
            : sessions.length > 0
              ? "unverified"
              : reference.reported.has("verified")
                ? "verified"
                : reference.reported.has("failed")
                  ? "failed"
                  : "unverified",
    }),
  )
    .sort(
      (left, right) =>
        sourceVerificationRank(left.verification) - sourceVerificationRank(right.verification) ||
        Number((right.direct_checks ?? 0) > 0) - Number((left.direct_checks ?? 0) > 0) ||
        sourceKindRank(left.kind) - sourceKindRank(right.kind) ||
        left.url.localeCompare(right.url),
    )
    .slice(0, 100)
}

export async function readArtifacts(entries: ReadonlyArray<Artifact>) {
  if (entries.length === 0) return "(none)"
  return (
    await Promise.all(
      entries.map(async (entry, index) => {
        if (!entry.reportPath)
          return [
            `--- BEGIN DURABLE REPORT ${index + 1}: ${entry.title} ---`,
            "[No durable report path was produced; use the accompanying bounded result.]",
            `--- END DURABLE REPORT ${index + 1}: ${entry.title} ---`,
          ].join("\n")
        const file = Bun.file(entry.reportPath)
        if (!(await file.exists()))
          return [
            `--- BEGIN DURABLE REPORT ${index + 1}: ${entry.title} ---`,
            `Path: ${entry.reportPath}`,
            "[The durable report is missing; use the accompanying bounded result and preserve this failure.]",
            `--- END DURABLE REPORT ${index + 1}: ${entry.title} ---`,
          ].join("\n")
        return [
          `--- BEGIN DURABLE REPORT ${index + 1}: ${entry.title} ---`,
          `Path: ${entry.reportPath}`,
          await file.text(),
          `--- END DURABLE REPORT ${index + 1}: ${entry.title} ---`,
        ].join("\n")
      }),
    )
  ).join("\n\n")
}

function nestedBody(value: string, parentLevel: number) {
  const state: {
    fence: { readonly character: string; readonly length: number } | undefined
  } = { fence: undefined }
  const initial = value.trim().split(/\r?\n/)
  const leading: number[] = []
  for (let index = 0; index < initial.length; index++) {
    if (!initial[index].trim()) continue
    if (/^ {0,3}#{1,6}[ \t]+/.test(initial[index])) {
      leading.push(index)
      continue
    }
    break
  }
  const collapsed =
    leading.length > 1 ? initial.filter((_line, index) => !leading.slice(0, -1).includes(index)) : initial
  const minimum = markdownHeadings(collapsed.join("\n")).reduce(
    (current, heading) => Math.min(current, heading.level),
    7,
  )
  const shift = minimum > 6 ? 0 : parentLevel + 1 - minimum
  return collapsed
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (marker) {
        const character = marker[1][0]
        if (!state.fence) state.fence = { character, length: marker[1].length }
        else if (state.fence.character === character && marker[1].length >= state.fence.length) state.fence = undefined
        return line
      }
      if (state.fence) return line
      return line.replace(/^( {0,3})(#{1,6})([ \t]+)/, (_match, indent, hashes, spacing) => {
        return `${indent}${"#".repeat(Math.max(1, Math.min(6, hashes.length + shift)))}${spacing}`
      })
    })
    .join("\n")
}

export function prompt(
  stage: string,
  value: string,
  maximum = DEFAULT_MAX_PROMPT_BYTES,
): Effect.Effect<string, Tool.Failure> {
  const bytes = Buffer.byteLength(value, "utf8")
  if (bytes <= maximum) return Effect.succeed(value)
  return Effect.fail(
    new Tool.Failure({
      message: `${stage} prompt requires ${bytes} bytes, exceeding workflows.reports.max_prompt_bytes (${maximum}). No artifact was truncated; reduce fan-in, add a recursive synthesis level, or raise the configured limit.`,
    }),
  )
}

export function health(
  evidenceStatus: WorkflowSchema.Status,
  sessions: ReadonlyArray<WorkflowSchema.SessionStage>,
  coverage: ReadonlyArray<WorkflowSchema.ArtifactCoverage>,
  sources: ReadonlyArray<WorkflowSchema.SourceReference> = [],
) {
  const failures = sessions.filter((session) => session.status !== "completed").length
  const completed = sessions.filter((session) => session.status === "completed").length
  const unaccounted = unaccountedCoverage(coverage)
  const evidenceIncomplete =
    coverage.some((artifact) => artifact.unresolved.length > 0) ||
    sources.some((source) => source.verification !== "verified")
  return {
    execution_status:
      failures === 0 ? ("completed" as const) : completed === 0 ? ("failed" as const) : ("partial" as const),
    artifact_status:
      unaccounted.length === 0
        ? ("available" as const)
        : coverage.some((artifact) => artifact.received)
          ? ("partial" as const)
          : ("missing" as const),
    evidence_status:
      evidenceStatus === "failed"
        ? ("failed" as const)
        : evidenceStatus === "partial" || unaccounted.length > 0 || evidenceIncomplete
          ? ("partial" as const)
          : ("completed" as const),
  }
}

export function unaccountedCoverage(coverage: ReadonlyArray<WorkflowSchema.ArtifactCoverage>) {
  return coverage.filter(
    (artifact) =>
      !artifact.received ||
      artifact.used.length + artifact.rejected.length + artifact.unresolved.length === 0 ||
      artifact.unresolved.some(
        (detail) =>
          detail === "The durable report was unavailable when synthesis started." ||
          detail === "The synthesis did not record how this artifact affected its conclusions." ||
          detail === "The final report author did not read this artifact." ||
          detail === "The final report author did not record how this artifact affected the document.",
      ),
  )
}

export function aggregateUsage(sessions: ReadonlyArray<WorkflowSchema.SessionStage>) {
  const totals = sessions.reduce(
    (current, session) => ({
      input: current.input + (session.usage?.input ?? 0),
      output: current.output + (session.usage?.output ?? 0),
      reasoning: current.reasoning + (session.usage?.reasoning ?? 0),
      cache_read: current.cache_read + (session.usage?.cache_read ?? 0),
      cache_write: current.cache_write + (session.usage?.cache_write ?? 0),
      cost: current.cost + (session.usage?.cost ?? 0),
    }),
    { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost: 0 },
  )
  return WorkflowSchema.Usage.make({
    ...totals,
    cost_status: sessions.some((session) => session.usage === undefined || session.usage.cost_status === "unavailable")
      ? "unavailable"
      : "reported",
    scope: "child_sessions",
  })
}

export async function coverage(
  entries: ReadonlyArray<Artifact>,
  submitted: ReadonlyArray<WorkflowSchema.ArtifactCoverage> = [],
) {
  return Promise.all(
    entries.map(async (entry) => {
      const reported = submitted.filter(
        (item) =>
          (entry.reportPath !== undefined && item.report_path === entry.reportPath) ||
          item.title.trim().toLowerCase() === entry.title.trim().toLowerCase(),
      )
      const received = entry.reportPath !== undefined && (await Bun.file(entry.reportPath).exists())
      return WorkflowSchema.ArtifactCoverage.make({
        title: entry.title,
        report_path: entry.reportPath,
        received,
        used: Array.from(new Set(reported.flatMap((item) => item.used))),
        rejected: Array.from(new Set(reported.flatMap((item) => item.rejected))),
        unresolved: [
          ...Array.from(new Set(reported.flatMap((item) => item.unresolved))),
          ...(!received
            ? ["The durable report was unavailable when synthesis started."]
            : reported.length > 0
              ? []
              : ["The synthesis did not record how this artifact affected its conclusions."]),
        ],
      })
    }),
  )
}

async function write(reportPath: string, body: string) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  await Bun.write(reportPath, `${body.trimEnd()}\n`)
}

async function writeJSON(reportPath: string, value: unknown) {
  await mkdir(path.dirname(reportPath), { recursive: true })
  await Bun.write(reportPath, `${JSON.stringify(value, undefined, 2)}\n`)
}

export async function readArtifact(reportPath: string | undefined) {
  if (!reportPath || !(await Bun.file(reportPath).exists())) return undefined
  return nestedBody((await Bun.file(reportPath).text()).replace(/^# [^\r\n]+\r?\n+/, ""), 0)
}

function section(title: string, values: ReadonlyArray<string>, level = 2) {
  if (values.length === 0) return []
  return [`${"#".repeat(level)} ${title}`, "", ...values.map((value) => `- ${value}`), ""]
}

function usageSection(value: WorkflowSchema.Usage | undefined) {
  if (!value) return []
  return [
    `- Tokens: input ${value.input}, output ${value.output}, reasoning ${value.reasoning}, cache read ${value.cache_read}, cache write ${value.cache_write}`,
    `- Cost: ${value.cost_status === "reported" ? value.cost : "unavailable"}`,
    ...(value.scope === "child_sessions"
      ? ["- Usage scope: child workflow sessions; parent entrypoint turns excluded"]
      : []),
  ]
}

function timingSection(value: WorkflowSchema.RunTiming | undefined) {
  if (!value) return []
  return [
    `- Started: ${new Date(value.started_at).toISOString()}`,
    `- Completed: ${new Date(value.completed_at).toISOString()}`,
    `- Elapsed: ${value.elapsed_ms} ms`,
  ]
}

function findings(values: ReadonlyArray<WorkflowSchema.Finding>, level = 2) {
  if (values.length === 0) return []
  return [
    `${"#".repeat(level)} Findings`,
    "",
    ...values.flatMap((finding) => [
      `- ${finding.claim}`,
      ...finding.evidence.map((evidence) => `  - Evidence: ${evidence}`),
    ]),
    "",
  ]
}

function researchArtifacts(values: ReadonlyArray<Artifact>, reportPath: string) {
  const artifacts = values
    .filter((artifact): artifact is Artifact & { readonly reportPath: string } => artifact.reportPath !== undefined)
    .filter(
      (artifact, index, all) => all.findIndex((candidate) => candidate.reportPath === artifact.reportPath) === index,
    )
  if (artifacts.length === 0) return []
  return [
    "## Research Artifacts",
    "",
    "The main document incorporates the material conclusions from these supporting analyses. They are linked for audit and optional deeper reading.",
    "",
    ...artifacts.map((artifact) => `- [${artifact.title}](${relative(reportPath, artifact.reportPath)})`),
    "",
  ]
}

function researchEvidenceReferences(graph: WorkflowSchema.ResearchGraph, reportPath: string) {
  if (graph.claims.length === 0 && graph.evidence.length === 0) return []
  const references = graph.evidence
    .filter(
      (evidence) =>
        evidence.url !== undefined ||
        evidence.report_path === undefined ||
        path.resolve(evidence.report_path) !== path.resolve(reportPath),
    )
    .reduce<
      Array<{
        readonly key: string
        readonly evidence: Array<WorkflowSchema.ResearchEvidence>
      }>
    >((current, evidence) => {
      const key = evidence.url
        ? `url:${canonicalSourceURL(evidence.url)}`
        : evidence.report_path
          ? `report:${path.resolve(evidence.report_path)}`
          : evidence.id
      const existing = current.find((reference) => reference.key === key)
      if (existing) {
        existing.evidence.push(evidence)
        return current
      }
      current.push({ key, evidence: [evidence] })
      return current
    }, [])
  const referenceByEvidenceID = new Map(
    references.flatMap((reference) => reference.evidence.map((evidence) => [evidence.id, reference] as const)),
  )
  const selectedByClaim = graph.claims.map((claim) => {
    const candidates = claim.evidence_ids
      .flatMap((evidenceID) => {
        const reference = referenceByEvidenceID.get(evidenceID)
        return reference ? [reference] : []
      })
      .filter((reference, index, all) => all.findIndex((candidate) => candidate.key === reference.key) === index)
      .sort((left, right) => evidenceReferenceRank(left, claim) - evidenceReferenceRank(right, claim))
    if (claim.status !== "contested") return candidates.slice(0, MAX_EVIDENCE_REFERENCES_PER_CLAIM)
    const mandatory = [candidates.find(hasSupportingEvidence), candidates.find(hasChallengingEvidence)].filter(
      (reference): reference is (typeof candidates)[number] => reference !== undefined,
    )
    return [...mandatory, ...candidates.filter((reference) => !mandatory.includes(reference))]
      .filter((reference, index, all) => all.indexOf(reference) === index)
      .slice(0, MAX_EVIDENCE_REFERENCES_PER_CLAIM)
  })
  const selected = selectedByClaim
    .flat()
    .filter((reference, index, all) => all.findIndex((candidate) => candidate.key === reference.key) === index)
  const codeByReference = new Map(selected.map((reference, index) => [reference.key, `E${index + 1}`]))
  return [
    "## Evidence References",
    "",
    `This compact appendix maps each canonical claim to at most ${MAX_EVIDENCE_REFERENCES_PER_CLAIM} decisive references. The exhaustive evidence ledger remains available in [${path.basename(researchGraphPath(reportPath))}](${path.basename(researchGraphPath(reportPath))}) and the full audit trail in [${path.basename(researchTracePath(reportPath))}](${path.basename(researchTracePath(reportPath))}).`,
    "",
    "### Claim Map",
    "",
    ...graph.claims.flatMap((claim, index) => {
      const evidence = selectedByClaim[index].flatMap((reference) => {
        const code = codeByReference.get(reference.key)
        return code ? [code] : []
      })
      return [
        `- **C${index + 1}** — ${inline(claim.statement)} _(${claim.status}; ${claim.confidence} confidence)_`,
        `  - Evidence: ${evidence.length > 0 ? evidence.join(", ") : "none retained"}`,
      ]
    }),
    "",
    "### Evidence Index",
    "",
    ...(selected.length > 0
      ? selected.flatMap((reference, index) => {
          const claims = graph.claims.flatMap((_claim, claimIndex) =>
            selectedByClaim[claimIndex].includes(reference) ? [`C${claimIndex + 1}`] : [],
          )
          const ranked = [...reference.evidence].sort(
            (left, right) => evidenceRank(left) - evidenceRank(right) || left.id.localeCompare(right.id),
          )
          const first = ranked[0]
          const target = first.url
            ? `<${first.url}>`
            : first.report_path
              ? `[supporting report](${relative(reportPath, first.report_path)})`
              : "workflow-retained evidence"
          return [
            `- **E${index + 1}** — ${inline(first.summary)}${reference.evidence.length > 1 ? ` _(+${reference.evidence.length - 1} related record${reference.evidence.length === 2 ? "" : "s"})_` : ""} — ${target}`,
            `  - Supports: ${claims.length > 0 ? claims.join(", ") : "context only"}`,
            `  - Provenance: ${Array.from(new Set(reference.evidence.map((evidence) => evidence.source_type))).join(", ")}; ${Array.from(new Set(reference.evidence.map((evidence) => evidence.verification))).join(", ")}`,
            ...(first.limitation ? [`  - Limitation: ${inline(first.limitation)}`] : []),
          ]
        })
      : ["No evidence records were retained."]),
    "",
  ]
}

function evidenceReferenceRank(
  reference: {
    readonly evidence: ReadonlyArray<WorkflowSchema.ResearchEvidence>
  },
  claim: WorkflowSchema.ResearchClaim,
) {
  const evidence = [...reference.evidence].sort(
    (left, right) => evidenceRank(left, claim) - evidenceRank(right, claim) || left.id.localeCompare(right.id),
  )[0]
  return evidenceRank(evidence, claim)
}

function evidenceRank(evidence: WorkflowSchema.ResearchEvidence, claim?: WorkflowSchema.ResearchClaim) {
  const stance =
    claim?.status === "contested"
      ? evidence.stance === "context"
        ? 1
        : 0
      : evidence.stance === "support"
        ? 0
        : evidence.stance === "context"
          ? 1
          : 2
  const verification =
    evidence.verification === "verified"
      ? 0
      : evidence.verification === "not_applicable"
        ? 1
        : evidence.verification === "unverified"
          ? 2
          : 3
  const source =
    evidence.source_type === "primary"
      ? 0
      : evidence.source_type === "calculation"
        ? 1
        : evidence.source_type === "observation"
          ? 2
          : evidence.source_type === "artifact"
            ? 3
            : evidence.source_type === "secondary"
              ? 4
              : 5
  return stance * 100 + verification * 10 + source
}

function hasChallengingEvidence(reference: { readonly evidence: ReadonlyArray<WorkflowSchema.ResearchEvidence> }) {
  return reference.evidence.some((evidence) => evidence.stance === "challenge")
}

function hasSupportingEvidence(reference: { readonly evidence: ReadonlyArray<WorkflowSchema.ResearchEvidence> }) {
  return reference.evidence.some((evidence) => evidence.stance === "support")
}

function canonicalSourceURL(value: string) {
  if (!URL.canParse(value)) return value
  const url = new URL(value)
  url.hash = ""
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "")
  return url.href
}

function disagreements(values: WorkflowSchema.CouncilOutput["disagreements"]) {
  if (values.length === 0) return []
  return [
    "## Disagreements and Minority Positions",
    "",
    ...values.flatMap((item) => [`### ${item.question}`, "", ...item.positions.map((position) => `- ${position}`), ""]),
  ]
}

function delegations(values: ReadonlyArray<WorkflowSchema.Delegation>, reportPath: string) {
  return [
    "## Delegated Workflows",
    "",
    ...(values.length
      ? values.flatMap((delegation) => [
          `### ${workflowName(delegation.workflow)}: ${delegation.objective}`,
          "",
          `- Status: **${delegation.status}**`,
          ...(delegation.execution_status ? [`- Execution: **${delegation.execution_status}**`] : []),
          ...(delegation.artifact_status ? [`- Artifacts: **${delegation.artifact_status}**`] : []),
          ...(delegation.evidence_status ? [`- Evidence: **${delegation.evidence_status}**`] : []),
          ...(delegation.timing ? [`- Elapsed: ${delegation.timing.elapsed_ms} ms`] : []),
          `- Depth: ${delegation.depth}`,
          `- Root session: \`${delegation.root_session_id}\``,
          `- Parent session: \`${delegation.parent_session_id}\``,
          ...(delegation.session_ids?.length
            ? [`- Sessions: ${delegation.session_ids.map((sessionID) => `\`${sessionID}\``).join(", ")}`]
            : []),
          `- Report: [${path.basename(delegation.report_path)}](${relative(reportPath, delegation.report_path)})`,
          "",
          delegation.summary,
          "",
        ])
      : ["None.", ""]),
  ]
}

function heavyTrace(
  objective: string,
  output: WorkflowSchema.HeavyOutput,
  reportPath: string,
  root: WorkflowSchema.HeavyNode | undefined,
) {
  return [
    "# Heavy Trace",
    "",
    `- Status: **${output.status}**`,
    `- Execution: **${output.execution_status ?? output.status}**`,
    `- Artifacts: **${output.artifact_status ?? "available"}**`,
    `- Evidence: **${output.evidence_status ?? output.status}**`,
    `- Root session: \`${output.root_session_id}\``,
    `- Deliverable: [${path.basename(reportPath)}](${path.basename(reportPath)})`,
    ...timingSection(output.timing),
    ...usageSection(output.usage),
    "",
    "## Objective",
    "",
    objective,
    "",
    ...planSection(root?.plan ?? []),
    ...councilRoutingSection(output.nodes),
    ...coverageSection(root?.coverage ?? []),
    ...delegations(output.delegations ?? [], reportPath),
    "## Child Report Index",
    "",
    ...output.nodes
      .filter((node) => node !== root)
      .flatMap((node) => [
        `### ${node.title}`,
        "",
        `- Status: **${node.status}**`,
        `- Depth: ${node.depth}`,
        `- Session: \`${node.session_id}\``,
        ...(node.planning_session_id ? [`- Planning session: \`${node.planning_session_id}\``] : []),
        `- Capability: ${node.capability}`,
        ...(node.report_path
          ? [`- Report: [${path.basename(node.report_path)}](${relative(reportPath, node.report_path)})`]
          : []),
        "",
        node.summary,
        ...planSection(node.plan ?? [], 4),
        ...(node.report_path
          ? [""]
          : [
              ...section("Decisions", node.decisions, 4),
              ...findings(node.findings, 4),
              ...section("Changed Files", node.changed_files, 4),
              ...section("Validation", node.validation, 4),
              ...section("Risks", node.risks, 4),
              ...section("Follow-up", node.follow_up, 4),
            ]),
      ]),
    ...sources(output),
  ].join("\n")
}

function councilTrace(question: string, output: WorkflowSchema.CouncilOutput, reportPath: string) {
  return [
    "# Council Trace",
    "",
    `- Status: **${output.status}**`,
    `- Execution: **${output.execution_status ?? output.status}**`,
    `- Artifacts: **${output.artifact_status ?? "available"}**`,
    `- Evidence: **${output.evidence_status ?? output.status}**`,
    `- Root session: \`${output.root_session_id}\``,
    `- Synthesis session: \`${output.synthesis_session_id}\``,
    `- Deliverable: [${path.basename(reportPath)}](${path.basename(reportPath)})`,
    ...timingSection(output.timing),
    ...usageSection(output.usage),
    "",
    "## Question",
    "",
    question,
    "",
    ...section("Consensus", output.consensus),
    ...disagreements(output.disagreements),
    ...section("Recommendations", output.recommendations),
    ...section("Risks", output.risks),
    ...coverageSection(output.coverage ?? []),
    ...delegations(output.delegations ?? [], reportPath),
    "## Perspective Reports",
    "",
    ...output.perspectives.flatMap((perspective) => [
      `### ${perspective.perspective_id}`,
      "",
      `- Session: \`${perspective.session_id}\``,
      ...(perspective.report_path
        ? [`- Report: [${path.basename(perspective.report_path)}](${relative(reportPath, perspective.report_path)})`]
        : []),
      "",
      perspective.summary,
      "",
      ...perspective.issues.map((issue) => `- ${issue.question}: **${issue.stance}**`),
      "",
    ]),
    "## Debate",
    "",
    ...(output.debate.length
      ? output.debate.flatMap((contribution) => [
          `### ${contribution.issue_id} — ${contribution.perspective_id}, round ${contribution.round}`,
          "",
          `- Stance: **${contribution.stance}**`,
          `- Session: \`${contribution.session_id}\``,
          ...(contribution.report_path
            ? [
                `- Report: [${path.basename(contribution.report_path)}](${relative(reportPath, contribution.report_path)})`,
              ]
            : []),
          "",
          ...(contribution.report_path
            ? []
            : [
                contribution.argument,
                ...section("Concessions", contribution.concessions, 4),
                ...section("Rebuttals", contribution.rebuttals, 4),
                ...section("Evidence", contribution.evidence, 4),
              ]),
        ])
      : ["No debate was run.", ""]),
    ...sources(output),
  ].join("\n")
}

function researchTrace(
  objective: string,
  output: WorkflowSchema.ResearchOutput,
  reportPath: string,
  root: WorkflowSchema.ResearchNode | undefined,
) {
  return [
    "# Research Trace",
    "",
    `- Status: **${output.status}**`,
    `- Execution: **${output.execution_status ?? output.status}**`,
    `- Artifacts: **${output.artifact_status ?? "available"}**`,
    `- Evidence: **${output.evidence_status ?? output.status}**`,
    `- Root session: \`${output.root_session_id}\``,
    `- Deliverable: [${path.basename(reportPath)}](${path.basename(reportPath)})`,
    `- Claim graph: [${path.basename(researchGraphPath(reportPath))}](${path.basename(researchGraphPath(reportPath))})`,
    ...(output.raw_graph
      ? [
          `- Raw evidence ledger: [${path.basename(researchRawGraphPath(reportPath))}](${path.basename(researchRawGraphPath(reportPath))})`,
        ]
      : []),
    ...timingSection(output.timing),
    ...usageSection(output.usage),
    "",
    "## Objective",
    "",
    objective,
    "",
    ...(root
      ? [
          "## Research Contract",
          "",
          root.contract.rationale,
          "",
          ...section("Deliverables", root.contract.deliverables, 3),
          ...section("Starting Assumptions", root.contract.assumptions, 3),
          ...section("Starting Unknowns", root.contract.unknowns, 3),
          ...section("Falsifiers", root.contract.falsifiers, 3),
        ]
      : []),
    "## Adaptive Waves",
    "",
    ...(root?.waves.length
      ? root.waves.flatMap((wave) => [
          `### Wave ${wave.number}`,
          "",
          `- Coverage: **${wave.assessment.coverage}**`,
          `- Projected information gain: **${wave.assessment.information_gain}**`,
          `- Decision: **${wave.assessment.decision}**`,
          ...(wave.stop_code ? [`- Stop code: **${wave.stop_code}**`] : []),
          `- Rationale: ${wave.assessment.rationale}`,
          ...(wave.stop_reason ? [`- Stop reason: ${wave.stop_reason}`] : []),
          ...(wave.assessment.deferred_validations?.length
            ? ["- Deferred validations:", ...wave.assessment.deferred_validations.map((item) => `  - ${item}`)]
            : []),
          "",
          ...wave.tasks.flatMap((task) => [
            `- **${task.title}** — ${task.status}; ${task.priority}; ${task.role}${task.reused ? "; reused" : ""}`,
            `  - Question: ${task.question}`,
            ...(task.reserved_subtree_slots
              ? [`  - Reserved subtree evidence slots: ${task.reserved_subtree_slots}`]
              : []),
            ...(task.depends_on?.length
              ? [`  - Depends on: ${task.depends_on.map((id) => `\`${id}\``).join(", ")}`]
              : []),
            `  - Session: \`${task.session_id}\``,
            ...(task.artifact_id ? [`  - Artifact: \`${task.artifact_id}\``] : []),
            ...(task.report_path
              ? [`  - Report: [${path.basename(task.report_path)}](${relative(reportPath, task.report_path)})`]
              : []),
          ]),
          "",
        ])
      : ["No evidence wave completed.", ""]),
    "## Claim Graph Summary",
    "",
    `- Claims: ${output.graph.claims.length}`,
    `- Evidence records: ${output.graph.evidence.length}`,
    `- Open gaps: ${output.graph.gaps.filter((gap) => gap.status === "open").length}`,
    `- Contested claims: ${output.graph.claims.filter((claim) => claim.status === "contested").length}`,
    `- Disputes: ${output.graph.disputes.length}`,
    "",
    ...researchClaims(output.graph.claims),
    ...researchEvidence(output.graph.evidence),
    ...researchGaps(output.graph.gaps),
    ...researchDisputes(output.graph.disputes, reportPath),
    "## Deterministic Evaluation",
    "",
    `- Standalone report check: **${output.evaluation.standalone_pass ? "pass" : "partial"}**`,
    `- Report: ${output.evaluation.report_words} words across ${output.evaluation.report_sections} sections`,
    `- Supported claims with complete evidence links: ${output.evaluation.traceable_supported_claims}/${output.evaluation.supported_claims}`,
    `- Evidence records: ${output.evaluation.evidence_records}; verified sources: ${output.evaluation.verified_sources}`,
    `- Open critical gaps: ${output.evaluation.open_critical_gaps}`,
    `- Consequential disputes: ${output.evaluation.consequential_disputes}; Council reviews: ${output.evaluation.council_reviews}`,
    `- Scheduled Research tasks: ${output.evaluation.evidence_tasks}; reused artifacts: ${output.evaluation.reused_artifacts}`,
    `- Direct evidence leaves: ${output.evaluation.evidence_leaves ?? 0}; artifact-bound critics: ${output.evaluation.critic_tasks ?? 0}`,
    `- Recursive branches: ${output.evaluation.recursive_branches ?? 0}; productive: ${output.evaluation.productive_recursive_branches ?? 0}; synthesis-only: ${output.evaluation.synthesis_only_branches ?? 0}`,
    `- Branch syntheses: ${output.evaluation.branch_syntheses ?? 0}; maximum branch depth: ${output.evaluation.max_branch_depth ?? 0}; maximum direct-evidence depth: ${output.evaluation.max_evidence_depth ?? 0}`,
    `- Root evidence-task budget: ${output.evaluation.root_budget_slots ?? 0}; unused: ${output.evaluation.root_unused_slots ?? 0}`,
    `- Dependency-aware tasks: ${output.evaluation.dependent_tasks ?? 0}`,
    `- Artifact coverage complete: **${output.evaluation.coverage_complete ? "yes" : "no"}**`,
    ...(output.evaluation.deliverables_total === undefined
      ? []
      : [
          `- Contract deliverables: ${output.evaluation.deliverables_complete}/${output.evaluation.deliverables_total} complete; ${output.evaluation.deliverables_partial} partial; ${output.evaluation.deliverables_missing} missing`,
        ]),
    `- Child sessions: ${output.evaluation.total_sessions ?? 0}; failed or timed out: ${output.evaluation.failed_sessions ?? 0}; delegated workflows: ${output.evaluation.delegated_workflows ?? 0}`,
    `- Council sessions: ${output.evaluation.council_sessions ?? 0}; invocations: ${output.evaluation.council_invocations ?? 0}; nested invocations: ${output.evaluation.nested_council_invocations ?? 0}`,
    `- Tool calls: ${output.evaluation.tool_calls ?? 0}; tool errors: ${output.evaluation.tool_errors ?? 0}`,
    `- Cited sources: ${output.evaluation.cited_sources ?? 0}; verified: ${output.evaluation.verified_citations ?? 0}; unverified or failed: ${output.evaluation.unverified_citations ?? 0}`,
    ...(output.evaluation.roles?.length
      ? [
          "- Per-role operations:",
          ...output.evaluation.roles.map(
            (role) =>
              `  - ${role.agent}: ${role.sessions} session(s), ${role.failed_sessions} failed/timed out, ${role.tool_calls} tool call(s), ${role.tool_errors} tool error(s), ${role.usage.input} input / ${role.usage.output} output tokens`,
          ),
        ]
      : []),
    "",
    "## Hierarchical Branches",
    "",
    ...(output.nodes.length > 1
      ? output.nodes
          .filter((node) => node !== root)
          .flatMap((node) => [
            `### ${node.title}`,
            "",
            `- Status: **${node.result.status}**`,
            `- Depth: ${node.depth}`,
            `- Evidence-task budget: ${node.budget_allocated ?? 0} allocated; ${node.budget_unused ?? 0} unused`,
            `- Planning session: \`${node.planning_session_id}\``,
            `- Synthesis session: \`${node.synthesis_session_id}\``,
            `- Synthesis status: **${node.synthesis_status ?? "completed"}**`,
            ...(node.report_path
              ? [`- Report: [${path.basename(node.report_path)}](${relative(reportPath, node.report_path)})`]
              : []),
            "",
            node.result.summary,
            "",
          ])
      : ["No recursive branch synthesis was required.", ""]),
    "## Council Reviews",
    "",
    ...(output.councils.length
      ? output.councils.flatMap((review) => [
          `### ${review.question}`,
          "",
          `- Dispute${(review.dispute_ids?.length ?? 1) === 1 ? "" : "s"}: ${(review.dispute_ids ?? [review.dispute_id]).map((disputeID) => `\`${disputeID}\``).join(", ")}`,
          ...(review.profile ? [`- Deliberation profile: **${review.profile}**`] : []),
          `- Status: **${review.output.status}**`,
          ...(review.output.report_path
            ? [
                `- Report: [${path.basename(review.output.report_path)}](${relative(reportPath, review.output.report_path)})`,
              ]
            : []),
          "",
          review.output.summary,
          "",
        ])
      : ["No dispute crossed the configured Council threshold.", ""]),
    ...coverageSection(root?.result.coverage ?? []),
    ...delegations(output.delegations ?? [], reportPath),
    ...sources(output),
  ].join("\n")
}

function heavyTracePath(reportPath: string) {
  return path.join(path.dirname(reportPath), "HEAVY_TRACE.md")
}

function councilTracePath(reportPath: string) {
  return path.join(path.dirname(reportPath), "COUNCIL_TRACE.md")
}

export function researchTracePath(reportPath: string) {
  return path.join(path.dirname(reportPath), "RESEARCH_TRACE.md")
}

export function researchGraphPath(reportPath: string) {
  return path.join(path.dirname(reportPath), "RESEARCH_GRAPH.json")
}

export function researchRawGraphPath(reportPath: string) {
  return path.join(path.dirname(reportPath), "RESEARCH_RAW_GRAPH.json")
}

function coverageSection(values: ReadonlyArray<WorkflowSchema.ArtifactCoverage>) {
  if (values.length === 0) return []
  const unaccounted = unaccountedCoverage(values)
  return [
    "## Artifact Coverage",
    "",
    `- Complete: **${unaccounted.length === 0 ? "yes" : "no"}**`,
    `- Unaccounted artifacts: ${unaccounted.length}`,
    "",
    ...values.flatMap((item) => [
      `### ${item.title}`,
      "",
      `- Received: **${item.received ? "yes" : "no"}**`,
      ...(item.report_path ? [`- Report: \`${item.report_path}\``] : []),
      ...item.used.map((value) => `- Used: ${value}`),
      ...item.rejected.map((value) => `- Rejected: ${value}`),
      ...item.unresolved.map((value) => `- Unresolved: ${value}`),
      "",
    ]),
  ]
}

function planSection(values: ReadonlyArray<WorkflowSchema.HeavyPlanTaskRecord>, level = 2) {
  if (values.length === 0) return []
  return [
    `${"#".repeat(level)} Plan Reconciliation`,
    "",
    ...values.flatMap((task) => [
      `- **${task.title}** — ${task.disposition}${task.status ? ` (${task.status})` : ""}`,
      ...(task.node_id ? [`  - Node: \`${task.node_id}\``] : []),
      ...(task.session_id ? [`  - Session: \`${task.session_id}\``] : []),
      ...(task.report_path ? [`  - Report: \`${task.report_path}\``] : []),
      ...(task.relationship ? [`  - Relationship: ${task.relationship}`] : []),
      ...(task.contribution ? [`  - Unique contribution: ${task.contribution}`] : []),
      ...(task.exclusions?.map((exclusion) => `  - Excludes: ${exclusion}`) ?? []),
      ...(task.reason ? [`  - Reason: ${task.reason}`] : []),
    ]),
    "",
  ]
}

function councilRoutingSection(nodes: ReadonlyArray<WorkflowSchema.HeavyNode>) {
  const routed = nodes.filter((node) => node.council_routing)
  if (routed.length === 0) return []
  return [
    "## Council Routing",
    "",
    ...routed.flatMap((node) => [
      `### ${node.title}`,
      "",
      `- Mode: ${node.council_routing!.mode}`,
      `- Outcome: **${node.council_routing!.outcome}**`,
      `- Reason: ${node.council_routing!.reason}`,
      ...(node.council_routing!.question ? [`- Debate question: ${node.council_routing!.question}`] : []),
      ...(node.council_routing!.signals.length ? [`- Signals: ${node.council_routing!.signals.join(", ")}`] : []),
      "",
    ]),
  ]
}

function withContents(body: string) {
  const headings = markdownHeadings(body).filter(
    (heading) => heading.level >= 2 && heading.level <= 3 && heading.title !== "Contents",
  )
  if (headings.length === 0) return body
  const contents = [
    "## Contents",
    "",
    ...headings.map((heading) => `${heading.level === 3 ? "  " : ""}- [${heading.title}](#${heading.anchor})`),
    "",
  ].join("\n")
  const marker = "\n## Main Document"
  const index = body.indexOf(marker)
  if (index < 0) return `${contents}\n${body}`
  return `${body.slice(0, index)}\n\n${contents}${body.slice(index)}`
}

function markdownHeadings(value: string) {
  const counts = new Map<string, number>()
  const state: {
    fence: { readonly character: string; readonly length: number } | undefined
  } = { fence: undefined }
  return value.split(/\r?\n/).flatMap((line) => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      const character = fence[1][0]
      if (!state.fence) state.fence = { character, length: fence[1].length }
      else if (state.fence.character === character && fence[1].length >= state.fence.length) state.fence = undefined
      return []
    }
    if (state.fence) return []
    const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/)
    if (!heading) return []
    const title = heading[2].replace(/[`*_~]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    const base = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    return [{ level: heading[1].length, title, anchor: count === 0 ? base : `${base}-${count}` }]
  })
}

function sources(output: WorkflowSchema.HeavyOutput | WorkflowSchema.CouncilOutput | WorkflowSchema.ResearchOutput) {
  const references =
    output.source_provenance ??
    extractSources(output).map((url) =>
      WorkflowSchema.SourceReference.make({
        url,
        report_paths: [],
        kind: sourceKind(url),
        verification: "unverified",
      }),
    )
  if (references.length === 0) return []
  const groups = [
    {
      title: "Verified primary sources",
      values: references.filter((source) => source.verification === "verified" && source.kind === "primary"),
    },
    {
      title: "Verified secondary sources",
      values: references.filter((source) => source.verification === "verified" && source.kind !== "primary"),
    },
    {
      title: "Unverified sources",
      values: references.filter((source) => source.verification === "unverified"),
    },
    {
      title: "Failed source checks",
      values: references.filter((source) => source.verification === "failed"),
    },
  ]
  return [
    "## Sources",
    "",
    ...groups.flatMap((group) =>
      group.values.length
        ? [
            `### ${group.title}`,
            "",
            ...group.values.map(
              (source) =>
                `- ${source.url}${source.direct_checks ? ` — ${source.direct_checks} direct check${source.direct_checks === 1 ? "" : "s"}` : ""}${source.search_discoveries ? `; ${source.search_discoveries} search discover${source.search_discoveries === 1 ? "y" : "ies"}` : ""}${source.report_paths.length ? `; referenced by ${source.report_paths.length} report${source.report_paths.length === 1 ? "" : "s"}` : ""}`,
            ),
            "",
          ]
        : [],
    ),
  ]
}

function researchClaims(values: ReadonlyArray<WorkflowSchema.ResearchClaim>) {
  if (values.length === 0) return []
  return [
    "### Claims",
    "",
    ...values.flatMap((claim) => [
      `- **${claim.id}** — ${claim.statement}`,
      `  - Kind: ${claim.kind}; status: ${claim.status}; confidence: ${claim.confidence}`,
      ...(claim.evidence_ids.length ? [`  - Evidence: ${claim.evidence_ids.join(", ")}`] : []),
      ...(claim.contradicts.length ? [`  - Contradicts: ${claim.contradicts.join(", ")}`] : []),
      ...claim.assumptions.map((assumption) => `  - Assumption: ${assumption}`),
    ]),
    "",
  ]
}

function researchEvidence(values: ReadonlyArray<WorkflowSchema.ResearchEvidence>) {
  if (values.length === 0) return []
  return [
    "### Evidence Ledger",
    "",
    ...values.flatMap((evidence) => [
      `- **${evidence.id}** — ${evidence.summary}`,
      `  - Stance: ${evidence.stance}; type: ${evidence.source_type}; verification: ${evidence.verification}`,
      ...(evidence.claim_ids.length ? [`  - Claims: ${evidence.claim_ids.join(", ")}`] : []),
      ...(evidence.url ? [`  - Source: ${evidence.url}`] : []),
      ...(evidence.published_at ? [`  - Published: ${evidence.published_at}`] : []),
      ...(evidence.checked_at ? [`  - Checked: ${evidence.checked_at}`] : []),
      ...(evidence.limitation ? [`  - Limitation: ${evidence.limitation}`] : []),
    ]),
    "",
  ]
}

function researchGaps(values: ReadonlyArray<WorkflowSchema.ResearchGap>) {
  if (values.length === 0) return []
  return [
    "### Gaps",
    "",
    ...values.map((gap) => `- **${gap.id}** — ${gap.question} (${gap.priority}; ${gap.status}): ${gap.reason}`),
    "",
  ]
}

function researchDisputes(values: ReadonlyArray<WorkflowSchema.ResearchDispute>, reportPath: string) {
  if (values.length === 0) return []
  return [
    "### Disputes",
    "",
    ...values.flatMap((dispute) => [
      `- **${dispute.id}** — ${dispute.question}`,
      `  - Priority: ${dispute.priority}; consequential: ${dispute.consequential ? "yes" : "no"}; status: ${dispute.status}`,
      `  - Reason: ${dispute.reason}`,
      ...(dispute.claim_ids.length ? [`  - Claims: ${dispute.claim_ids.join(", ")}`] : []),
      ...(dispute.resolution ? [`  - Resolution: ${dispute.resolution}`] : []),
      ...(dispute.council_report_path
        ? [
            `  - Council report: [${path.basename(dispute.council_report_path)}](${relative(reportPath, dispute.council_report_path)})`,
          ]
        : []),
    ]),
    "",
  ]
}

function workflowName(workflow: "heavy" | "council" | "research") {
  if (workflow === "heavy") return "Heavy"
  if (workflow === "council") return "Council"
  return "Research"
}

function relative(from: string, to: string) {
  return path.relative(path.dirname(from), to).replaceAll(path.sep, "/")
}

export function extractSources(value: unknown) {
  return Array.from(
    new Set(textValues(value).flatMap((text) => sourceOccurrences(text).map((source) => source.url))),
  ).slice(0, 100)
}

function sourceOccurrences(value: string) {
  return Array.from(value.matchAll(/https?:\/\/[^\s<>"'`()\\\u2013\u2014]+/gu)).flatMap((match) => {
    const candidate = normalizeSourceURL(match[0])
    if (!candidate) return []
    const index = match.index ?? 0
    return [
      {
        url: candidate,
        context: value.slice(Math.max(0, index - 120), Math.min(value.length, index + candidate.length + 120)),
      },
    ]
  })
}

function normalizeSourceURL(value: string): string | undefined {
  const candidate = value.trim().replace(/[.,;:!?\]}]+$/g, "")
  if (!URL.canParse(candidate)) return undefined
  const url = new URL(candidate)
  if (!/^(https?:)$/.test(url.protocol)) return undefined
  if (url.hostname === "..." || url.hostname.includes("…")) return undefined
  return url.href
}

function verification(context: string): "verified" | "unverified" | "failed" {
  if (
    /(?:failed|unable|could not|error).{0,40}(?:fetch|open|verify|access)|(?:fetch|open|verify|access).{0,40}(?:failed|error)/i.test(
      context,
    )
  )
    return "failed"
  if (/(?:unverified|not verified|not directly inspected|not checked|uncorroborated)/i.test(context))
    return "unverified"
  if (/(?:verified|successfully fetched|directly inspected|retrieved successfully|opened successfully)/i.test(context))
    return "verified"
  return "unverified"
}

function sourceKind(value: string): "primary" | "secondary" | "unknown" {
  const host = new URL(value).hostname.replace(/^www\./, "")
  if (
    ["rfc-editor.org", "ietf.org", "w3.org", "whatwg.org", "tc39.es"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    ) ||
    host.startsWith("docs.") ||
    host.endsWith(".gov")
  )
    return "primary"
  if (host) return "secondary"
  return "unknown"
}

function sourceVerificationRank(value: WorkflowSchema.SourceReference["verification"]) {
  if (value === "verified") return 0
  if (value === "unverified") return 1
  if (value === "failed") return 2
  return 3
}

function sourceKindRank(value: WorkflowSchema.SourceReference["kind"]) {
  if (value === "primary") return 0
  if (value === "secondary") return 1
  return 2
}

function inline(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function textValues(value: unknown): ReadonlyArray<string> {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(textValues)
  if (!value || typeof value !== "object") return []
  return Object.values(value).flatMap(textValues)
}
