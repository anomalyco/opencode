import type { Part } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 0) return "just now"
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const d = new Date(timestamp)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function extractMessageText(parts: readonly Part[], maxLength: number): string {
  const joined = collectTextParts(parts).join(" ").replace(/\s+/g, " ").trim()
  return Locale.truncate(joined, maxLength)
}

export function extractMessageMarkdown(parts: readonly Part[], maxLines: number, maxChars: number): string {
  const joined = collectTextParts(parts).join("\n\n").trim()
  if (!joined) return joined

  let truncated = joined
  const lines = truncated.split("\n")
  if (lines.length > maxLines) {
    truncated = lines.slice(0, maxLines).join("\n")
  }
  if (truncated.length > maxChars) {
    truncated = truncated.slice(0, maxChars).trimEnd()
  }
  if (truncated.length === joined.length) return joined
  // Close any unterminated fenced code block so the renderer doesn't keep
  // the rest of the panel in "code mode".
  const fences = (truncated.match(/^```/gm) ?? []).length
  if (fences % 2 === 1) truncated += "\n```"
  return truncated + "\n\n…"
}

function collectTextParts(parts: readonly Part[]): string[] {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type !== "text") continue
    const p = part as Part & { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
    if (p.synthetic || p.ignored) continue
    if (!p.text) continue
    chunks.push(p.text)
  }
  return chunks
}

export function formatDiffSummary(
  summary: { additions: number; deletions: number; files: number } | undefined,
): { additions: number; deletions: number; files: number } | undefined {
  if (!summary) return undefined
  if (!summary.additions && !summary.deletions && !summary.files) return undefined
  return summary
}

export function shortModelLabel(model: { id: string; providerID?: string; variant?: string } | undefined): string {
  if (!model) return ""
  const id = model.id ?? ""
  const stripped =
    model.providerID && id.startsWith(`${model.providerID}/`) ? id.slice(model.providerID.length + 1) : id
  return model.variant ? `${stripped} (${model.variant})` : stripped
}
