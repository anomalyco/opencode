import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { Issue } from "@/issue/issue"
import { EventV2Bridge } from "@/event-v2-bridge"
import { provideTmpdirInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const appLayer = AppNodeBuilder.build(LayerNode.group([Issue.node, EventV2Bridge.node, Database.node]))

const it = testEffect(Layer.mergeAll(appLayer, testInstanceStoreLayer, LayerNode.compile(CrossSpawnSpawner.node)))

describe("Issue.archive", () => {
  it.live(
    "sets status to Done when outcome is done",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({
            directory: dir,
            issue: { title: "Task A", level: 0 },
          })
          const archived = yield* svc.archive({ directory: dir, id: created.id, outcome: "done" })
          expect(archived.status).toBe("Done")
          expect(archived.id).toBe(created.id)
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "sets status to Canceled when outcome is canceled",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Task B", level: 0 } })
          const archived = yield* svc.archive({ directory: dir, id: created.id, outcome: "canceled" })
          expect(archived.status).toBe("Canceled")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "sets status to Duplicate when outcome is duplicate",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Task C", level: 0 } })
          const archived = yield* svc.archive({ directory: dir, id: created.id, outcome: "duplicate" })
          expect(archived.status).toBe("Duplicate")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "is idempotent — archiving an already-archived issue returns it without state change",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Task D", level: 0 } })
          const first = yield* svc.archive({ directory: dir, id: created.id, outcome: "done" })
          const second = yield* svc.archive({ directory: dir, id: created.id, outcome: "canceled" })
          // Idempotent: status stays Done, outcome of second call is ignored
          expect(second.status).toBe("Done")
          expect(second.time_updated).toBe(first.time_updated)
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "does NOT cascade — archiving L1 leaves L2 status unchanged",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const l1 = yield* svc.create({ directory: dir, issue: { title: "L1", level: 0 } })
          const l2 = yield* svc.create({
            directory: dir,
            issue: { title: "L2", level: 1, parent_id: l1.id, status: "In Progress" },
          })
          yield* svc.archive({ directory: dir, id: l1.id, outcome: "done" })

          // L2 row keeps its In Progress status — it's just hidden by the
          // default include_archived=false view.
          const all = yield* svc.get({ directory: dir, include_archived: true })
          const l2Row = all.find((i) => i.id === l2.id)
          expect(l2Row).toBeDefined()
          expect(l2Row!.status).toBe("In Progress")
        }),
      ),
    { timeout: 30_000 },
  )
})

describe("Issue.get with include_archived", () => {
  it.live(
    "default (include_archived=false) hides archived L1 and their L2 subtree",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const l1Active = yield* svc.create({ directory: dir, issue: { title: "L1 Active", level: 0 } })
          const l1Archived = yield* svc.create({ directory: dir, issue: { title: "L1 Archived", level: 0 } })
          const l2OfActive = yield* svc.create({
            directory: dir,
            issue: { title: "L2 of Active", level: 1, parent_id: l1Active.id },
          })
          const l2OfArchived = yield* svc.create({
            directory: dir,
            issue: { title: "L2 of Archived", level: 1, parent_id: l1Archived.id },
          })
          yield* svc.archive({ directory: dir, id: l1Archived.id, outcome: "done" })

          const visible = yield* svc.get({ directory: dir })
          const visibleIds = new Set(visible.map((i) => i.id))
          expect(visibleIds.has(l1Active.id)).toBe(true)
          expect(visibleIds.has(l2OfActive.id)).toBe(true)
          expect(visibleIds.has(l1Archived.id)).toBe(false)
          // L2 of archived L1 is hidden even though it's still Active
          expect(visibleIds.has(l2OfArchived.id)).toBe(false)
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "include_archived=true returns all issues",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const l1Active = yield* svc.create({ directory: dir, issue: { title: "L1 Active", level: 0 } })
          const l1Archived = yield* svc.create({ directory: dir, issue: { title: "L1 Archived", level: 0 } })
          yield* svc.archive({ directory: dir, id: l1Archived.id, outcome: "done" })

          const all = yield* svc.get({ directory: dir, include_archived: true })
          const allIds = new Set(all.map((i) => i.id))
          expect(allIds.has(l1Active.id)).toBe(true)
          expect(allIds.has(l1Archived.id)).toBe(true)
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "default view hides archived L2 but shows its active L1 parent",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const l1 = yield* svc.create({ directory: dir, issue: { title: "L1", level: 0 } })
          const l2Active = yield* svc.create({
            directory: dir,
            issue: { title: "L2 Active", level: 1, parent_id: l1.id },
          })
          const l2Archived = yield* svc.create({
            directory: dir,
            issue: { title: "L2 Archived", level: 1, parent_id: l1.id },
          })
          yield* svc.archive({ directory: dir, id: l2Archived.id, outcome: "done" })

          const visible = yield* svc.get({ directory: dir })
          const visibleIds = new Set(visible.map((i) => i.id))
          expect(visibleIds.has(l1.id)).toBe(true)
          expect(visibleIds.has(l2Active.id)).toBe(true)
          expect(visibleIds.has(l2Archived.id)).toBe(false)
        }),
      ),
    { timeout: 30_000 },
  )
})

