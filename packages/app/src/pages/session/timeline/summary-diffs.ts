import type { FileDiffInfo } from "@opencode-ai/client/promise"
import type { SummaryDiff } from "./timeline-row"

export function uniqueSummaryDiffs(diffs: FileDiffInfo[] | undefined) {
  const files = new Set<string>()
  return (diffs ?? [])
    .reduceRight<SummaryDiff[]>((result, diff) => {
      if (!isSummaryDiff(diff)) return result
      const file = diff.file
      if (files.has(file)) return result
      files.add(file)
      result.push(diff)
      return result
    }, [])
    .reverse()
}

function isSummaryDiff(diff: FileDiffInfo): diff is SummaryDiff {
  return typeof diff.file === "string"
}
