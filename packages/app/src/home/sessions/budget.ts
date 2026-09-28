import { HOME_SESSION_LIMIT } from "./index"
import { SESSION_RECENT_LIMIT } from "@/runtime/server/global-sync/types"

export const PROJECT_LIST_PER_DIR_BUDGET = HOME_SESSION_LIMIT + SESSION_RECENT_LIMIT
export const PROJECT_LIST_CONCURRENCY_LIMIT = 5

export const projectListRowBudget = (directoryCount: number) => directoryCount * PROJECT_LIST_PER_DIR_BUDGET

export function isProjectListOverBudget(rowCount: number, directoryCount: number) {
  return rowCount > projectListRowBudget(directoryCount)
}

export async function mapWithProjectListConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(PROJECT_LIST_CONCURRENCY_LIMIT, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await mapper(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}
