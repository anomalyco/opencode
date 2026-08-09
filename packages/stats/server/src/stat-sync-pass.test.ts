import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { runSyncPass } from "./stat-sync-pass"

describe("runSyncPass", () => {
  test("falls back to an incremental sync when the daily full sync fails", async () => {
    const calls: boolean[] = []
    const lastFullDay = await Effect.runPromise(
      runSyncPass({
        today: "2026-08-09",
        lastFullDay: "2026-08-08",
        sync: (full) => {
          calls.push(full)
          return full ? Effect.fail(new Error("full sync timed out")) : Effect.void
        },
      }),
    )

    expect(calls).toEqual([true, false])
    expect(lastFullDay).toBe("2026-08-09")
  })

  test("runs only the incremental sync after the daily full sync was attempted", async () => {
    const calls: boolean[] = []
    await Effect.runPromise(
      runSyncPass({
        today: "2026-08-09",
        lastFullDay: "2026-08-09",
        sync: (full) => {
          calls.push(full)
          return Effect.void
        },
      }),
    )

    expect(calls).toEqual([false])
  })
})
