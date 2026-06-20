import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Team, TeamTasks } from "../../src/team"
import { Session } from "../../src/session"
import { Env } from "../../src/env"
import { Log } from "../../src/util/log"
import { Identifier } from "../../src/id/id"
import { TeamApprovePlanTool } from "../../src/tool/team"
import { Bus } from "../../src/bus"
import { TeamEvent } from "../../src/team/events"
import { Server } from "../../src/server/server"

Log.init({ print: false })
const projectRoot = path.join(__dirname, "../..")

let counter = 0
function uniqueName(base: string): string {
  return `${base}-${Date.now()}-${++counter}`
}

const WRITE_TOOLS = ["bash", "write", "edit", "multiedit", "apply_patch"] as const

function denyWriteRules() {
  return WRITE_TOOLS.map((tool) => ({
    permission: tool,
    pattern: "*:plan-approval",
    action: "deny" as const,
  }))
}

/** Permission rules applied to every teammate (lead-only tool denials) */
function baseMemberDenyRules() {
  return [
    { permission: "team_create", pattern: "*", action: "deny" as const },
    { permission: "team_spawn", pattern: "*", action: "deny" as const },
    { permission: "team_shutdown", pattern: "*", action: "deny" as const },
    { permission: "team_cleanup", pattern: "*", action: "deny" as const },
    { permission: "team_approve_plan", pattern: "*", action: "deny" as const },
    { permission: "todowrite", pattern: "*", action: "deny" as const },
    { permission: "todoread", pattern: "*", action: "deny" as const },
  ]
}

function mockCtx(sessionID: string, messages: any[] = []) {
  return {
    sessionID,
    messageID: Identifier.ascending("message"),
    agent: "general",
    abort: new AbortController().signal,
    messages,
    metadata: () => {},
    ask: async () => {},
  } as any
}

/** Seed a user message so TeamMessaging.send can find agent/model on the session. */
async function seedUserMessage(sessionID: string) {
  const mid = Identifier.ascending("message")
  await Session.updateMessage({
    id: mid,
    sessionID,
    role: "user",
    agent: "general",
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: mid,
    sessionID,
    type: "text",
    text: "init",
  })
}

