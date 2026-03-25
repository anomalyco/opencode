import { describe, expect, test } from "bun:test"
import path from "path"
import { Team } from "../../src/team"
import { TeamTask } from "../../src/team/task"
import { TeamTaskID } from "../../src/team/schema"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

describe("TeamTask", () => {
  test("create returns a pending task", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const team = Team.create({ name: "task-team", sessionID: session.id })
        const task = TeamTask.create({ teamID: team.id, subject: "review spec" })

        expect(task.subject).toBe("review spec")
        expect(task.status).toBe("pending")
        expect(task.teamID).toBe(team.id)
        await Session.remove(session.id)
      },
    })
  })

  test("create with owner and metadata", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const team = Team.create({ name: "meta-team", sessionID: session.id })
        const task = TeamTask.create({
          teamID: team.id,
          subject: "check",
          owner: "clarity-reviewer",
          description: "Review for clarity",
          metadata: { priority: "high" },
        })

        expect(task.owner).toBe("clarity-reviewer")
        expect(task.description).toBe("Review for clarity")
        expect(task.metadata).toEqual({ priority: "high" })
        await Session.remove(session.id)
      },
    })
  })

  test("update changes status", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const team = Team.create({ name: "update-team", sessionID: session.id })
        const task = TeamTask.create({ teamID: team.id, subject: "updatable" })

        const updated = TeamTask.update(task.id, { status: "in_progress" })
        expect(updated).toBeDefined()
        expect(updated!.status).toBe("in_progress")
        await Session.remove(session.id)
      },
    })
  })

  test("update returns undefined for missing task", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const result = TeamTask.update(TeamTaskID.make("ttk_nope"), { status: "completed" })
        expect(result).toBeUndefined()
      },
    })
  })

  test("get returns task by id", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const team = Team.create({ name: "get-task-team", sessionID: session.id })
        const task = TeamTask.create({ teamID: team.id, subject: "gettable" })

        const found = TeamTask.get(task.id)
        expect(found).toBeDefined()
        expect(found!.subject).toBe("gettable")
        await Session.remove(session.id)
      },
    })
  })

  test("list returns all tasks for a team", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const team = Team.create({ name: "list-team", sessionID: session.id })
        TeamTask.create({ teamID: team.id, subject: "task-a" })
        TeamTask.create({ teamID: team.id, subject: "task-b" })
        TeamTask.create({ teamID: team.id, subject: "task-c" })

        const tasks = TeamTask.list(team.id)
        expect(tasks.length).toBe(3)
        expect(tasks.map((t) => t.subject).sort()).toEqual(["task-a", "task-b", "task-c"])
        await Session.remove(session.id)
      },
    })
  })

  test("disband cascades pending and in_progress tasks to failed", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const team = Team.create({ name: "cascade-team", sessionID: session.id })
        const pending = TeamTask.create({ teamID: team.id, subject: "pending-task" })
        const progress = TeamTask.create({ teamID: team.id, subject: "progress-task" })
        TeamTask.update(progress.id, { status: "in_progress" })
        const done = TeamTask.create({ teamID: team.id, subject: "done-task" })
        TeamTask.update(done.id, { status: "completed" })

        Team.disband(team.id)

        expect(TeamTask.get(pending.id)!.status).toBe("failed")
        expect(TeamTask.get(progress.id)!.status).toBe("failed")
        expect(TeamTask.get(done.id)!.status).toBe("completed")
        await Session.remove(session.id)
      },
    })
  })

  test("failMember cascades in-progress tasks owned by agent", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const team = Team.create({ name: "fail-cascade", sessionID: s1.id })
        Team.addMember({ teamID: team.id, sessionID: s2.id, agent: "worker" })

        const t1 = TeamTask.create({ teamID: team.id, subject: "owned", owner: "worker" })
        TeamTask.update(t1.id, { status: "in_progress" })
        const t2 = TeamTask.create({ teamID: team.id, subject: "other", owner: "someone-else" })
        TeamTask.update(t2.id, { status: "in_progress" })

        Team.failMember({ teamID: team.id, sessionID: s2.id, agent: "worker" })

        expect(TeamTask.get(t1.id)!.status).toBe("failed")
        expect(TeamTask.get(t2.id)!.status).toBe("in_progress")
        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })
})
