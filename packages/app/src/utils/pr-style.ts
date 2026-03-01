import type { PrInfo } from "@opencode-ai/sdk/v2/client"

export function getPrPillStyle(pr: PrInfo): string {
  if (pr.state === "MERGED") return "border-[#8957e5]/40 bg-[#8957e5]/15 text-[#a371f7]"
  if (pr.state === "CLOSED") return "border-[#da3633]/40 bg-[#da3633]/15 text-[#f85149]"
  if (pr.isDraft) return "border-[#768390]/40 bg-[#768390]/15 text-[#768390]"
  if (pr.state === "OPEN" && pr.checksState === "FAILURE") return "border-[#da3633]/40 bg-[#da3633]/15 text-[#f85149]"
  return "border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]"
}

export function getPrButtonContainerStyle(pr: PrInfo | undefined): string {
  if (!pr) return "border-border-weak-base bg-surface-panel"
  if (pr.state === "MERGED") return "border-[#8957e5]/60 bg-[#8957e5]/20"
  if (pr.state === "CLOSED") return "border-[#da3633]/60 bg-[#da3633]/20"
  if (pr.isDraft) return "border-[#768390]/60 bg-[#768390]/20"
  return "border-[#238636]/60 bg-[#238636]/20"
}

export function getPrButtonDividerStyle(pr: PrInfo | undefined): string {
  if (!pr) return "bg-border-weak-base"
  if (pr.state === "MERGED") return "bg-[#8957e5]/60"
  if (pr.state === "CLOSED") return "bg-[#da3633]/60"
  if (pr.isDraft) return "bg-[#768390]/60"
  return "bg-[#238636]/60"
}
