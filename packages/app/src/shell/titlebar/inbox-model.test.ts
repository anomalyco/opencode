import { describe, expect, test } from "bun:test"
import {
  groupInboxByProject,
  inboxProjectKey,
  inboxProjects,
  partitionInboxEntries,
  type InboxEntryItem,
  type InboxSessionItem,
  type InboxStatus,
} from "./inbox-model"

function makeEntry(input: {
  id: string
  server?: string
  directory: string
  projectWorktree?: string
  status?: InboxStatus
  updated?: number
  idle?: number
  archived?: number
}): InboxEntryItem<InboxSessionItem> {
  const server = input.server ?? "local"

  return {
    key: `${server}\0${input.id}`,
    server,
    status: input.status ?? "ready",
    session: {
      id: input.id,
      location: {
        directory: input.directory,
      },
      time: {
        updated: input.updated ?? 100,
        idle: input.idle,
        archived: input.archived,
      },
    },
    ctx: {
      projects: {
        forSession: () => (input.projectWorktree ? { worktree: input.projectWorktree } : undefined),
      },
    },
  }
}

describe("sidebar inbox model", () => {
  test("keeps pinned sessions visible across since thresholds and out of recent", () => {
    const olderPinned = makeEntry({ id: "pinned-old", directory: "/work/alpha", idle: 50, updated: 50 })

    const newerPinned = makeEntry({
      id: "pinned-new",
      directory: "/work/alpha",
      status: "done",
      idle: 250,
      updated: 250,
    })

    const workingPinned = makeEntry({
      id: "pinned-working",
      directory: "/work/alpha",
      status: "working",
      updated: 300,
    })

    const approvalPinned = makeEntry({
      id: "pinned-approval",
      directory: "/work/alpha",
      status: "approval",
      updated: 310,
    })

    const archivedPinned = makeEntry({
      id: "pinned-archived",
      directory: "/work/alpha",
      idle: 260,
      archived: 270,
    })

    const recent = makeEntry({ id: "recent-1", directory: "/work/beta", idle: 200, updated: 200 })

    const sections = partitionInboxEntries(
      [olderPinned, newerPinned, workingPinned, approvalPinned, archivedPinned, recent],
      {
        since: 100,
        pinned: [olderPinned.key, newerPinned.key, workingPinned.key, approvalPinned.key, archivedPinned.key],
      },
    )

    expect(sections.pinned.map((entry) => entry.session.id)).toEqual(["pinned-new", "pinned-old"])
    expect(sections.inbox.map((entry) => entry.session.id)).toEqual(["recent-1"])
    expect(sections.working.map((entry) => entry.session.id)).toEqual(["pinned-working"])
    expect(sections.needs.map((entry) => entry.session.id)).toEqual(["pinned-approval"])
    expect(sections.archived.map((entry) => entry.session.id)).toEqual(["pinned-archived"])
  })

  test("filters sections by project and resets when the selected project has no entries", () => {
    const alpha = makeEntry({
      id: "alpha-1",
      directory: "/work/alpha/.worktrees/feature",
      projectWorktree: "/work/alpha",
      idle: 200,
    })

    const beta = makeEntry({
      id: "beta-1",
      directory: "/work/beta",
      status: "working",
      updated: 220,
    })

    const filtered = partitionInboxEntries([alpha, beta], {
      since: 100,
      project: inboxProjectKey(alpha),
    })

    expect(filtered.project).toBe(inboxProjectKey(alpha))
    expect(filtered.inbox.map((entry) => entry.session.id)).toEqual(["alpha-1"])
    expect(filtered.working).toHaveLength(0)

    const fallback = partitionInboxEntries([alpha, beta], {
      since: 100,
      project: "local\0/work/missing",
    })

    expect(fallback.project).toBeUndefined()
    expect(fallback.inbox.map((entry) => entry.session.id)).toEqual(["alpha-1"])
    expect(fallback.working.map((entry) => entry.session.id)).toEqual(["beta-1"])
  })

  test("aggregates project options across worktrees and disambiguates duplicate names", () => {
    const firstMain = makeEntry({
      id: "s1",
      directory: "/work/team-a/app",
      projectWorktree: "/work/team-a/app",
    })

    const firstWorktree = makeEntry({
      id: "s2",
      directory: "/work/team-a/app-wt",
      projectWorktree: "/work/team-a/app",
    })

    const secondDuplicateName = makeEntry({
      id: "s3",
      directory: "/work/team-b/app",
      projectWorktree: "/work/team-b/app",
    })

    const thirdUnique = makeEntry({
      id: "s4",
      directory: "/work/zeta",
      projectWorktree: "/work/zeta",
    })

    const options = inboxProjects([firstMain, firstWorktree, secondDuplicateName, thirdUnique], (entry) =>
      entry.session.location.directory.endsWith("zeta") ? "zeta" : "app",
    )

    expect(options.map((item) => ({ label: item.label, count: item.count }))).toEqual([
      { label: "app (/work/team-a/app)", count: 2 },
      { label: "app (/work/team-b/app)", count: 1 },
      { label: "zeta", count: 1 },
    ])
  })

  test("groups recent entries by project in first-seen recency order", () => {
    const betaNewest = makeEntry({ id: "beta-new", directory: "/work/beta", idle: 300 })
    const alphaMid = makeEntry({ id: "alpha-mid", directory: "/work/alpha", idle: 200 })
    const betaOlder = makeEntry({ id: "beta-old", directory: "/work/beta", idle: 150 })

    const groups = groupInboxByProject([betaNewest, alphaMid, betaOlder], (entry) =>
      entry.session.location.directory.slice("/work/".length),
    )

    expect(
      groups.map((group) => ({
        label: group.label,
        ids: group.entries.map((entry) => entry.session.id),
      })),
    ).toEqual([
      { label: "beta", ids: ["beta-new", "beta-old"] },
      { label: "alpha", ids: ["alpha-mid"] },
    ])
  })
})
