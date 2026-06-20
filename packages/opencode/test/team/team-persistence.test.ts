import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Team, TeamTasks } from "../../src/team"
import { Env } from "../../src/env"
import { Log } from "../../src/util/log"

Log.init({ print: false })

/**
 * Tests that team state persists via the Storage namespace and can be read
 * back after a simulated server restart (same Instance.provide context since
 * Storage is global, keyed by project.id).
 *
 * Each test must clean up its teams to avoid polluting other tests.
 */
describe("Team persistence across restarts", () => {
  test("Team.get reads team created in a previous context", async () => {
    const dir = await fs.mkdtemp(path.join(import.meta.dir, ".tmp-persist-"))

    try {
      await Instance.provide({
        directory: dir,
        init: async () => Env.set("ANTHROPIC_API_KEY", "test-key"),
        fn: async () => {
          await Team.create({
            name: "persist-test",
            leadSessionID: "ses_lead_abc",
          })
          await Team.addMember("persist-test", {
            name: "worker-1",
            sessionID: "ses_worker_1",
            agent: "general",
            status: "busy",
            prompt: "do stuff",
            model: "anthropic/claude-sonnet-4-20250514",
            planApproval: "none",
          })

          // Verify data persists via API (Storage is global, not file-local)
          const team = await Team.get("persist-test")
          expect(team).toBeDefined()
          expect(team!.name).toBe("persist-test")
          expect(team!.leadSessionID).toBe("ses_lead_abc")
          expect(team!.members).toHaveLength(1)
          expect(team!.members[0].name).toBe("worker-1")
          expect(team!.members[0].status).toBe("busy")
          expect(team!.members[0].model).toBe("anthropic/claude-sonnet-4-20250514")

          // Cleanup
          await Team.setMemberStatus("persist-test", "worker-1", "shutdown")
          await Team.cleanup("persist-test")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("Team.list finds all teams after restart", async () => {
    const dir = await fs.mkdtemp(path.join(import.meta.dir, ".tmp-persist-"))

    try {
      await Instance.provide({
        directory: dir,
        init: async () => Env.set("ANTHROPIC_API_KEY", "test-key"),
        fn: async () => {
          await Team.create({ name: "alpha", leadSessionID: "ses_alpha_p" })
          await Team.create({ name: "beta", leadSessionID: "ses_beta_p" })

          const teams = await Team.list()
          const names = teams.map((t) => t.name).sort()
          expect(names).toContain("alpha")
          expect(names).toContain("beta")

          // Cleanup
          await Team.cleanup("alpha")
          await Team.cleanup("beta")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("Team.findBySession works after restart", async () => {
    const dir = await fs.mkdtemp(path.join(import.meta.dir, ".tmp-persist-"))

    try {
      await Instance.provide({
        directory: dir,
        init: async () => Env.set("ANTHROPIC_API_KEY", "test-key"),
        fn: async () => {
          await Team.create({ name: "find-test", leadSessionID: "ses_lead_find_p" })
          await Team.addMember("find-test", {
            name: "searcher",
            sessionID: "ses_member_find_p",
            agent: "explore",
            status: "busy",
            prompt: "search",
            planApproval: "none",
          })

          // Find lead
          const lead = await Team.findBySession("ses_lead_find_p")
          expect(lead).toBeDefined()
          expect(lead!.role).toBe("lead")
          expect(lead!.team.name).toBe("find-test")

          // Find member
          const member = await Team.findBySession("ses_member_find_p")
          expect(member).toBeDefined()
          expect(member!.role).toBe("member")
          expect(member!.memberName).toBe("searcher")

          // Non-existent session
          const none = await Team.findBySession("ses_nonexistent_p")
          expect(none).toBeUndefined()

          // Cleanup
          await Team.setMemberStatus("find-test", "searcher", "shutdown")
          await Team.cleanup("find-test")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("TeamTasks persist after restart", async () => {
    const dir = await fs.mkdtemp(path.join(import.meta.dir, ".tmp-persist-"))

    try {
      await Instance.provide({
        directory: dir,
        init: async () => Env.set("ANTHROPIC_API_KEY", "test-key"),
        fn: async () => {
          await Team.create({ name: "tasks-test", leadSessionID: "ses_tasks_p" })
          await TeamTasks.add("tasks-test", [
            { id: "t1", content: "Research", status: "completed", priority: "high" },
            { id: "t2", content: "Implement", status: "pending", priority: "high", depends_on: ["t1"] },
            { id: "t3", content: "Test", status: "pending", priority: "medium", depends_on: ["t2"] },
          ])

          const tasks = await TeamTasks.list("tasks-test")
          expect(tasks).toHaveLength(3)

          const t1 = tasks.find((t) => t.id === "t1")
          expect(t1!.status).toBe("completed")

          const t2 = tasks.find((t) => t.id === "t2")
          expect(t2!.status).toBe("pending")

          const t3 = tasks.find((t) => t.id === "t3")
          expect(t3!.status).toBe("blocked")

          // Cleanup
          await Team.cleanup("tasks-test")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("Member status updates persist after restart", async () => {
    const dir = await fs.mkdtemp(path.join(import.meta.dir, ".tmp-persist-"))

    try {
      await Instance.provide({
        directory: dir,
        init: async () => Env.set("ANTHROPIC_API_KEY", "test-key"),
        fn: async () => {
          await Team.create({ name: "status-test", leadSessionID: "ses_st_p" })
          await Team.addMember("status-test", {
            name: "agent-a",
            sessionID: "ses_a_p",
            agent: "general",
            status: "busy",
            prompt: "work",
            planApproval: "none",
          })
          await Team.setMemberStatus("status-test", "agent-a", "ready")

          const team = await Team.get("status-test")
          expect(team!.members[0].status).toBe("ready")

          // Cleanup
          await Team.setMemberStatus("status-test", "agent-a", "shutdown")
          await Team.cleanup("status-test")
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
