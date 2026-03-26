import fs from "fs/promises"
import path from "path"
import { Flag } from "@/flag/flag"
import { PlanArtifact, type PlanArtifactInfo } from "./plan-schema"
import { hasConfirmation } from "./plan-guard"

function lines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function pickSection(list: string[], match: RegExp) {
  const start = list.findIndex((line) => /^#{1,6}\s+/.test(line) && match.test(line.toLowerCase()))
  if (start < 0) return [] as string[]
  const out = [] as string[]
  for (let idx = start + 1; idx < list.length; idx++) {
    const line = list[idx]
    if (/^#{1,6}\s+/.test(line)) break
    if (/^(-|\*|\d+\.)\s+/.test(line)) {
      out.push(line.replace(/^(-|\*|\d+\.)\s+/, ""))
      continue
    }
    if (out.length === 0 && line) out.push(line)
  }
  return out
}

function score(item: Omit<PlanArtifactInfo, "metadata">) {
  const checks = [
    item.objective.length > 0,
    item.in_scope.length > 0,
    item.constraints.length > 0,
    item.acceptance_criteria.length > 0,
    item.steps.length > 0,
  ]
  const total = checks.filter(Boolean).length
  return Number((total / checks.length).toFixed(2))
}

function fromMarkdown(md: string) {
  const list = lines(md)
  const objective =
    list.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") ??
    list.find((line) => !line.startsWith("#")) ??
    "Implementation plan"

  const inScope = pickSection(list, /in[\s-]?scope|scope/)
  const outScope = pickSection(list, /out[\s-]?of[\s-]?scope|non[\s-]?goals/)
  const constraints = pickSection(list, /constraints|limits/)
  const assumptions = pickSection(list, /assumptions?/)
  const acceptance = pickSection(list, /acceptance|success|validation/)
  const risksRaw = pickSection(list, /risks?/)
  const stepRaw = pickSection(list, /steps?|implementation|rollout|execution|phases?/)

  const steps = (stepRaw.length ? stepRaw : list.filter((line) => /^\d+\.\s+/.test(line))).map((item, idx) => ({
    id: `step-${idx + 1}`,
    title: item.replace(/^\d+\.\s+/, ""),
    dependencies: [] as string[],
  }))

  const risks = risksRaw.map((risk) => ({
    risk,
    mitigation: "TBD",
  }))

  return {
    objective,
    in_scope: inScope,
    out_of_scope: outScope,
    constraints,
    assumptions,
    acceptance_criteria: acceptance,
    steps,
    risks,
  }
}

export function planJsonPath(markdownPath: string) {
  if (markdownPath.endsWith(".md")) return markdownPath.slice(0, -3) + ".json"
  return markdownPath + ".json"
}

export async function persistPlanArtifacts(input: {
  sessionID: string
  planPath: string
  agent: string
  questionRounds?: number
}) {
  const exists = await Bun.file(input.planPath).exists()
  const markdown = exists ? await Bun.file(input.planPath).text() : ""
  const parsed = fromMarkdown(markdown)
  const jsonPath = planJsonPath(input.planPath)
  const dir = path.dirname(jsonPath)
  await fs.mkdir(dir, { recursive: true })

  const artifact = PlanArtifact.parse({
    ...parsed,
    metadata: {
      session_id: input.sessionID,
      agent: input.agent,
      created_at: Date.now(),
      style: Flag.OPENCODE_PLAN_STYLE,
      interaction_style: Flag.OPENCODE_PLAN_STYLE === "interrogative" ? "codex-like" : "legacy",
      confirmed: hasConfirmation(markdown),
      question_rounds: input.questionRounds ?? 0,
      completeness_score: score(parsed),
      markdown_path: input.planPath,
      json_path: jsonPath,
    },
  })

  await Bun.write(jsonPath, JSON.stringify(artifact, null, 2) + "\n")
  return {
    artifact,
    jsonPath,
  }
}
