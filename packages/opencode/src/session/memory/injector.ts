import type { MemoryFact, MemoryWindow, MemoryArtifact } from "./types"

export interface MemoryResult {
  windows: MemoryWindow[]
  facts: MemoryFact[]
  artifacts: MemoryArtifact[]
}

export function format(result: MemoryResult): string {
  if (!result.windows.length && !result.facts.length && !result.artifacts.length) return ""

  const win = result.windows[0]
  const sections: string[] = []

  if (win?.goal) {
    sections.push("### Current Goal")
    sections.push(win.goal)
  }

  if (win?.in_progress) {
    sections.push("### In Progress")
    sections.push(win.in_progress)
  }

  if (win?.blocked_on) {
    sections.push("### Blockers")
    sections.push(win.blocked_on)
  }

  const files = [...(win?.files_touched ?? []), ...(win?.relevant_dirs ?? [])]
  if (files.length) {
    sections.push("### Key Files")
    sections.push(files.map((f) => `- ${f}`).join("\n"))
  }

  const decisions = result.artifacts
    .filter((a) => a.kind === "decision")
    .slice(0, 3)
  .map((a) => a.content)
  if (decisions.length) {
    sections.push("### Recent Decisions")
    sections.push(decisions.map((d) => `- ${d}`).join("\n"))
  }

  const facts = result.facts.slice(0, 5)
  if (facts.length) {
    sections.push("### Relevant Facts")
    sections.push(facts.map((f) => `- ${f.subject}: ${f.value}`).join("\n"))
  }

  if (sections.length === 0) return ""
  return "<system-reminder>\n## Memory Context\n\n" + sections.join("\n\n") + "\n</system-reminder>"
}

export function formatSummary(result: MemoryResult): string {
  if (!result.windows.length && !result.facts.length && !result.artifacts.length) return ""

  const win = result.windows[0]
  const sections: string[] = []

  if (win?.goal) sections.push(`Goal: ${win.goal}`)
  if (win?.in_progress) sections.push(`In progress: ${win.in_progress}`)
  if (win?.blocked_on) sections.push(`Blocked on: ${win.blocked_on}`)

  const files = [...(win?.files_touched ?? []), ...(win?.relevant_dirs ?? [])]
  if (files.length) sections.push(`Files: ${files.join(", ")}`)

  if (sections.length === 0) return ""
  return sections.join(" | ")
}
