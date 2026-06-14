import type { Dataset } from "./types.ts"
import type { LLMRequest, MockResponder } from "./llm.ts"
import { failingTraces } from "./dataset.ts"

function extractMarkdownBlock(prompt: string): string {
  const m = prompt.match(/```markdown\n([\s\S]*?)```/)
  return (m ? m[1] : prompt).trim()
}

/**
 * Deterministic stand-in for a real model, used by `--mock` runs and tests where
 * no credentials exist. It reads the reflection prompt's current skill body and
 * appends concrete guidance for whichever expected keywords (from failing cases)
 * are still missing — so the keyword scorer measures a genuine, repeatable
 * improvement. `index` is used to emit distinct variants per generation.
 */
export function offlineResponder(dataset: Dataset): MockResponder {
  const failing = failingTraces(dataset)
  const caseById = new Map(dataset.cases.map((c) => [c.id, c]))
  const needed = Array.from(new Set(failing.flatMap((t) => caseById.get(t.caseId)?.expectKeywords ?? [])))

  return (req: LLMRequest, index: number) => {
    const body = extractMarkdownBlock(req.prompt)
    const lower = body.toLowerCase()
    const missing = needed.filter((k) => !lower.includes(k.toLowerCase()))
    if (missing.length === 0) return `<skill>\n${body}\n</skill>`
    const take = missing.slice(0, Math.min(missing.length, index + 1))
    const additions = take.map((k) => `- When relevant, ${k}.`).join("\n")
    const hasGuidance = /^##\s+Guidance\s*$/im.test(body)
    const improved = hasGuidance
      ? `${body.trimEnd()}\n${additions}\n`
      : `${body.trimEnd()}\n\n## Guidance\n${additions}\n`
    return `RATIONALE: cover ${take.join(", ")}\n<skill>\n${improved}</skill>`
  }
}
