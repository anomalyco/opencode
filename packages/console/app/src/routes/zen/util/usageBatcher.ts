import { Resource } from "@opencode-ai/console-resource"
import { getRedis } from "./redis"

// Workspaces whose balance/usage updates should be batched in Redis to avoid
// row-level lock contention on BillingTable / UserTable.
export const HOT_WORKSPACES = new Set<string>([
  "wrk_01KJ8PX5CH50Y4YNGNS9ZR8YDC", // invoice
])

// Probability that a given request flushes the accumulated totals to the DB.
// Lower = fewer DB writes, more staleness. ~1 in 100 -> ~1% of requests write.
const FLUSH_PROBABILITY = 1 / 100

export async function accumulateUsage(workspaceID: string, userID: string, workspaceCost: number, userCost: number) {
  const redis = getRedis()
  const wKey = `${Resource.App.stage}:usage:wrk:${workspaceID}`
  const uKey = `${Resource.App.stage}:usage:usr:${workspaceID}:${userID}`

  await Promise.all([redis.incrby(wKey, workspaceCost), redis.incrby(uKey, userCost)])

  if (Math.random() > FLUSH_PROBABILITY) return null

  // Atomically take the current totals and reset to 0
  const [workspaceTotal, userTotal] = await Promise.all([redis.getdel<number>(wKey), redis.getdel<number>(uKey)])

  const workspaceFlush = Number(workspaceTotal ?? 0)
  const userFlush = Number(userTotal ?? 0)
  if (workspaceFlush === 0 && userFlush === 0) return null

  return { workspaceCost: workspaceFlush, userCost: userFlush }
}
