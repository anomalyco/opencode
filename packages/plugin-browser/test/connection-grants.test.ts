import { expect, test } from "bun:test"
import { Effect } from "effect"
import { BrowserConnection } from "../src/connection.js"

const browserAllow = { action: "browser", resource: "*", effect: "allow" } as const
const skillAllow = { action: "skill", resource: "browser", effect: "allow" } as const
const unrelated = { action: "edit", resource: "*", effect: "deny" } as const

type SessionRow = {
  id: string
  permissions?: ReadonlyArray<{ action: string; resource: string; effect: string }>
}

const row = (id: string, permissions?: SessionRow["permissions"]): SessionRow => ({ id, permissions })

const reconcileOver = (pages: ReadonlyArray<{ data: SessionRow[]; next?: string }>) => {
  const updates: Array<{ sessionID: string; permissions: unknown[] }> = []
  const byCursor = new Map(pages.map((page, index) => [index === 0 ? undefined : pages[index - 1]!.next, page]))
  const ctx = {
    session: {
      list: (input?: { cursor?: string }) => {
        const current = byCursor.get(input?.cursor)
        return Effect.succeed({
          data: current?.data ?? [],
          cursor: current?.next === undefined ? {} : { next: current.next },
        })
      },
      update: (input: { sessionID: string; permissions: unknown[] }) => {
        updates.push(input)
        return Effect.void
      },
    },
  } as unknown as Parameters<typeof BrowserConnection.reconcileStaleGrants>[0]

  return { ctx, updates }
}

test("startup revokes browser grants left behind by a crashed attachment", async () => {
  const stale = row("ses_stale", [browserAllow, unrelated, skillAllow])
  const clean = row("ses_clean", [unrelated])
  const archived = row("ses_archived", [browserAllow])
  const { ctx, updates } = reconcileOver([{ data: [stale, clean], next: "page-2" }, { data: [archived] }])

  await Effect.runPromise(BrowserConnection.reconcileStaleGrants(ctx))

  expect(updates).toEqual([
    { sessionID: "ses_stale", permissions: [unrelated] },
    { sessionID: "ses_archived", permissions: [] },
  ])
})

test("startup leaves sessions without browser grants untouched", async () => {
  const clean = row("ses_clean", [unrelated])
  const { ctx, updates } = reconcileOver([{ data: [clean] }])

  await Effect.runPromise(BrowserConnection.reconcileStaleGrants(ctx))

  expect(updates).toEqual([])
})
