import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Team, TeamTasks } from "../../src/team"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Identifier } from "../../src/id/id"
import { TeamSpawnTool } from "../../src/tool/team"
import { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

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
  return mid
}

const BASE_DENY_PERMISSIONS = ["team_create", "team_spawn", "team_shutdown", "team_cleanup", "team_approve_plan"]

const WRITE_TOOLS = ["bash", "write", "edit", "multiedit", "apply_patch"]

describe("TeamSpawnTool.execute", () => {
  // ── Error: non-lead (member) trying to spawn ──────────────────────

  test("member session cannot spawn — returns 'not the lead' error", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "spawn-guard", leadSessionID: lead.id })

        const member = await Session.create({ parentID: lead.id })
        await Team.addMember("spawn-guard", {
          name: "worker",
          sessionID: member.id,
          agent: "general",
          status: "busy",
        })

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute({ name: "new-mate", prompt: "do stuff" }, mockCtx(member.id))

        expect(result.title).toBe("Error")
        expect(result.output).toContain("Only the team lead")

        await Team.setMemberStatus("spawn-guard", "worker", "shutdown")
        await Team.cleanup("spawn-guard")
      },
    })
  })

  // ── Error: session not in any team ────────────────────────────────

  test("session not in any team — returns 'not the lead' error", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const orphan = await Session.create({})

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute({ name: "teammate", prompt: "work" }, mockCtx(orphan.id))

        expect(result.title).toBe("Error")
        expect(result.output).toContain("not the lead of any team")
      },
    })
  })

  // ── Error: invalid agent name ─────────────────────────────────────

  test("invalid agent name — returns error listing available agents", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "agent-err", leadSessionID: lead.id })

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute(
          { name: "mate", agent: "nonexistent-agent-xyz", prompt: "work" },
          mockCtx(lead.id),
        )

        expect(result.title).toBe("Error")
        expect(result.output).toContain('"nonexistent-agent-xyz" not found')
        expect(result.output).toContain("Available agents:")

        await Team.cleanup("agent-err")
      },
    })
  })

  // ── Model resolution: explicit valid model ────────────────────────

  test("explicit valid model param — uses it", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "model-explicit", leadSessionID: lead.id })

        // Discover a valid model from the anthropic provider
        const providers = await Provider.list()
        const anthropic = Object.values(providers).find((p) => p.id === "anthropic")
        if (!anthropic) {
          // Skip if no anthropic provider available (no API key in test env)
          await Team.cleanup("model-explicit")
          return
        }
        const validModel = Object.keys(anthropic.models)[0]
        const modelStr = `anthropic/${validModel}`

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute({ name: "explicit-model", prompt: "work", model: modelStr }, mockCtx(lead.id))

        expect(result.title).toContain("Spawned teammate")
        expect(result.metadata.model).toBe(modelStr)

        await Team.setMemberStatus("model-explicit", "explicit-model", "shutdown")
        await Team.cleanup("model-explicit")
      },
    })
  })

  // ── Model resolution: explicit invalid model ──────────────────────

  test("explicit invalid model param — returns error with suggestions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "model-invalid", leadSessionID: lead.id })

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute(
          { name: "bad-model", prompt: "work", model: "anthropic/nonexistent-model-abc" },
          mockCtx(lead.id),
        )

        expect(result.title).toBe("Error")
        expect(result.output).toContain("Model not found")
        expect(result.output).toContain("anthropic/nonexistent-model-abc")

        await Team.cleanup("model-invalid")
      },
    })
  })

  // ── Model resolution: fallback to lead's model from messages ──────

  test("no model param, no agent model — falls back to lead's model from messages", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "model-fallback", leadSessionID: lead.id })

        // Build ctx.messages with a user message carrying the lead's model
        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [{ type: "text", text: "hello" }],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute({ name: "fallback-mate", prompt: "work" }, mockCtx(lead.id, messages))

        expect(result.title).toContain("Spawned teammate")
        expect(result.metadata.model).toBe("anthropic/claude-3-5-sonnet-20241022")

        await Team.setMemberStatus("model-fallback", "fallback-mate", "shutdown")
        await Team.cleanup("model-fallback")
      },
    })
  })

  // ── Permission rules: basic spawn ─────────────────────────────────

  test("basic spawn — child session has base deny rules", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "perm-basic", leadSessionID: lead.id })

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute({ name: "perm-mate", prompt: "work" }, mockCtx(lead.id, messages))

        expect(result.title).toContain("Spawned teammate")

        const childSession = await Session.get(result.metadata.sessionID)
        expect(childSession).toBeDefined()
        expect(childSession.permission).toBeDefined()

        // All base deny rules must be present
        for (const perm of BASE_DENY_PERMISSIONS) {
          expect(childSession.permission).toContainEqual({
            permission: perm,
            pattern: "*",
            action: "deny",
          })
        }

        // Write tools should NOT be denied in basic spawn
        for (const tool of WRITE_TOOLS) {
          const match = childSession.permission!.find((r: any) => r.permission === tool && r.action === "deny")
          expect(match).toBeUndefined()
        }

        await Team.setMemberStatus("perm-basic", "perm-mate", "shutdown")
        await Team.cleanup("perm-basic")
      },
    })
  })

  // ── Permission rules: require_plan_approval ───────────────────────

  test("spawn with require_plan_approval — write tools also denied", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "perm-plan", leadSessionID: lead.id })

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute(
          { name: "plan-mate", prompt: "research first", require_plan_approval: true },
          mockCtx(lead.id, messages),
        )

        expect(result.title).toContain("Spawned teammate")

        const childSession = await Session.get(result.metadata.sessionID)
        expect(childSession.permission).toBeDefined()

        // Base deny rules
        for (const perm of BASE_DENY_PERMISSIONS) {
          expect(childSession.permission).toContainEqual({
            permission: perm,
            pattern: "*",
            action: "deny",
          })
        }

        // Write tools MUST be denied when plan approval is required (tagged pattern)
        for (const wt of WRITE_TOOLS) {
          expect(childSession.permission).toContainEqual({
            permission: wt,
            pattern: "*:plan-approval",
            action: "deny",
          })
        }

        await Team.setMemberStatus("perm-plan", "plan-mate", "shutdown")
        await Team.cleanup("perm-plan")
      },
    })
  })

  // ── Child session: parentID is set to lead's sessionID ────────────

  test("child session parentID is set to the lead's sessionID", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "parent-check", leadSessionID: lead.id })

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute({ name: "child-mate", prompt: "work" }, mockCtx(lead.id, messages))

        const childSession = await Session.get(result.metadata.sessionID)
        expect(childSession.parentID).toBe(lead.id)

        await Team.setMemberStatus("parent-check", "child-mate", "shutdown")
        await Team.cleanup("parent-check")
      },
    })
  })

  // ── Team context injection: user message in child session ─────────

  test("child session gets seeded user message with team context", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "ctx-team", leadSessionID: lead.id })

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute(
          { name: "ctx-mate", agent: "general", prompt: "analyze the auth module" },
          mockCtx(lead.id, messages),
        )

        // Read messages in the child session
        const childMsgs = await Session.messages({ sessionID: result.metadata.sessionID })
        expect(childMsgs.length).toBeGreaterThanOrEqual(1)

        const userMsg = childMsgs.find((m) => m.info.role === "user")
        expect(userMsg).toBeDefined()

        const textPart = userMsg!.parts.find((p) => p.type === "text") as any
        expect(textPart).toBeDefined()
        expect(textPart.text).toContain('"ctx-mate"')
        expect(textPart.text).toContain('"ctx-team"')
        expect(textPart.text).toContain('"general"')
        expect(textPart.text).toContain("analyze the auth module")

        await Team.setMemberStatus("ctx-team", "ctx-mate", "shutdown")
        await Team.cleanup("ctx-team")
      },
    })
  })

  // ── Auto-claim: spawn with claim_task ─────────────────────────────

  test("spawn with claim_task — task is claimed for the new member", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "claim-spawn", leadSessionID: lead.id })

        await TeamTasks.add("claim-spawn", [
          { id: "t1", content: "Auth module review", status: "pending", priority: "high" },
          { id: "t2", content: "API testing", status: "pending", priority: "medium" },
        ])

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute(
          { name: "claimer", prompt: "review auth", claim_task: "t1" },
          mockCtx(lead.id, messages),
        )

        expect(result.title).toContain("Spawned teammate")
        expect(result.output).toContain("Auto-claimed task: t1")

        // Verify the task was actually claimed
        const tasks = await TeamTasks.list("claim-spawn")
        const t1 = tasks.find((t) => t.id === "t1")
        expect(t1!.status).toBe("in_progress")
        expect(t1!.assignee).toBe("claimer")

        // t2 should still be pending
        const t2 = tasks.find((t) => t.id === "t2")
        expect(t2!.status).toBe("pending")

        await Team.setMemberStatus("claim-spawn", "claimer", "shutdown")
        await Team.cleanup("claim-spawn")
      },
    })
  })

  // ── Return value: metadata fields ─────────────────────────────────

  test("return value contains expected metadata fields", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "meta-team", leadSessionID: lead.id })

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute({ name: "meta-mate", prompt: "work" }, mockCtx(lead.id, messages))

        expect(result.metadata.teamName).toBe("meta-team")
        expect(result.metadata.memberName).toBe("meta-mate")
        expect(result.metadata.sessionID).toBeDefined()
        expect(result.metadata.sessionID).toMatch(/^ses_/)
        expect(result.metadata.model).toBe("anthropic/claude-3-5-sonnet-20241022")

        await Team.setMemberStatus("meta-team", "meta-mate", "shutdown")
        await Team.cleanup("meta-team")
      },
    })
  })

  // ── Member registration: member appears in team config ────────────

  test("spawned teammate is registered as active member", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "reg-team", leadSessionID: lead.id })

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute(
          { name: "reg-mate", agent: "general", prompt: "work" },
          mockCtx(lead.id, messages),
        )

        const team = await Team.get("reg-team")
        expect(team).toBeDefined()
        expect(team!.members).toHaveLength(1)

        const member = team!.members[0]
        expect(member.name).toBe("reg-mate")
        expect(member.sessionID).toBe(result.metadata.sessionID)
        expect(member.agent).toBe("general")
        expect(member.status).toBe("busy")
        expect(member.model).toBe("anthropic/claude-3-5-sonnet-20241022")

        // Verify the child session exists as a child of the lead
        const childSession = await Session.get(member.sessionID)
        expect(childSession).toBeDefined()

        await Team.setMemberStatus("reg-team", "reg-mate", "shutdown")
        await Team.cleanup("reg-team")
      },
    })
  })

  // ── Plan approval metadata on member ──────────────────────────────

  test("require_plan_approval sets planApproval to 'pending' on member", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "plan-meta", leadSessionID: lead.id })

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute(
          { name: "plan-mate", prompt: "research", require_plan_approval: true },
          mockCtx(lead.id, messages),
        )

        expect(result.metadata.planApproval).toBe(true)

        const team = await Team.get("plan-meta")
        const member = team!.members.find((m) => m.name === "plan-mate")
        expect(member).toBeDefined()
        expect(member!.planApproval).toBe("pending")

        await Team.setMemberStatus("plan-meta", "plan-mate", "shutdown")
        await Team.cleanup("plan-meta")
      },
    })
  })

  // ── Default agent: omitting agent defaults to "general" ───────────

  test("omitting agent param defaults to 'general'", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "default-agent", leadSessionID: lead.id })

        const messages = [
          {
            info: {
              role: "user",
              model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            },
            parts: [],
          },
        ]

        const tool = await TeamSpawnTool.init()
        const result = await tool.execute({ name: "default-mate", prompt: "work" }, mockCtx(lead.id, messages))

        expect(result.title).toContain("Spawned teammate")

        const team = await Team.get("default-agent")
        const member = team!.members.find((m) => m.name === "default-mate")
        expect(member!.agent).toBe("general")

        await Team.setMemberStatus("default-agent", "default-mate", "shutdown")
        await Team.cleanup("default-agent")
      },
    })
  })
})
