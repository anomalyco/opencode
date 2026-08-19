import type { UsageResponse, UsageResult } from "@opencode-ai/sdk/v2"

export type { UsageResponse, UsageResult } from "@opencode-ai/sdk/v2"

export type UsageSnapshot = NonNullable<UsageResult["snapshot"]>
export type UsageWindow = UsageSnapshot["windows"][number]
export type UsageEntry = UsageResult & { snapshot: UsageSnapshot }

export function hasUsageSnapshot(result: UsageResult): result is UsageEntry {
  return result.snapshot !== null
}