// ---------------------------------------------------------------------------
// 1. TeamApprovePlanTool.execute()
// ---------------------------------------------------------------------------
describe("TeamApprovePlanTool.execute", () => {
  test("approve: unlocks write permissions, sets approved, sends message, publishes event", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("approve-ok")

        // 1. Create lead session and team
        const leadSession = await Session.create({})
        await Team.create({ name, leadSessionID: leadSession.id })
        await seedUserMessage(leadSession.id)

        // 2. Create child session with WRITE_TOOLS denied (plan-approval mode)
        const childPermissions = [...baseMemberDenyRules(), ...denyWriteRules()]
        const childSession = await Session.create({
          parentID: leadSession.id,
          title: "planner [plan mode]",
          permission: childPermissions,
        })
        await seedUserMessage(childSession.id)

        // 3. Register member with planApproval: "pending"
        await Team.addMember(name, {
          name: "planner",
          sessionID: childSession.id,
          agent: "general",
          status: "busy",
          planApproval: "pending",
        })

        // 4. Subscribe to Bus event before calling execute
        let busEvent: any = null
        const unsub = Bus.subscribe(TeamEvent.PlanApproval, (evt) => {
          busEvent = evt.properties
        })

        // 5. Execute approval
        const tool = await TeamApprovePlanTool.init()
        const result = await tool.execute(
          { name: "planner", approved: true, feedback: "Looks good!" },
          mockCtx(leadSession.id),
        )

        // 6. Verify return value
        expect(result.title).toContain("approved")
        expect(result.output).toContain("Approved")
        expect(result.output).toContain("Write tools are now unlocked")
        expect(result.metadata.approved).toBe(true)

        // 7. Verify session permissions: plan-approval deny rules removed
        const updated = await Session.get(childSession.id)
        const planRules = updated.permission?.filter((r) => r.pattern === "*:plan-approval")
        expect(planRules?.length ?? 0).toBe(0)
        // Base member deny rules should still be present
        expect(updated.permission?.some((r) => r.permission === "team_create" && r.action === "deny")).toBe(true)

        // 8. Verify member planApproval updated
        const team = await Team.get(name)
        const member = team!.members.find((m) => m.name === "planner")
        expect(member!.planApproval).toBe("approved")

        // 9. Verify Bus event
        expect(busEvent).not.toBeNull()
        expect(busEvent.teamName).toBe(name)
        expect(busEvent.memberName).toBe("planner")
        expect(busEvent.approved).toBe(true)
        expect(busEvent.feedback).toBe("Looks good!")

        unsub()
        await Team.setMemberStatus(name, "planner", "shutdown")
        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("reject: keeps read-only, sets rejected then pending, sends message, publishes event", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("reject-ok")

        const leadSession = await Session.create({})
        await Team.create({ name, leadSessionID: leadSession.id })
        await seedUserMessage(leadSession.id)

        const childPermissions = [...baseMemberDenyRules(), ...denyWriteRules()]
        const childSession = await Session.create({
          parentID: leadSession.id,
          title: "planner [plan mode]",
          permission: childPermissions,
        })
        await seedUserMessage(childSession.id)

        await Team.addMember(name, {
          name: "planner",
          sessionID: childSession.id,
          agent: "general",
          status: "busy",
          planApproval: "pending",
        })

        let busEvent: any = null
        const unsub = Bus.subscribe(TeamEvent.PlanApproval, (evt) => {
          busEvent = evt.properties
        })

        const tool = await TeamApprovePlanTool.init()
        const result = await tool.execute(
          { name: "planner", approved: false, feedback: "Needs more detail" },
          mockCtx(leadSession.id),
        )

        // Verify return value
        expect(result.title).toContain("rejected")
        expect(result.output).toContain("Rejected")
        expect(result.output).toContain("read-only")
        expect(result.metadata.approved).toBe(false)

        // Verify session permissions: plan-approval deny rules still present
        const updated = await Session.get(childSession.id)
        const planRules = updated.permission?.filter((r) => r.pattern === "*:plan-approval")
        expect(planRules!.length).toBe(WRITE_TOOLS.length)

        // Verify member planApproval is "rejected" (stays rejected until teammate resubmits)
        const team = await Team.get(name)
        const member = team!.members.find((m) => m.name === "planner")
        expect(member!.planApproval).toBe("rejected")

        // Verify Bus event
        expect(busEvent).not.toBeNull()
        expect(busEvent.approved).toBe(false)
        expect(busEvent.feedback).toBe("Needs more detail")

        unsub()
        await Team.setMemberStatus(name, "planner", "shutdown")
        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("error: non-lead session cannot approve plans", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("non-lead")

        const leadSession = await Session.create({})
        await Team.create({ name, leadSessionID: leadSession.id })

        const memberSession = await Session.create({ parentID: leadSession.id })
        await Team.addMember(name, {
          name: "worker",
          sessionID: memberSession.id,
          agent: "general",
          status: "busy",
          planApproval: "pending",
        })

        const tool = await TeamApprovePlanTool.init()

        // Member tries to approve — should fail
        const result = await tool.execute({ name: "worker", approved: true }, mockCtx(memberSession.id))

        expect(result.title).toBe("Error")
        expect(result.output).toContain("Only the team lead")

        await Team.setMemberStatus(name, "worker", "shutdown")
        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("error: session not in any team", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const tool = await TeamApprovePlanTool.init()
        const result = await tool.execute({ name: "nobody", approved: true }, mockCtx("ses_orphan_" + Date.now()))

        expect(result.title).toBe("Error")
        expect(result.output).toContain("Only the team lead")
      },
    })
  })

  test("error: member not found", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("member-404")
        const leadSession = await Session.create({})
        await Team.create({ name, leadSessionID: leadSession.id })

        const tool = await TeamApprovePlanTool.init()
        const result = await tool.execute({ name: "ghost", approved: true }, mockCtx(leadSession.id))

        expect(result.title).toBe("Error")
        expect(result.output).toContain('Teammate "ghost" not found')

        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("error: member not in pending state", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("not-pending")
        const leadSession = await Session.create({})
        await Team.create({ name, leadSessionID: leadSession.id })

        const memberSession = await Session.create({ parentID: leadSession.id })
        await Team.addMember(name, {
          name: "already-approved",
          sessionID: memberSession.id,
          agent: "general",
          status: "busy",
          planApproval: "approved",
        })

        const tool = await TeamApprovePlanTool.init()
        const result = await tool.execute({ name: "already-approved", approved: true }, mockCtx(leadSession.id))

        expect(result.title).toBe("Error")
        expect(result.output).toContain("not awaiting plan approval")

        await Team.setMemberStatus(name, "already-approved", "shutdown")
        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("error: member with planApproval 'none' cannot be approved", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("plan-none")
        const leadSession = await Session.create({})
        await Team.create({ name, leadSessionID: leadSession.id })

        const memberSession = await Session.create({ parentID: leadSession.id })
        await Team.addMember(name, {
          name: "no-plan",
          sessionID: memberSession.id,
          agent: "general",
          status: "busy",
          planApproval: "none",
        })

        const tool = await TeamApprovePlanTool.init()
        const result = await tool.execute({ name: "no-plan", approved: true }, mockCtx(leadSession.id))

        expect(result.title).toBe("Error")
        expect(result.output).toContain("not awaiting plan approval")

        await Team.setMemberStatus(name, "no-plan", "shutdown")
        await Team.cleanup(name).catch(() => {})
      },
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Team.setMemberPlanApproval() — state transitions
// ---------------------------------------------------------------------------
describe("Team.setMemberPlanApproval", () => {
  test("none → pending", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("plan-state-np")
        await Team.create({ name, leadSessionID: "ses_lead_" + Date.now() })
        await Team.addMember(name, {
          name: "w",
          sessionID: "ses_w_" + Date.now(),
          agent: "general",
          status: "busy",
          planApproval: "none",
        })

        await Team.setMemberPlanApproval(name, "w", "pending")
        const team = await Team.get(name)
        expect(team!.members[0].planApproval).toBe("pending")

        await Team.setMemberStatus(name, "w", "shutdown")
        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("pending → approved", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("plan-state-pa")
        await Team.create({ name, leadSessionID: "ses_lead_" + Date.now() })
        await Team.addMember(name, {
          name: "w",
          sessionID: "ses_w_" + Date.now(),
          agent: "general",
          status: "busy",
          planApproval: "pending",
        })

        await Team.setMemberPlanApproval(name, "w", "approved")
        const team = await Team.get(name)
        expect(team!.members[0].planApproval).toBe("approved")

        await Team.setMemberStatus(name, "w", "shutdown")
        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("pending → rejected → pending (round-trip)", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("plan-state-prp")
        await Team.create({ name, leadSessionID: "ses_lead_" + Date.now() })
        await Team.addMember(name, {
          name: "w",
          sessionID: "ses_w_" + Date.now(),
          agent: "general",
          status: "busy",
          planApproval: "pending",
        })

        await Team.setMemberPlanApproval(name, "w", "rejected")
        let team = await Team.get(name)
        expect(team!.members[0].planApproval).toBe("rejected")

        await Team.setMemberPlanApproval(name, "w", "pending")
        team = await Team.get(name)
        expect(team!.members[0].planApproval).toBe("pending")

        await Team.setMemberStatus(name, "w", "shutdown")
        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("non-existent team → silent return", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        // Should not throw
        await Team.setMemberPlanApproval("no-such-team-" + Date.now(), "w", "approved")
      },
    })
  })

  test("non-existent member → silent return", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("plan-no-member")
        await Team.create({ name, leadSessionID: "ses_lead_" + Date.now() })

        // Should not throw
        await Team.setMemberPlanApproval(name, "ghost", "approved")

        await Team.cleanup(name).catch(() => {})
      },
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Team.setDelegate() — delegate mode
// ---------------------------------------------------------------------------
describe("Team.setDelegate", () => {
  test("toggle on: team.delegate = true persisted", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("delegate-on")
        await Team.create({ name, leadSessionID: "ses_lead_" + Date.now() })

        await Team.setDelegate(name, true)
        const team = await Team.get(name)
        expect(team!.delegate).toBe(true)

        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("toggle off: team.delegate = false persisted", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("delegate-off")
        await Team.create({ name, leadSessionID: "ses_lead_" + Date.now(), delegate: true })

        let team = await Team.get(name)
        expect(team!.delegate).toBe(true)

        await Team.setDelegate(name, false)
        team = await Team.get(name)
        expect(team!.delegate).toBe(false)

        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("non-existent team → silent return", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        // Should not throw
        await Team.setDelegate("no-such-team-" + Date.now(), true)
      },
    })
  })
})

// ---------------------------------------------------------------------------
// 4. POST /team/:name/delegate route — HTTP endpoint
// ---------------------------------------------------------------------------
describe("POST /team/:name/delegate route", () => {
  test("toggle on: adds WRITE_TOOLS deny rules to lead session permissions", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("route-delegate-on")
        const leadSession = await Session.create({})
        await Team.create({ name, leadSessionID: leadSession.id })

        const app = Server.App()
        const response = await app.request(`/team/${name}/delegate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as any
        expect(body.ok).toBe(true)
        expect(body.delegate).toBe(true)

        // Verify session permissions have WRITE_TOOLS deny rules
        const session = await Session.get(leadSession.id)
        for (const t of WRITE_TOOLS) {
          const hasDeny = session.permission?.some((r) => r.permission === t && r.action === "deny")
          expect(hasDeny).toBe(true)
        }

        // Verify team config updated
        const team = await Team.get(name)
        expect(team!.delegate).toBe(true)

        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("toggle off: removes WRITE_TOOLS deny rules from lead session", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const name = uniqueName("route-delegate-off")
        const leadSession = await Session.create({})
        await Team.create({ name, leadSessionID: leadSession.id, delegate: true })

        // First add deny rules via toggle on
        const app = Server.App()
        await app.request(`/team/${name}/delegate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        })

        // Verify deny rules are present
        let session = await Session.get(leadSession.id)
        expect(session.permission?.some((r) => r.permission === "bash" && r.action === "deny")).toBe(true)

        // Now toggle off
        const response = await app.request(`/team/${name}/delegate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as any
        expect(body.ok).toBe(true)
        expect(body.delegate).toBe(false)

        // Verify WRITE_TOOLS deny rules removed
        session = await Session.get(leadSession.id)
        for (const t of WRITE_TOOLS) {
          const hasDeny = session.permission?.some((r) => r.permission === t && r.action === "deny")
          expect(hasDeny).toBeFalsy()
        }

        // Verify team config updated
        const team = await Team.get(name)
        expect(team!.delegate).toBe(false)

        await Team.cleanup(name).catch(() => {})
      },
    })
  })

  test("404 for non-existent team", async () => {
    await Instance.provide({
      directory: projectRoot,
      init: async () => {
        Env.set("ANTHROPIC_API_KEY", "test-key")
      },
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/team/does-not-exist-ever/delegate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        })

        expect(response.status).toBe(404)
        const body = (await response.json()) as any
        expect(body.error).toBe("Team not found")
      },
    })
  })
})
