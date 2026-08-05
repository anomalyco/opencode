import { expect, test } from "bun:test"
import { Migration } from "./migration"

test("skips a completed migration", async () => {
  const updates: Migration.Status[] = []
  const client = {
    migration: {
      v1: {
        status: async () => ({ status: "completed" as const, completed: 2, total: 2 }),
        run: async () => ({ status: "completed" as const }),
      },
    },
  }

  expect(await Migration.run(client, (status) => updates.push(status))).toBe(false)
  expect(updates).toEqual([])
})

test("polls committed session progress while migration runs", async () => {
  const updates: Migration.Status[] = []
  let completed = 0
  let finish: (() => void) | undefined
  const client = {
    migration: {
      v1: {
        status: async () => ({
          status: completed === 2 ? ("completed" as const) : ("running" as const),
          completed,
          total: 2,
        }),
        run: () =>
          new Promise<{ status: "completed" }>((resolve) => {
            finish = () => resolve({ status: "completed" })
          }),
      },
    },
  }

  const running = Migration.run(client, (status) => updates.push(status))
  await Bun.sleep(1_050)
  completed = 2
  finish?.()
  expect(await running).toBe(true)
  expect(updates).toContainEqual({ status: "running", completed: 0, total: 2 })
  expect(updates).toContainEqual({ status: "completed", completed: 2, total: 2 })
})
