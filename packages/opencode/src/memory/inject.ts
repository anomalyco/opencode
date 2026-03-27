import { MemoryStore } from "./store"

export function buildMemoryContext(projectDir: string, query = ""): string {
  const entries = query
    ? MemoryStore.search(projectDir, query, 4)
    : MemoryStore.recent(projectDir, 3)

  if (entries.length === 0) return ""

  const lines: string[] = [
    "## Memory from previous sessions",
    "(Automatically recalled based on current context)",
    "",
  ]

  for (const entry of entries) {
    const date = new Date(entry.createdAt).toISOString().split("T")[0]
    lines.push(`### ${entry.title || entry.sessionId} (${date})`)
    // Include a condensed version of the summary (headings and bullet points only)
    const condensed = entry.summary
      .split("\n")
      .filter((l) => l.startsWith("- ") || l.startsWith("## ") || l.startsWith("# "))
      .slice(0, 10)
      .join("\n")
    lines.push(condensed)
    lines.push("")
  }

  return lines.join("\n")
}
