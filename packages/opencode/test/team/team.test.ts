import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Team, SessionPromptState } from "../../src/team"
import { TeamMessage } from "../../src/team/message"
import { TeamTask } from "../../src/team/task"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("team lifecycle", () => {
  test("create and cleanup a team", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: session.id })

        expect(team.name).toBe("test-team")
        expect(team.status).toBe("active")
        expect(team.leadSessionID).toBe(session.id)

        const updated = await Session.get(session.id)
        expect(updated.teamID).toBe(team.id)
        expect(updated.teamRole).toBe("lead")

        await Team.cleanup(team.id, session.id)
        const archived = await Team.get(team.id)
        expect(archived.status).toBe("archived")

        await Session.remove(session.id)
      },
    })
  })

  test("session cannot be in two teams", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        await Team.create({ name: "team-a", sessionID: session.id })

        await expect(Team.create({ name: "team-b", sessionID: session.id })).rejects.toThrow(
          "already in a team",
        )

        await Session.remove(session.id)
      },
    })
  })

  test("members returns all team members", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        const member = await Session.create({ teamID: team.id, teamRole: "member" })
        await Team.join(team.id, member.id)

        const members = await Team.members(team.id)
        expect(members.length).toBe(2)
        expect(members.find((m) => m.id === lead.id)?.team_role).toBe("lead")
        expect(members.find((m) => m.id === member.id)?.team_role).toBe("member")

        await Session.remove(member.id)
        await Session.remove(lead.id)
      },
    })
  })

  test("status returns team summary", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        await TeamTask.create({ teamID: team.id, title: "Task 1" })
        await TeamTask.create({ teamID: team.id, title: "Task 2" })

        const info = await Team.status(team.id)
        expect(info.name).toBe("test-team")
        expect(info.tasks.total).toBe(2)
        expect(info.tasks.pending).toBe(2)
        expect(info.members.length).toBe(1)

        await Session.remove(lead.id)
      },
    })
  })
})

describe("team task list", () => {
  test("create, claim, and complete tasks", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        const taskID = await TeamTask.create({ teamID: team.id, title: "Review auth" })
        const tasks = TeamTask.list(team.id)
        expect(tasks.length).toBe(1)
        expect(tasks[0].status).toBe("pending")

        const claimed = await TeamTask.claim(taskID, lead.id)
        expect(claimed.status).toBe("in_progress")
        expect(claimed.assigned_to).toBe(lead.id)

        const completed = await TeamTask.complete(taskID, lead.id)
        expect(completed.status).toBe("completed")

        await Session.remove(lead.id)
      },
    })
  })

  test("concurrent claim is atomic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        const member1 = await Session.create({ teamID: team.id, teamRole: "member" })
        const member2 = await Session.create({ teamID: team.id, teamRole: "member" })

        const taskID = await TeamTask.create({ teamID: team.id, title: "Shared task" })

        const results = await Promise.allSettled([
          TeamTask.claim(taskID, member1.id),
          TeamTask.claim(taskID, member2.id),
        ])

        const fulfilled = results.filter((r) => r.status === "fulfilled")
        const rejected = results.filter((r) => r.status === "rejected")
        expect(fulfilled.length).toBe(1)
        expect(rejected.length).toBe(1)

        await Session.remove(member1.id)
        await Session.remove(member2.id)
        await Session.remove(lead.id)
      },
    })
  })

  test("blocked task cannot be claimed", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        const task1 = await TeamTask.create({ teamID: team.id, title: "First" })
        const task2 = await TeamTask.create({
          teamID: team.id,
          title: "Second",
          depends_on: [task1],
        })

        await expect(TeamTask.claim(task2, lead.id)).rejects.toThrow("blocked")

        await TeamTask.claim(task1, lead.id)
        await TeamTask.complete(task1, lead.id)

        const claimed = await TeamTask.claim(task2, lead.id)
        expect(claimed.status).toBe("in_progress")

        await Session.remove(lead.id)
      },
    })
  })

  test("reassign tasks when teammate exits", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        const member = await Session.create({ teamID: team.id, teamRole: "member" })
        const taskID = await TeamTask.create({ teamID: team.id, title: "WIP task" })
        await TeamTask.claim(taskID, member.id)

        const reassigned = await TeamTask.reassign(member.id)
        expect(reassigned.length).toBe(1)
        expect(reassigned[0].status).toBe("pending")
        expect(reassigned[0].assigned_to).toBeNull()

        await Session.remove(member.id)
        await Session.remove(lead.id)
      },
    })
  })
})

describe("team messaging", () => {
  test("send and receive point-to-point message", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        const member = await Session.create({ teamID: team.id, teamRole: "member" })
        await Team.join(team.id, member.id)

        await TeamMessage.send({
          teamID: team.id,
          fromSessionID: lead.id,
          toSessionID: member.id,
          content: "Hello teammate",
        })

        const pending = TeamMessage.pending(member.id, team.id)
        expect(pending.length).toBe(1)
        expect(pending[0].content).toBe("Hello teammate")
        expect(pending[0].from_session_id).toBe(lead.id)

        TeamMessage.markRead(pending.map((m) => m.id))
        const after = TeamMessage.pending(member.id, team.id)
        expect(after.length).toBe(0)

        await Session.remove(member.id)
        await Session.remove(lead.id)
      },
    })
  })

  test("broadcast message reaches all members", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        const member1 = await Session.create({ teamID: team.id, teamRole: "member" })
        const member2 = await Session.create({ teamID: team.id, teamRole: "member" })

        await TeamMessage.broadcast({
          teamID: team.id,
          fromSessionID: lead.id,
          content: "Everyone wrap up",
        })

        const p1 = TeamMessage.pending(member1.id, team.id)
        const p2 = TeamMessage.pending(member2.id, team.id)
        expect(p1.length).toBe(1)
        expect(p2.length).toBe(1)
        expect(p1[0].content).toBe("Everyone wrap up")

        const selfPending = TeamMessage.pending(lead.id, team.id)
        expect(selfPending.length).toBe(0)

        await Session.remove(member1.id)
        await Session.remove(member2.id)
        await Session.remove(lead.id)
      },
    })
  })
})

describe("session team fields", () => {
  test("session create with team fields", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "test-team", sessionID: lead.id })

        const member = await Session.create({ teamID: team.id, teamRole: "member" })
        expect(member.teamID).toBe(team.id)
        expect(member.teamRole).toBe("member")

        const fetched = await Session.get(member.id)
        expect(fetched.teamID).toBe(team.id)
        expect(fetched.teamRole).toBe("member")

        await Session.remove(member.id)
        await Session.remove(lead.id)
      },
    })
  })
})
