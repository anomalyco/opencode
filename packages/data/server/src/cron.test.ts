import { describe, expect, test } from "bun:test"
import cron from "./cron"

const controller = { cron: "5 * * * *", scheduledTime: Date.parse("2026-11-03T04:05:00.000Z") }

describe("data sync cron", () => {
  test("starts this hour's run when no recent run exists", async () => {
    const workflow = fakeWorkflow({})

    await cron.scheduled(controller as never, { DataSyncWorkflow: workflow.binding as never })

    expect(workflow.created).toEqual([
      { id: "data-hourly-2026-11-03T04", params: { history: false, startedAt: "2026-11-03T04:05:00.000Z" } },
    ])
  })

  test("fails the tick instead of starting a run when a lookup fails for another reason", async () => {
    const workflow = fakeWorkflow({ get: { "data-hourly-2026-11-03T02": new Error("internal error") } })

    await expect(cron.scheduled(controller as never, { DataSyncWorkflow: workflow.binding as never })).rejects.toThrow(
      "internal error",
    )
    expect(workflow.created).toEqual([])
  })

  test("fails the tick when an instance's status cannot be read", async () => {
    const workflow = fakeWorkflow({ status: { "data-hourly-2026-11-03T03": new Error("status unavailable") } })

    await expect(cron.scheduled(controller as never, { DataSyncWorkflow: workflow.binding as never })).rejects.toThrow(
      "status unavailable",
    )
    expect(workflow.created).toEqual([])
  })

  test("treats a concurrent create of the same slot as a skip", async () => {
    const workflow = fakeWorkflow({ create: new Error("(instance.already_exists) Instance already exists") })

    await cron.scheduled(controller as never, { DataSyncWorkflow: workflow.binding as never })

    expect(workflow.created).toEqual([])
  })

  test("still fails on other create errors", async () => {
    const workflow = fakeWorkflow({ create: new Error("internal error") })

    await expect(cron.scheduled(controller as never, { DataSyncWorkflow: workflow.binding as never })).rejects.toThrow(
      "internal error",
    )
  })
})

// Instances not listed in `status` do not exist, and `get` rejects for them the
// way the Workflow binding does.
function fakeWorkflow(input: { get?: Record<string, Error>; status?: Record<string, Error | string>; create?: Error }) {
  const created: { id?: string; params?: unknown }[] = []
  return {
    created,
    binding: {
      get: async (id: string) => {
        const failure = input.get?.[id]
        if (failure) throw failure
        const status = input.status?.[id]
        if (status === undefined) throw new Error("instance.not_found")
        return {
          status: async () => {
            if (status instanceof Error) throw status
            return { status }
          },
        }
      },
      create: async (options: { id?: string; params?: unknown }) => {
        if (input.create) throw input.create
        created.push(options)
        return { id: options.id }
      },
    },
  }
}
