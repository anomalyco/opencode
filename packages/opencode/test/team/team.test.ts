import { describe, expect, test } from "bun:test"
import path from "path"
import { Team } from "../../src/team"
import { TeamID } from "../../src/team/schema"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Team", () => {
  test("create returns active team with lead member", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const team = Team.create({ name: "test-team", sessionID: session.id })
        expect(team.name).toBe("test-team")
        expect(team.status).toBe("active")
        expect(team.sessionID).toBe(session.id)

        const lead = Team.leadSession(team.id)
        expect(lead).toBeDefined()
        expect(lead!.role).toBe("lead")
        expect(lead!.agent).toBe("lead")
        expect(lead!.status).toBe("active")
        await Session.remove(session.id)
      },
    })
  })

  test("create emits Created event", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        let received: Team.Info | undefined
        const unsub = Bus.subscribe(Team.Event.Created, (e) => {
          received = e.properties.team
        })
        const team = Team.create({ name: "evt-team", sessionID: session.id })
        await new Promise((r) => setTimeout(r, 50))
        unsub()
        expect(received).toBeDefined()
        expect(received!.id).toBe(team.id)
        await Session.remove(session.id)
      },
    })
  })

  test("get returns team by id", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const team = Team.create({ name: "get-team", sessionID: session.id })
        const found = Team.get(team.id)
        expect(found).toBeDefined()
        expect(found!.id).toBe(team.id)
        expect(found!.name).toBe("get-team")
        await Session.remove(session.id)
      },
    })
  })

  test("get returns undefined for missing team", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const found = Team.get(TeamID.make("tem_nonexistent"))
        expect(found).toBeUndefined()
      },
    })
  })

  test("addMember adds a member to the team", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const team = Team.create({ name: "member-team", sessionID: s1.id })
        const member = Team.addMember({ teamID: team.id, sessionID: s2.id, agent: "reviewer" })

        expect(member.agent).toBe("reviewer")
        expect(member.role).toBe("member")
        expect(member.status).toBe("active")

        const all = Team.members(team.id)
        expect(all.length).toBe(2) // lead + member
        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })

  test("addMember disambiguates duplicate agent names", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const s3 = await Session.create({})
        const s4 = await Session.create({})
        const team = Team.create({ name: "dup-team", sessionID: s1.id })
        const m1 = Team.addMember({ teamID: team.id, sessionID: s2.id, agent: "general" })
        const m2 = Team.addMember({ teamID: team.id, sessionID: s3.id, agent: "general" })
        const m3 = Team.addMember({ teamID: team.id, sessionID: s4.id, agent: "general" })

        expect(m1.agent).toBe("general")
        expect(m2.agent).toBe("general-2")
        expect(m3.agent).toBe("general-3")
        await Session.remove(s1.id)
        await Session.remove(s2.id)
        await Session.remove(s3.id)
        await Session.remove(s4.id)
      },
    })
  })

  test("addMember rejects disbanded team", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const team = Team.create({ name: "dead-team", sessionID: s1.id })
        Team.disband(team.id)
        expect(() => Team.addMember({ teamID: team.id, sessionID: s2.id, agent: "x" })).toThrow(
          "Cannot add member to disbanded team",
        )
        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })

  test("addMember rejects nonexistent team", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        expect(() => Team.addMember({ teamID: TeamID.make("tem_nope"), sessionID: s1.id, agent: "x" })).toThrow(
          "Team not found",
        )
        await Session.remove(s1.id)
      },
    })
  })

  test("disband sets team disbanded and members cancelled", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const team = Team.create({ name: "disband-team", sessionID: s1.id })
        Team.addMember({ teamID: team.id, sessionID: s2.id, agent: "worker" })

        Team.disband(team.id)

        const found = Team.get(team.id)
        expect(found!.status).toBe("disbanded")

        const all = Team.members(team.id)
        for (const m of all) {
          expect(m.status).toBe("cancelled")
        }
        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })

  test("completeMember marks active member as completed", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const team = Team.create({ name: "complete-team", sessionID: s1.id })
        Team.addMember({ teamID: team.id, sessionID: s2.id, agent: "worker" })

        Team.completeMember(s2.id)

        const member = Team.findMemberSession({ teamID: team.id, agent: "worker" })
        expect(member!.status).toBe("completed")
        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })

  test("failMember marks member as failed", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const team = Team.create({ name: "fail-team", sessionID: s1.id })
        Team.addMember({ teamID: team.id, sessionID: s2.id, agent: "crasher" })

        Team.failMember({ teamID: team.id, sessionID: s2.id, agent: "crasher" })

        const member = Team.findMemberSession({ teamID: team.id, agent: "crasher" })
        expect(member!.status).toBe("failed")
        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })

  test("disbandBySession disbands all active teams for a session", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const t1 = Team.create({ name: "dbs-1", sessionID: s1.id })
        const t2 = Team.create({ name: "dbs-2", sessionID: s1.id })

        Team.disbandBySession(s1.id)

        expect(Team.get(t1.id)!.status).toBe("disbanded")
        expect(Team.get(t2.id)!.status).toBe("disbanded")
        await Session.remove(s1.id)
      },
    })
  })

  test("reconcile disbands all stale active teams", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const t1 = Team.create({ name: "stale-1", sessionID: s1.id })
        const t2 = Team.create({ name: "stale-2", sessionID: s2.id })

        Team.reconcile()

        expect(Team.get(t1.id)!.status).toBe("disbanded")
        expect(Team.get(t2.id)!.status).toBe("disbanded")
        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })

  test("findMemberSession returns member by agent name", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})
        const team = Team.create({ name: "find-team", sessionID: s1.id })
        Team.addMember({ teamID: team.id, sessionID: s2.id, agent: "finder" })

        const found = Team.findMemberSession({ teamID: team.id, agent: "finder" })
        expect(found).toBeDefined()
        expect(found!.sessionID).toBe(s2.id)

        const missing = Team.findMemberSession({ teamID: team.id, agent: "nonexistent" })
        expect(missing).toBeUndefined()
        await Session.remove(s1.id)
        await Session.remove(s2.id)
      },
    })
  })
})
