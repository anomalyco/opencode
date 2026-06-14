import type { Candidate, Dataset, Skill } from "./types.ts"
import type { LLMClient, LLMRequest } from "./llm.ts"
import { failingTraces } from "./dataset.ts"
import { serializeSkill, withBody } from "./skill.ts"

const SKILL_OPEN = "<skill>"
const SKILL_CLOSE = "</skill>"

/**
 * Build the reflective mutation prompt. Following GEPA's core idea, we feed the
 * model *why* cases failed (the failure reasons from traces), not just that they
 * failed, and ask for a targeted rewrite of the skill body.
 */
export function buildReflectionPrompt(skill: Skill, dataset: Dataset): LLMRequest {
  const failing = failingTraces(dataset)
  const caseById = new Map(dataset.cases.map((c) => [c.id, c]))

  const reflections =
    failing.length > 0
      ? failing
          .map((t, i) => {
            const c = caseById.get(t.caseId)
            const expects = c?.expectKeywords?.length ? `\n   should cover: ${c.expectKeywords.join(", ")}` : ""
            return `${i + 1}. case "${t.caseId}"${c ? ` — ${c.prompt}` : ""}\n   failed because: ${
              t.failureReason ?? "unknown"
            }${expects}`
          })
          .join("\n")
      : "(no recorded failures — improve clarity and coverage without bloat)"

  const system =
    "You improve agent skill documents. A skill is a markdown instruction sheet that guides an autonomous coding agent. " +
    "Make targeted edits that fix the observed failures while preserving correct existing guidance. Do not pad length."

  const prompt = [
    "Here is the current skill body:",
    "",
    "```markdown",
    skill.body.trim(),
    "```",
    "",
    "Observed failures to address:",
    reflections,
    "",
    "Rewrite the skill body to fix these failures. Keep existing section headings that still apply.",
    `Return ONLY the full revised markdown body wrapped in ${SKILL_OPEN} and ${SKILL_CLOSE} tags,`,
    "optionally preceded by a one-line rationale prefixed with 'RATIONALE:'.",
  ].join("\n")

  return { system, prompt }
}

/** Extract the rewritten body (and optional rationale) from a model reply. */
export function parseVariantReply(reply: string): { body: string; rationale?: string } {
  const start = reply.indexOf(SKILL_OPEN)
  const end = reply.lastIndexOf(SKILL_CLOSE)
  const rationaleMatch = reply.match(/RATIONALE:\s*(.+)/i)
  const rationale = rationaleMatch?.[1]?.trim()
  if (start !== -1 && end !== -1 && end > start) {
    return { body: reply.slice(start + SKILL_OPEN.length, end).trim(), rationale }
  }
  // Fall back to a fenced code block, then to the raw reply.
  const fenced = reply.match(/```(?:markdown|md)?\n([\s\S]*?)```/)
  if (fenced) return { body: fenced[1].trim(), rationale }
  return { body: reply.trim(), rationale }
}

export interface ProposeOptions {
  count: number
  generation: number
  temperature?: number
  /** Id factory (defaults to a generation/index scheme). */
  idFor?: (generation: number, index: number) => string
}

/**
 * Ask the model for `count` mutated variants of `parent`. Variants that come
 * back identical to the parent body are dropped (no-op mutations).
 */
export async function proposeVariants(
  parent: Candidate,
  dataset: Dataset,
  llm: LLMClient,
  opts: ProposeOptions,
): Promise<Candidate[]> {
  const base = buildReflectionPrompt(parent.skill, dataset)
  const idFor = opts.idFor ?? ((g, i) => `g${g}-v${i}`)
  const out: Candidate[] = []

  for (let i = 0; i < opts.count; i++) {
    const reply = await llm.complete({ ...base, temperature: opts.temperature })
    const { body, rationale } = parseVariantReply(reply)
    if (!body || body.trim() === parent.skill.body.trim()) continue
    const skill = withBody(parent.skill, body)
    if (serializeSkill(skill) === serializeSkill(parent.skill)) continue
    out.push({
      id: idFor(opts.generation, i),
      parentId: parent.id,
      generation: opts.generation,
      skill,
      rationale,
    })
  }
  return out
}
