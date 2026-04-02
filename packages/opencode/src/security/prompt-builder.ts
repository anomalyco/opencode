import type { RetrievedControl, SecurityMode } from "./schema"

type Input = {
  mode: SecurityMode
  userPrompt?: string
  filePath: string
  fileText: string
  controls: RetrievedControl[]
}

function controls(list: RetrievedControl[]) {
  if (list.length === 0) return ""
  return list
    .map((item) => [`[${item.id}] ${item.title}`, item.text.trim()].join("\n"))
    .join("\n\n")
}

export function buildAuditPrompt(input: Input) {
  const extra = input.userPrompt?.trim() ? `\nAdditional user intent:\n${input.userPrompt.trim()}\n` : ""
  const kb =
    input.mode === "rag" && input.controls.length > 0
      ? `\nRetrieved security controls (top-k):\n${controls(input.controls)}\n`
      : ""
  const grounding =
    input.mode === "rag"
      ? "Ground findings in the retrieved controls when applicable and cite control ids exactly (for example: ISO-01)."
      : "Do not cite external controls unless explicitly grounded in the provided file evidence."

  const content = input.mode === "direct" ? ["Target file content:", "```", input.fileText, "```"] : []

  return [
    "You are a security audit assistant for research prototyping.",
    "Generate a concise, structured security audit report.",
    "Do not fabricate evidence not present in the provided input.",
    'If evidence is missing, explicitly write "insufficient evidence".',
    grounding,
    "",
    "Required markdown format:",
    "## Executive Summary",
    "## Findings",
    "### Finding 1",
    "- Finding ID: <short-id>",
    "- Observed Issue: <text or insufficient evidence>",
    "- Severity: <low|medium|high|critical>",
    "- Evidence: <specific quoted/config evidence or insufficient evidence>",
    "- Related Control / Principle: <control id/title or insufficient evidence>",
    "- Recommendation: <specific action>",
    "## Final Risk Overview",
    "",
    `Target file path: ${input.filePath}`,
    extra.trimEnd(),
    kb.trimEnd(),
    ...(input.mode === "direct" ? [] : ["The file is attached as context. Use only that evidence."]),
    ...content,
  ]
    .filter(Boolean)
    .join("\n")
}
