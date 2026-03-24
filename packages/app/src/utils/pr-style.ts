import type { PrInfo } from "@opencode-ai/sdk/v2/client"

export function getPrPillStyle(pr: PrInfo): string {
  if (pr.state === "MERGED") return "border-[var(--pr-color-merged)]/40 bg-[var(--pr-color-merged)]/15 text-[var(--pr-color-merged-text)]"
  if (pr.state === "CLOSED") return "border-[var(--pr-color-closed)]/40 bg-[var(--pr-color-closed)]/15 text-[var(--pr-color-closed-text)]"
  if (pr.isDraft) return "border-[var(--pr-color-draft)]/40 bg-[var(--pr-color-draft)]/15 text-[var(--pr-color-draft-text)]"
  return "border-[var(--pr-color-open)]/40 bg-[var(--pr-color-open)]/15 text-[var(--pr-color-open-text)]"
}

export function getPrButtonContainerStyle(pr: PrInfo | undefined): string {
  if (!pr) return "border-border-weak-base bg-surface-panel"
  if (pr.state === "MERGED") return "border-[var(--pr-color-merged)]/60 bg-[var(--pr-color-merged)]/20"
  if (pr.state === "CLOSED") return "border-[var(--pr-color-closed)]/60 bg-[var(--pr-color-closed)]/20"
  if (pr.isDraft) return "border-[var(--pr-color-draft)]/60 bg-[var(--pr-color-draft)]/20"
  return "border-[var(--pr-color-open)]/60 bg-[var(--pr-color-open)]/20"
}

export function getPrButtonDividerStyle(pr: PrInfo | undefined): string {
  if (!pr) return "bg-border-weak-base"
  if (pr.state === "MERGED") return "bg-[var(--pr-color-merged)]/60"
  if (pr.state === "CLOSED") return "bg-[var(--pr-color-closed)]/60"
  if (pr.isDraft) return "bg-[var(--pr-color-draft)]/60"
  return "bg-[var(--pr-color-open)]/60"
}

export function prRequiresAttention(pr: PrInfo | undefined): boolean {
  if (!pr) return false
  if (pr.state === "MERGED" || pr.state === "CLOSED") return false
  return (pr.unresolvedCommentCount ?? 0) > 0 || pr.checksState === "FAILURE"
}