describe("Issue.delete constraint", () => {
  it.live(
    "rejects deletion of an Active issue with IssueNotArchivedError",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Active", level: 0 } })

          const error = yield* svc.delete({ directory: dir, id: created.id }).pipe(Effect.flip)
          expect(error).toBeInstanceOf(Issue.IssueNotArchivedError)
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "deletes an archived issue",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "To Delete", level: 0 } })
          yield* svc.archive({ directory: dir, id: created.id, outcome: "done" })

          yield* svc.delete({ directory: dir, id: created.id })
          const remaining = yield* svc.get({ directory: dir, include_archived: true })
          expect(remaining.find((i) => i.id === created.id)).toBeUndefined()
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "cascades L2 children when deleting an archived L1",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const l1 = yield* svc.create({ directory: dir, issue: { title: "L1", level: 0 } })
          const l2a = yield* svc.create({
            directory: dir,
            issue: { title: "L2 a", level: 1, parent_id: l1.id },
          })
          const l2b = yield* svc.create({
            directory: dir,
            issue: { title: "L2 b", level: 1, parent_id: l1.id },
          })
          yield* svc.archive({ directory: dir, id: l1.id, outcome: "done" })

          yield* svc.delete({ directory: dir, id: l1.id })
          const remaining = yield* svc.get({ directory: dir, include_archived: true })
          const ids = new Set(remaining.map((i) => i.id))
          expect(ids.has(l1.id)).toBe(false)
          expect(ids.has(l2a.id)).toBe(false)
          expect(ids.has(l2b.id)).toBe(false)
        }),
      ),
    { timeout: 30_000 },
  )
})

describe("Issue.update on archived issues", () => {
  it.live(
    "allows update on an archived issue (no guard)",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "To Archive", level: 0 } })
          yield* svc.archive({ directory: dir, id: created.id, outcome: "done" })

          // Archived issues remain manageable — the guard was removed
          // (ADR-0001 Amendment 2026-07-19 §D17: 归档语义仅为该待办已经处理完成).
          const updated = yield* svc.update({
            directory: dir,
            id: created.id,
            patch: { title: "New Title" },
          })
          expect(updated.title).toBe("New Title")
          expect(updated.status).toBe("Done")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "allows update on an Active issue",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Active", level: 0 } })
          const updated = yield* svc.update({
            directory: dir,
            id: created.id,
            patch: { title: "Updated Title" },
          })
          expect(updated.title).toBe("Updated Title")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "allows transitioning an archived issue back to Active via status patch",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Done Item", level: 0 } })
          yield* svc.archive({ directory: dir, id: created.id, outcome: "done" })

          const updated = yield* svc.update({
            directory: dir,
            id: created.id,
            patch: { status: "Backlog" },
          })
          expect(updated.status).toBe("Backlog")
        }),
      ),
    { timeout: 30_000 },
  )
})

describe("Issue.reorder with archived issues", () => {
  it.live(
    "allows reorder when any id is archived (no guard)",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const a = yield* svc.create({ directory: dir, issue: { title: "A", level: 0 } })
          const b = yield* svc.create({ directory: dir, issue: { title: "B", level: 0 } })
          yield* svc.archive({ directory: dir, id: b.id, outcome: "done" })

          yield* svc.reorder({ directory: dir, ids: [b.id, a.id] })
          const all = yield* svc.get({ directory: dir, include_archived: true })
          expect(all[0].id).toBe(b.id)
          expect(all[1].id).toBe(a.id)
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "allows reorder when all ids are Active",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const a = yield* svc.create({ directory: dir, issue: { title: "A", level: 0 } })
          const b = yield* svc.create({ directory: dir, issue: { title: "B", level: 0 } })

          yield* svc.reorder({ directory: dir, ids: [b.id, a.id] })
          const all = yield* svc.get({ directory: dir })
          expect(all[0].id).toBe(b.id)
          expect(all[1].id).toBe(a.id)
        }),
      ),
    { timeout: 30_000 },
  )
})

