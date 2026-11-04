import { expect, test } from "bun:test"
import { Effect } from "effect"
import { BrowserConnection } from "../src/connection.js"

const browserAllow = { action: "browser", resource: "*", effect: "allow" } as const
const skillAllow = { action: "skill", resource: "browser", effect: "allow" } as const
const unrelated = { action: "edit", resource: "*", effect: "deny" } as const

type SessionRow = {
  id: string
  permissions?: ReadonlyArray<{ action: string; resource: string; effect: string }>
  location: { directory: string; workspaceID?: string }
}

const location = { directory: "/project" }
const row = (id: string, permissions?: SessionRow["permissions"]): SessionRow => ({ id, permissions, location })

const reconcileOver = (
  pages: ReadonlyArray<{ data: SessionRow[]; next?: string }>,
  currentLocation: SessionRow["location"] = location,
) => {
  const updates: Array<{ sessionID: string; permissions: unknown[] }> = []
  const requests: Array<{ cursor?: string; directory?: string } | undefined> = []
  const byCursor = new Map(pages.map((page, index) => [index === 0 ? undefined : pages[index - 1]!.next, page]))
  const ctx = {
    location: currentLocation,
    session: {
      list: (input?: { cursor?: string; directory?: string }) => {
        requests.push(input)
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

  return { ctx, updates, requests }
}

test("startup revokes browser grants left behind by a crashed attachment", async () => {
  const stale = row("ses_stale", [browserAllow, unrelated, skillAllow])
  const clean = row("ses_clean", [unrelated])
  const archived = row("ses_archived", [browserAllow])
  const { ctx, updates, requests } = reconcileOver([{ data: [stale, clean], next: "page-2" }, { data: [archived] }])

  await Effect.runPromise(BrowserConnection.reconcileStaleGrants(ctx))

  expect(requests).toEqual([{ directory: location.directory }, { cursor: "page-2" }])
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

test.each([undefined, "wrk_current"])(
  "startup preserves other workspace grants when this workspace is %s",
  async (workspaceID) => {
    const currentLocation = { ...location, workspaceID }
    const current = { ...row("ses_current", [browserAllow, skillAllow]), location: currentLocation }
    const other = {
      ...row("ses_other", [browserAllow, skillAllow]),
      location: { ...location, workspaceID: workspaceID === undefined ? "wrk_other" : undefined },
    }
    const { ctx, updates } = reconcileOver([{ data: [other], next: "page-2" }, { data: [current] }], currentLocation)

    await Effect.runPromise(BrowserConnection.reconcileStaleGrants(ctx))

    expect(updates).toEqual([{ sessionID: current.id, permissions: [] }])
  },
)
