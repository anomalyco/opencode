import { describe, expect, test } from "bun:test"
import {
  PROJECT_LIST_CONCURRENCY_LIMIT,
  PROJECT_LIST_PER_DIR_BUDGET,
  isProjectListOverBudget,
  mapWithProjectListConcurrency,
  projectListRowBudget,
} from "./budget"
import { HOME_SESSION_LIMIT } from "./index"
import { SESSION_RECENT_LIMIT } from "@/runtime/server/global-sync/types"

describe("T1 project-list budget gate", () => {
  test("per-directory budget stays N*114", () => {
    expect(HOME_SESSION_LIMIT).toBe(64)
    expect(SESSION_RECENT_LIMIT).toBe(50)
    expect(PROJECT_LIST_PER_DIR_BUDGET).toBe(114)
  })

  test("row budget scales as N*114", () => {
    expect(projectListRowBudget(1)).toBe(114)
    expect(projectListRowBudget(3)).toBe(342)
    expect(projectListRowBudget(0)).toBe(0)
  })

  test("flags rows past N*114 as over budget", () => {
    expect(isProjectListOverBudget(114, 1)).toBe(false)
    expect(isProjectListOverBudget(115, 1)).toBe(true)
    expect(isProjectListOverBudget(342, 3)).toBe(false)
    expect(isProjectListOverBudget(343, 3)).toBe(true)
  })

  test("concurrency gate stays at 5", () => {
    expect(PROJECT_LIST_CONCURRENCY_LIMIT).toBe(5)
  })

  test("concurrent map never exceeds 5 in flight", async () => {
    const items = Array.from({ length: 12 }, (_, index) => index)
    let inflight = 0
    let peak = 0
    const results = await mapWithProjectListConcurrency(items, async (item) => {
      inflight += 1
      peak = Math.max(peak, inflight)
      await Bun.sleep(1)
      inflight -= 1
      return item * 2
    })
    expect(results).toEqual(items.map((item) => item * 2))
    expect(peak).toBeLessThanOrEqual(5)
    expect(peak).toBeGreaterThan(1)
  })

  test("concurrent map preserves input order", async () => {
    const items = [3, 1, 2]
    const results = await mapWithProjectListConcurrency(items, async (item) => {
      await Bun.sleep(item === 1 ? 5 : 1)
      return `row-${item}`
    })
    expect(results).toEqual(["row-3", "row-1", "row-2"])
  })
})