// ADR-0005 D2 (amended 2026-07-20): Linear-linked refusal is enforced at
// the AGENT TOOL layer (issue_update.ts / issue_archive.ts / issue_delete.ts),
// NOT at the Issue.Service layer. The HTTP API (UI path) calls the same
// service to let users edit Linear-linked issues locally before pushing to
// Linear via SyncPush. These tests verify the service is Linear-agnostic —
// refusal behavior is covered by tool-layer E2E tests.
describe("Issue.Service is Linear-agnostic (ADR-0005 D2 amended)", () => {
  it.live(
    "update accepts Linear-linked issue (refusal is in the tool layer)",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({
            directory: dir,
            issue: { title: "Linear-linked", level: 0, linear_issue_id: "LIN-100" },
          })

          const updated = yield* svc.update({
            directory: dir,
            id: created.id,
            patch: { title: "New Title", status: "In Progress" },
          })
          expect(updated.title).toBe("New Title")
          expect(updated.status).toBe("In Progress")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "archive accepts Linear-linked issue",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({
            directory: dir,
            issue: { title: "Linear-linked", level: 0, linear_issue_id: "LIN-102" },
          })

          const archived = yield* svc.archive({ directory: dir, id: created.id, outcome: "done" })
          expect(archived.status).toBe("Done")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "delete accepts Linear-linked archived issue",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          // Create a Linear-linked issue that is ALREADY archived (status=Done)
          const created = yield* svc.create({
            directory: dir,
            issue: { title: "Linear-linked archived", level: 0, linear_issue_id: "LIN-103", status: "Done" },
          })

          yield* svc.delete({ directory: dir, id: created.id })
          const remaining = yield* svc.get({ directory: dir, include_archived: true })
          expect(remaining.find((i) => i.id === created.id)).toBeUndefined()
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "update allows local-only issue (linear_issue_id == null)",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Local-only", level: 0 } })

          const updated = yield* svc.update({
            directory: dir,
            id: created.id,
            patch: { title: "Updated", status: "In Progress" },
          })
          expect(updated.title).toBe("Updated")
          expect(updated.status).toBe("In Progress")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "archive allows local-only issue",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Local-only", level: 0 } })

          const archived = yield* svc.archive({ directory: dir, id: created.id, outcome: "done" })
          expect(archived.status).toBe("Done")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "delete allows local-only archived issue",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({ directory: dir, issue: { title: "Local-only", level: 0 } })
          yield* svc.archive({ directory: dir, id: created.id, outcome: "done" })

          yield* svc.delete({ directory: dir, id: created.id })
          const remaining = yield* svc.get({ directory: dir, include_archived: true })
          expect(remaining.find((i) => i.id === created.id)).toBeUndefined()
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "reorder accepts Linear-linked issues (position is local-only)",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const a = yield* svc.create({
            directory: dir,
            issue: { title: "A (Linear)", level: 0, linear_issue_id: "LIN-200" },
          })
          const b = yield* svc.create({ directory: dir, issue: { title: "B (local)", level: 0 } })

          yield* svc.reorder({ directory: dir, ids: [b.id, a.id] })
          const all = yield* svc.get({ directory: dir, include_archived: true })
          expect(all[0].id).toBe(b.id)
          expect(all[1].id).toBe(a.id)
        }),
      ),
    { timeout: 30_000 },
  )
})

// ADR-0005 D6: agent-facing tool outputs filter sync-internal
// bookkeeping (last_pushed_at, last_pulled_at, cloud_shadow) so the
// agent only sees fields with actionable value. linear_* fields stay
// for routing.
describe("Issue.toAgentInfo (ADR-0005 D6)", () => {
  it.live(
    "strips last_pushed_at, last_pulled_at, cloud_shadow",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({
            directory: dir,
            issue: {
              title: "Linked",
              level: 0,
              linear_issue_id: "LIN-300",
              last_pushed_at: 1700000000000,
              last_pulled_at: 1700000001000,
              cloud_shadow: { title: "Linked", status: "Todo" },
            },
          })

          const agent = Issue.toAgentInfo(created)
          expect(agent.id).toBe(created.id)
          expect(agent.linear_issue_id).toBe("LIN-300")
          // Sync-internal fields are stripped
          expect("last_pushed_at" in agent).toBe(false)
          expect("last_pulled_at" in agent).toBe(false)
          expect("cloud_shadow" in agent).toBe(false)
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "preserves routing fields (linear_issue_id, linear_team_id, linear_project_id)",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const created = yield* svc.create({
            directory: dir,
            issue: {
              title: "Full Linear",
              level: 0,
              linear_issue_id: "LIN-301",
              linear_team_id: "team-uuid",
              linear_project_id: "project-uuid",
            },
          })

          const agent = Issue.toAgentInfo(created)
          expect(agent.linear_issue_id).toBe("LIN-301")
          expect(agent.linear_team_id).toBe("team-uuid")
          expect(agent.linear_project_id).toBe("project-uuid")
        }),
      ),
    { timeout: 30_000 },
  )

  it.live(
    "preserves content + hierarchy fields",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const svc = yield* Issue.Service
          const l1 = yield* svc.create({ directory: dir, issue: { title: "L1", level: 0 } })
          const l2 = yield* svc.create({
            directory: dir,
            issue: {
              title: "L2",
              level: 1,
              parent_id: l1.id,
              status: "In Progress",
              priority: "high",
              labels: ["Feature"],
              due_date: "2026-08-01",
              assignee_id: "user-1",
            },
          })

          const agent = Issue.toAgentInfo(l2)
          expect(agent.title).toBe("L2")
          expect(agent.parent_id).toBe(l1.id)
          expect(agent.level).toBe(1)
          expect(agent.status).toBe("In Progress")
          expect(agent.priority).toBe("high")
          expect(agent.labels).toEqual(["Feature"])
          expect(agent.due_date).toBe("2026-08-01")
          expect(agent.assignee_id).toBe("user-1")
        }),
      ),
    { timeout: 30_000 },
  )
})
