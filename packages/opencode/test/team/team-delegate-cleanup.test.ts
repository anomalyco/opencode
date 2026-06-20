/**
 * Tests that delegate mode permissions are properly restored when a team
 * is cleaned up. Regression test for:
 *
 * Bug: Delegate mode restrictions persist on the lead session after team cleanup.
 * The lead session retains bash:deny, edit:deny etc. permanently because
 * Team.cleanup never revoked the deny rules it injected.
 */
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Team, WRITE_TOOLS } from "../../src/team"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { TeamCreateTool, TeamCleanupTool } from "../../src/tool/team"
import { Identifier } from "../../src/id/id"

Log.init({ print: false })

function mockCtx(sessionID: string) {
  return {
    sessionID,
    messageID: Identifier.ascending("message"),
    agent: "general",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => {},
  } as any
}

let counter = 0
function uniqueName(base: string): string {
  return `${base}-${Date.now()}-${++counter}`
}

describe("delegate mode cleanup restores permissions", () => {
  test("Team.cleanup removes delegate deny rules from lead session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const unsub = Team.onCleanedRestorePermissions()
        try {
          const lead = await Session.create({})

          // Verify lead session starts with no deny rules
          const before = await Session.get(lead.id)
          const denyBefore = (before.permission ?? []).filter((r) => r.action === "deny")
          expect(denyBefore.length).toBe(0)

          // Create team with delegate mode
          const name = uniqueName("delegate-cleanup")
          await Team.create({ name, leadSessionID: lead.id, delegate: true })

          // Manually inject delegate deny rules (same as TeamCreateTool does)
          await Session.update(lead.id, (draft) => {
            const rules = WRITE_TOOLS.map((tool) => ({
              permission: tool,
              pattern: "*",
              action: "deny" as const,
            }))
            draft.permission = [...(draft.permission ?? []), ...rules]
          })

          // Verify deny rules are present
          const during = await Session.get(lead.id)
          for (const tool of WRITE_TOOLS) {
            const denied = during.permission?.some((r) => r.permission === tool && r.action === "deny")
            expect(denied, `${tool} should be denied during team`).toBe(true)
          }

          // Cleanup the team — Bus.publish awaits all subscribers,
          // so permissions are restored before this returns.
          await Team.cleanup(name)

          // Verify deny rules are removed
          const after = await Session.get(lead.id)
          for (const tool of WRITE_TOOLS) {
            const denied = after.permission?.some((r) => r.permission === tool && r.action === "deny")
            expect(denied, `${tool} should NOT be denied after cleanup`).toBeFalsy()
          }
        } finally {
          unsub()
        }
      },
    })
  })

  test("Team.cleanup preserves non-delegate permissions on lead session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const unsub = Team.onCleanedRestorePermissions()
        try {
          const lead = await Session.create({})
          const name = uniqueName("delegate-preserve")

          // Add a custom allow rule before team creation
          await Session.update(lead.id, (draft) => {
            draft.permission = [{ permission: "read", pattern: "/safe/*", action: "allow" as const }]
          })

          // Create delegate team + inject deny rules
          await Team.create({ name, leadSessionID: lead.id, delegate: true })
          await Session.update(lead.id, (draft) => {
            const rules = WRITE_TOOLS.map((tool) => ({
              permission: tool,
              pattern: "*",
              action: "deny" as const,
            }))
            draft.permission = [...(draft.permission ?? []), ...rules]
          })

          // Cleanup — Bus.publish awaits all subscribers,
          // so permissions are restored before this returns.
          await Team.cleanup(name)

          // Custom allow rule should still be there
          const after = await Session.get(lead.id)
          const hasAllow = after.permission?.some(
            (r) => r.permission === "read" && r.pattern === "/safe/*" && r.action === "allow",
          )
          expect(hasAllow).toBe(true)

          // Delegate deny rules should be gone
          for (const tool of WRITE_TOOLS) {
            const denied = after.permission?.some((r) => r.permission === tool && r.action === "deny")
            expect(denied, `${tool} should NOT be denied after cleanup`).toBeFalsy()
          }
        } finally {
          unsub()
        }
      },
    })
  })

  test("Team.cleanup with delegate=false does not touch permissions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const name = uniqueName("no-delegate")

        // Add an existing deny rule unrelated to delegate
        await Session.update(lead.id, (draft) => {
          draft.permission = [{ permission: "bash", pattern: "rm -rf *", action: "deny" as const }]
        })

        // Create team WITHOUT delegate mode
        await Team.create({ name, leadSessionID: lead.id })

        // Cleanup
        await Team.cleanup(name)

        // The existing deny rule should still be there (cleanup only removes
        // delegate rules, and since delegate was false it shouldn't touch anything)
        const after = await Session.get(lead.id)
        const hasRule = after.permission?.some(
          (r) => r.permission === "bash" && r.pattern === "rm -rf *" && r.action === "deny",
        )
        expect(hasRule).toBe(true)
      },
    })
  })

  test("TeamCleanupTool reports delegate restriction removal in output", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const unsub = Team.onCleanedRestorePermissions()
        try {
          const lead = await Session.create({})
          const name = uniqueName("tool-delegate-msg")

          // Create delegate team via the tool
          const createTool = await TeamCreateTool.init()
          const createResult = await createTool.execute({ name, delegate: true }, mockCtx(lead.id))
          expect(createResult.output).toContain("DELEGATE MODE")

          // Verify deny rules are present
          const during = await Session.get(lead.id)
          expect(during.permission?.some((r) => r.permission === "bash" && r.action === "deny")).toBe(true)

          // Cleanup via the tool
          const cleanupTool = await TeamCleanupTool.init()
          const cleanupResult = await cleanupTool.execute({ name }, mockCtx(lead.id))
          expect(cleanupResult.output).toContain("Delegate mode restrictions have been removed")

          // Deny rules should be gone — Bus.publish awaits all subscribers
          const after = await Session.get(lead.id)
          for (const tool of WRITE_TOOLS) {
            const denied = after.permission?.some((r) => r.permission === tool && r.action === "deny")
            expect(denied, `${tool} should NOT be denied after cleanup`).toBeFalsy()
          }
        } finally {
          unsub()
        }
      },
    })
  })

  test("TeamCleanupTool without delegate does not mention restrictions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const name = uniqueName("tool-no-delegate-msg")

        // Create team without delegate
        const createTool = await TeamCreateTool.init()
        await createTool.execute({ name, delegate: false }, mockCtx(lead.id))

        // Cleanup via the tool
        const cleanupTool = await TeamCleanupTool.init()
        const cleanupResult = await cleanupTool.execute({ name }, mockCtx(lead.id))
        expect(cleanupResult.output).not.toContain("Delegate mode restrictions")
      },
    })
  })
})
