import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Team, TeamTasks } from "../../src/team"
import { Session } from "../../src/session"
import { Env } from "../../src/env"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const projectRoot = path.join(__dirname, "../..")

// Generate unique team names per test run to avoid state leakage
let counter = 0
function uniqueName(base: string): string {
  return `${base}-${Date.now()}-${++counter}`
}

describe("Team REST API routes", () => {
  // ---------- GET /team ----------
  describe("GET /team", () => {
    test("returns an array", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const app = Server.App()
          const response = await app.request("/team")
          expect(response.status).toBe(200)
          const body = await response.json()
          expect(Array.isArray(body)).toBe(true)
        },
      })
    })

    test("returns teams after creation", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const name = uniqueName("rt-list")
          const session = await Session.create({})
          await Team.create({ name, leadSessionID: session.id })

          const app = Server.App()
          const response = await app.request("/team")
          expect(response.status).toBe(200)
          const body = (await response.json()) as any[]
          const found = body.find((t: any) => t.name === name)
          expect(found).toBeDefined()
          expect(found.leadSessionID).toBe(session.id)

          await Team.cleanup(name)
        },
      })
    })
  })

  // ---------- GET /team/:name ----------
  describe("GET /team/:name", () => {
    test("returns 404 for non-existent team", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const app = Server.App()
          const response = await app.request("/team/does-not-exist-ever")
          expect(response.status).toBe(404)
          const body = (await response.json()) as any
          expect(body.error).toBe("Team not found")
        },
      })
    })

    test("returns team by name", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const name = uniqueName("rt-get")
          const session = await Session.create({})
          await Team.create({ name, leadSessionID: session.id })

          const app = Server.App()
          const response = await app.request(`/team/${name}`)
          expect(response.status).toBe(200)
          const body = (await response.json()) as any
          expect(body.name).toBe(name)
          expect(body.leadSessionID).toBe(session.id)
          expect(Array.isArray(body.members)).toBe(true)

          await Team.cleanup(name)
        },
      })
    })
  })

  // ---------- GET /team/:name/tasks ----------
  describe("GET /team/:name/tasks", () => {
    test("returns empty task list for team with no tasks", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const name = uniqueName("rt-tasks-empty")
          const session = await Session.create({})
          await Team.create({ name, leadSessionID: session.id })

          const app = Server.App()
          const response = await app.request(`/team/${name}/tasks`)
          expect(response.status).toBe(200)
          const body = (await response.json()) as any[]
          expect(Array.isArray(body)).toBe(true)
          expect(body.length).toBe(0)

          await Team.cleanup(name)
        },
      })
    })

    test("returns tasks after adding them", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const name = uniqueName("rt-tasks-add")
          const session = await Session.create({})
          await Team.create({ name, leadSessionID: session.id })
          await TeamTasks.add(name, [
            {
              id: "task-1",
              content: "Review auth module",
              status: "pending",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Fix lint errors",
              status: "in_progress",
              priority: "medium",
              assignee: "reviewer-1",
            },
          ])

          const app = Server.App()
          const response = await app.request(`/team/${name}/tasks`)
          expect(response.status).toBe(200)
          const body = (await response.json()) as any[]
          expect(body.length).toBe(2)

          const t1 = body.find((t: any) => t.id === "task-1")
          expect(t1).toBeDefined()
          expect(t1.content).toBe("Review auth module")
          expect(t1.status).toBe("pending")
          expect(t1.priority).toBe("high")

          const t2 = body.find((t: any) => t.id === "task-2")
          expect(t2).toBeDefined()
          expect(t2.assignee).toBe("reviewer-1")
          expect(t2.status).toBe("in_progress")

          await Team.cleanup(name)
        },
      })
    })

    test("returns empty array for non-existent team tasks", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const app = Server.App()
          const response = await app.request("/team/no-such-team-xyz/tasks")
          expect(response.status).toBe(200)
          const body = (await response.json()) as any[]
          expect(Array.isArray(body)).toBe(true)
          expect(body.length).toBe(0)
        },
      })
    })
  })

  // ---------- GET /team/by-session/:sessionID ----------
  describe("GET /team/by-session/:sessionID", () => {
    test("returns null for session not in any team", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const app = Server.App()
          const response = await app.request("/team/by-session/ses_not_in_any_team_xyz")
          expect(response.status).toBe(200)
          const body = await response.json()
          expect(body).toBeNull()
        },
      })
    })

    test("returns team context for lead session", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const name = uniqueName("rt-bysess-lead")
          const session = await Session.create({})
          await Team.create({ name, leadSessionID: session.id })
          await TeamTasks.add(name, [
            {
              id: "task-a",
              content: "Do something",
              status: "pending",
              priority: "medium",
            },
          ])

          const app = Server.App()
          const response = await app.request(`/team/by-session/${session.id}`)
          expect(response.status).toBe(200)
          const body = (await response.json()) as any
          expect(body).not.toBeNull()
          expect(body.team.name).toBe(name)
          expect(body.role).toBe("lead")
          expect(body.memberName).toBeUndefined()
          expect(Array.isArray(body.tasks)).toBe(true)
          expect(body.tasks.length).toBe(1)
          expect(body.tasks[0].id).toBe("task-a")

          await Team.cleanup(name)
        },
      })
    })

    test("returns team context for member session", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const name = uniqueName("rt-bysess-member")
          const leadSession = await Session.create({})
          const memberSession = await Session.create({ parentID: leadSession.id })
          await Team.create({ name, leadSessionID: leadSession.id })
          await Team.addMember(name, {
            name: "reviewer",
            sessionID: memberSession.id,
            agent: "general",
            status: "busy",
          })

          const app = Server.App()
          const response = await app.request(`/team/by-session/${memberSession.id}`)
          expect(response.status).toBe(200)
          const body = (await response.json()) as any
          expect(body).not.toBeNull()
          expect(body.team.name).toBe(name)
          expect(body.role).toBe("member")
          expect(body.memberName).toBe("reviewer")

          await Team.setMemberStatus(name, "reviewer", "shutdown")
          await Team.cleanup(name)
        },
      })
    })

    test("includes tasks in by-session response", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const name = uniqueName("rt-bysess-tasks")
          const session = await Session.create({})
          await Team.create({ name, leadSessionID: session.id })
          await TeamTasks.add(name, [
            {
              id: "t1",
              content: "Task one",
              status: "pending",
              priority: "high",
            },
            {
              id: "t2",
              content: "Task two",
              status: "completed",
              priority: "low",
            },
          ])

          const app = Server.App()
          const response = await app.request(`/team/by-session/${session.id}`)
          const body = (await response.json()) as any
          expect(body.tasks.length).toBe(2)
          const ids = body.tasks.map((t: any) => t.id).sort()
          expect(ids).toEqual(["t1", "t2"])

          await Team.cleanup(name)
        },
      })
    })
  })

  // ---------- Integration: full lifecycle via routes ----------
  describe("full lifecycle", () => {
    test("create team, add tasks, add member, query by-session, verify cleanup", async () => {
      await Instance.provide({
        directory: projectRoot,
        init: async () => {
          Env.set("ANTHROPIC_API_KEY", "test-key")
        },
        fn: async () => {
          const name = uniqueName("rt-lifecycle")
          const app = Server.App()

          // Create team + sessions
          const leadSession = await Session.create({})
          const memberSession = await Session.create({ parentID: leadSession.id })
          await Team.create({ name, leadSessionID: leadSession.id })
          await Team.addMember(name, {
            name: "worker-1",
            sessionID: memberSession.id,
            agent: "build",
            status: "busy",
          })
          await TeamTasks.add(name, [
            {
              id: "lc-task-1",
              content: "Build feature X",
              status: "pending",
              priority: "high",
            },
            {
              id: "lc-task-2",
              content: "Write tests for X",
              status: "pending",
              priority: "medium",
              depends_on: ["lc-task-1"],
            },
          ])

          // Claim task
          const claimed = await TeamTasks.claim(name, "lc-task-1", "worker-1")
          expect(claimed).toBe(true)

          // Verify via routes
          // 1. List teams
          const listResp = await app.request("/team")
          const teams = (await listResp.json()) as any[]
          expect(teams.find((t: any) => t.name === name)).toBeDefined()

          // 2. Get team
          const getResp = await app.request(`/team/${name}`)
          const team = (await getResp.json()) as any
          expect(team.members.length).toBe(1)
          expect(team.members[0].name).toBe("worker-1")

          // 3. Get tasks - verify claim and dependency
          const tasksResp = await app.request(`/team/${name}/tasks`)
          const tasks = (await tasksResp.json()) as any[]
          const t1 = tasks.find((t: any) => t.id === "lc-task-1")
          expect(t1.status).toBe("in_progress")
          expect(t1.assignee).toBe("worker-1")
          const t2 = tasks.find((t: any) => t.id === "lc-task-2")
          expect(t2.status).toBe("blocked")
          expect(t2.depends_on).toEqual(["lc-task-1"])

          // 4. By-session for lead
          const leadResp = await app.request(`/team/by-session/${leadSession.id}`)
          const leadCtx = (await leadResp.json()) as any
          expect(leadCtx.role).toBe("lead")
          expect(leadCtx.tasks.length).toBe(2)

          // 5. By-session for member
          const memberResp = await app.request(`/team/by-session/${memberSession.id}`)
          const memberCtx = (await memberResp.json()) as any
          expect(memberCtx.role).toBe("member")
          expect(memberCtx.memberName).toBe("worker-1")

          // 6. Complete task-1 and verify task-2 is unblocked
          await TeamTasks.complete(name, "lc-task-1")
          const tasksResp2 = await app.request(`/team/${name}/tasks`)
          const tasks2 = (await tasksResp2.json()) as any[]
          const t1After = tasks2.find((t: any) => t.id === "lc-task-1")
          expect(t1After.status).toBe("completed")
          const t2After = tasks2.find((t: any) => t.id === "lc-task-2")
          expect(t2After.status).toBe("pending") // unblocked

          // Shutdown member before cleanup
          await Team.setMemberStatus(name, "worker-1", "shutdown")
          await Team.cleanup(name)

          // 7. Verify cleaned up
          const afterCleanup = await app.request(`/team/${name}`)
          expect(afterCleanup.status).toBe(404)
        },
      })
    })
  })
})
