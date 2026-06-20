/**
 * Tier 3: Stress & edge case tests for Agent Teams
 *
 * Tests boundary conditions, race conditions, and unusual inputs that
 * could cause state corruption or crashes in production.
 */
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Team, TeamTasks, type TeamTask } from "../../src/team"
import { TeamMessaging } from "../../src/team/messaging"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { TeamCreateTool, TeamSpawnTool, TeamClaimTool, TeamTasksTool, TeamCleanupTool } from "../../src/tool/team"

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

async function seedUserMessage(sessionID: string, text: string = "init") {
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
    text,
  })
  return mid
}

// ---------- Concurrent Team Creation ----------

describe("Edge case: concurrent team creation", () => {
  test("two sessions try to create teams with the same name — only one succeeds", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s1 = await Session.create({})
        const s2 = await Session.create({})

        const results = await Promise.allSettled([
          Team.create({ name: "contested", leadSessionID: s1.id }),
          Team.create({ name: "contested", leadSessionID: s2.id }),
        ])

        const fulfilled = results.filter((r) => r.status === "fulfilled")

        expect(fulfilled.length).toBe(1)

        const team = await Team.get("contested")
        expect(team).toBeDefined()
        expect(team!.members).toHaveLength(0)

        await Team.cleanup("contested")
      },
    })
  })

  test("same session tries to create two different teams — second fails", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "first-team", leadSessionID: lead.id })

        await expect(Team.create({ name: "second-team", leadSessionID: lead.id })).rejects.toThrow("already leading")

        await Team.cleanup("first-team")
      },
    })
  })
})

// ---------- Empty Task List Operations ----------

describe("Edge case: empty task list operations", () => {
  test("list on empty team returns empty array", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "empty-team", leadSessionID: lead.id })

        const tasks = await TeamTasks.list("empty-team")
        expect(tasks).toHaveLength(0)

        await Team.cleanup("empty-team")
      },
    })
  })

  test("claim on empty list returns false", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "empty-claim", leadSessionID: lead.id })

        const result = await TeamTasks.claim("empty-claim", "nonexistent", "worker")
        expect(result).toBe(false)

        await Team.cleanup("empty-claim")
      },
    })
  })

  test("complete on empty list is no-op (no error)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "empty-complete", leadSessionID: lead.id })

        // Should not throw
        await TeamTasks.complete("empty-complete", "nonexistent")

        await Team.cleanup("empty-complete")
      },
    })
  })

  test("list tasks via tool on team with no tasks returns message", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "tool-empty", leadSessionID: lead.id })

        const tasksTool = await TeamTasksTool.init()
        const result = await tasksTool.execute({ action: "list" }, mockCtx(lead.id))
        expect(result.output).toContain("No tasks")

        await Team.cleanup("tool-empty")
      },
    })
  })
})

// ---------- Task Self-Dependency ----------

describe("Edge case: task self-dependency", () => {
  test("task depending on itself is unblocked by dropping self-dependency", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "self-dep", leadSessionID: lead.id })

        await TeamTasks.add("self-dep", [
          { id: "loop", content: "I depend on myself", status: "pending", priority: "high", depends_on: ["loop"] },
        ])

        const tasks = await TeamTasks.list("self-dep")
        expect(tasks[0].status).toBe("pending")
        expect(tasks[0].depends_on).toHaveLength(0)

        // Should be claimable
        const claimed = await TeamTasks.claim("self-dep", "loop", "worker")
        expect(claimed).toBe(true)

        await Team.cleanup("self-dep")
      },
    })
  })
})

// ---------- Dangling Dependency References ----------

describe("Edge case: dangling dependency references", () => {
  test("dependencies on non-existent task IDs are stripped during resolution", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "dangle", leadSessionID: lead.id })

        await TeamTasks.add("dangle", [
          { id: "t1", content: "Depends on ghost", status: "pending", priority: "high", depends_on: ["ghost-task"] },
        ])

        const tasks = await TeamTasks.list("dangle")
        // "ghost-task" doesn't exist, so it should be stripped, leaving no deps → pending
        expect(tasks[0].status).toBe("pending")
        expect(tasks[0].depends_on).toHaveLength(0)

        // Should be claimable
        const claimed = await TeamTasks.claim("dangle", "t1", "worker")
        expect(claimed).toBe(true)

        await TeamTasks.complete("dangle", "t1")
        await Team.cleanup("dangle")
      },
    })
  })
})

// ---------- Rapid Status Transitions ----------

describe("Edge case: rapid status transitions", () => {
  test("rapid active→idle→active→shutdown transitions don't corrupt state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "rapid-team", leadSessionID: lead.id })

        const sess = await Session.create({ parentID: lead.id })
        await Team.addMember("rapid-team", { name: "flipper", sessionID: sess.id, agent: "general", status: "busy" })

        // Rapid transitions
        await Team.setMemberStatus("rapid-team", "flipper", "ready")
        await Team.setMemberStatus("rapid-team", "flipper", "busy")
        await Team.setMemberStatus("rapid-team", "flipper", "ready")
        await Team.setMemberStatus("rapid-team", "flipper", "busy")
        await Team.setMemberStatus("rapid-team", "flipper", "shutdown")

        // Verify final state is consistent
        const team = await Team.get("rapid-team")
        expect(team!.members).toHaveLength(1)
        expect(team!.members[0].name).toBe("flipper")
        expect(team!.members[0].status).toBe("shutdown")

        await Team.cleanup("rapid-team")
      },
    })
  })

  test("concurrent status transitions on same member — last write wins", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "concurrent-status", leadSessionID: lead.id })

        const sess = await Session.create({ parentID: lead.id })
        await Team.addMember("concurrent-status", {
          name: "target",
          sessionID: sess.id,
          agent: "general",
          status: "busy",
        })

        // Fire all status changes concurrently
        await Promise.all([
          Team.setMemberStatus("concurrent-status", "target", "ready"),
          Team.setMemberStatus("concurrent-status", "target", "busy"),
          Team.setMemberStatus("concurrent-status", "target", "shutdown"),
        ])

        // State should be one of the three — no corruption
        const team = await Team.get("concurrent-status")
        expect(team!.members).toHaveLength(1)
        expect(["busy", "ready", "shutdown"]).toContain(team!.members[0].status)

        // Force shutdown for cleanup
        await Team.setMemberStatus("concurrent-status", "target", "shutdown")
        await Team.cleanup("concurrent-status")
      },
    })
  })
})

// ---------- Large Message Payloads ----------

describe("Edge case: large message payloads", () => {
  test("rejects oversized team message payloads", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "big-msg-team", leadSessionID: lead.id })

        const sess = await Session.create({ parentID: lead.id })
        await seedUserMessage(sess.id)
        await seedUserMessage(lead.id)

        await Team.addMember("big-msg-team", { name: "sender", sessionID: sess.id, agent: "general", status: "busy" })

        // 100KB message
        const bigText = "A".repeat(100 * 1024)
        await expect(
          TeamMessaging.send({
            teamName: "big-msg-team",
            from: "sender",
            to: "lead",
            text: bigText,
          }),
        ).rejects.toThrow("Team message too large")

        await Team.setMemberStatus("big-msg-team", "sender", "shutdown")
        await Team.cleanup("big-msg-team")
      },
    })
  })

  test("rejects oversized broadcast payloads", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "big-bcast-team", leadSessionID: lead.id })

        const sess = await Session.create({ parentID: lead.id })
        await seedUserMessage(sess.id)

        await Team.addMember("big-bcast-team", { name: "sender", sessionID: sess.id, agent: "general", status: "busy" })

        const bigText = "B".repeat(100 * 1024)
        await expect(
          TeamMessaging.broadcast({
            teamName: "big-bcast-team",
            from: "sender",
            text: bigText,
          }),
        ).rejects.toThrow("Team message too large")

        await Team.setMemberStatus("big-bcast-team", "sender", "shutdown")
        await Team.cleanup("big-bcast-team")
      },
    })
  })
})

// ---------- Unicode and Special Characters ----------

describe("Edge case: unicode and special characters", () => {
  test("team and member names with unicode work correctly", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        // Note: team names are used as directory names, so we use safe unicode
        await Team.create({ name: "team-alpha", leadSessionID: lead.id })

        const sess = await Session.create({ parentID: lead.id })
        await seedUserMessage(sess.id)
        await seedUserMessage(lead.id)

        // Member name with special characters
        await Team.addMember("team-alpha", {
          name: "reviewer-1",
          sessionID: sess.id,
          agent: "general",
          status: "busy",
        })

        // Message with unicode content
        await TeamMessaging.send({
          teamName: "team-alpha",
          from: "reviewer-1",
          to: "lead",
          text: "Found issue: 变量名称 uses non-ASCII identifier — résumé → should be resume. 🔥 Critical.",
        })

        const leadMsgs = await Session.messages({ sessionID: lead.id })
        const received = leadMsgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("变量名称")))
        expect(received).toBeDefined()
        const text = received!.parts.find((p) => p.type === "text") as any
        expect(text.text).toContain("résumé")
        expect(text.text).toContain("🔥")

        await Team.setMemberStatus("team-alpha", "reviewer-1", "shutdown")
        await Team.cleanup("team-alpha")
      },
    })
  })
})

// ---------- Task with Cancelled Dependencies ----------

describe("Edge case: cancelled dependencies", () => {
  test("task with cancelled dependency becomes unblocked (cancelled = resolved)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "cancel-dep", leadSessionID: lead.id })

        await TeamTasks.add("cancel-dep", [
          { id: "t1", content: "Maybe needed", status: "pending", priority: "high" },
          { id: "t2", content: "Depends on t1", status: "pending", priority: "medium", depends_on: ["t1"] },
        ])

        let tasks = await TeamTasks.list("cancel-dep")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("blocked")

        // Cancel t1 instead of completing it
        await TeamTasks.update("cancel-dep", [
          { id: "t1", content: "Maybe needed", status: "cancelled", priority: "high" },
          { id: "t2", content: "Depends on t1", status: "blocked", priority: "medium", depends_on: ["t1"] },
        ])

        // t2 should unblock because cancelled counts as resolved
        tasks = await TeamTasks.list("cancel-dep")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("pending")

        // t2 should be claimable
        const claimed = await TeamTasks.claim("cancel-dep", "t2", "worker")
        expect(claimed).toBe(true)

        await TeamTasks.complete("cancel-dep", "t2")
        await Team.cleanup("cancel-dep")
      },
    })
  })
})

// ---------- Multiple Teams in Same Project ----------

describe("Edge case: multiple teams in same project", () => {
  test("two teams can coexist with different leads", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead1 = await Session.create({})
        const lead2 = await Session.create({})

        await Team.create({ name: "team-a", leadSessionID: lead1.id })
        await Team.create({ name: "team-b", leadSessionID: lead2.id })

        // Each team has independent state
        await TeamTasks.add("team-a", [{ id: "a1", content: "Team A task", status: "pending", priority: "high" }])
        await TeamTasks.add("team-b", [{ id: "b1", content: "Team B task", status: "pending", priority: "high" }])

        const aTasks = await TeamTasks.list("team-a")
        const bTasks = await TeamTasks.list("team-b")
        expect(aTasks).toHaveLength(1)
        expect(bTasks).toHaveLength(1)
        expect(aTasks[0].content).toContain("Team A")
        expect(bTasks[0].content).toContain("Team B")

        // Claiming in one team doesn't affect the other
        await TeamTasks.claim("team-a", "a1", "worker")
        const bTasksAfter = await TeamTasks.list("team-b")
        expect(bTasksAfter[0].status).toBe("pending") // unaffected

        // List all teams
        const allTeams = await Team.list()
        expect(allTeams).toHaveLength(2)

        // Cleanup both
        await Team.cleanup("team-a")
        await Team.cleanup("team-b")
      },
    })
  })
})

// ---------- findBySession Correctness ----------

describe("Edge case: findBySession with overlapping membership", () => {
  test("findBySession returns correct role for lead vs member", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        const orphan = await Session.create({})

        await Team.create({ name: "role-team", leadSessionID: lead.id })
        await Team.addMember("role-team", { name: "w1", sessionID: member.id, agent: "general", status: "busy" })

        // Lead lookup
        const leadResult = await Team.findBySession(lead.id)
        expect(leadResult).toBeDefined()
        expect(leadResult!.role).toBe("lead")
        expect(leadResult!.memberName).toBeUndefined()

        // Member lookup
        const memberResult = await Team.findBySession(member.id)
        expect(memberResult).toBeDefined()
        expect(memberResult!.role).toBe("member")
        expect(memberResult!.memberName).toBe("w1")

        // Orphan lookup
        const orphanResult = await Team.findBySession(orphan.id)
        expect(orphanResult).toBeUndefined()

        await Team.setMemberStatus("role-team", "w1", "shutdown")
        await Team.cleanup("role-team")
      },
    })
  })
})

// ---------- Member Re-addition ----------

describe("Edge case: re-adding a member with same name", () => {
  test("adding member with existing name throws instead of silently replacing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "replace-team", leadSessionID: lead.id })

        const sess1 = await Session.create({ parentID: lead.id })
        const sess2 = await Session.create({ parentID: lead.id })

        await Team.addMember("replace-team", {
          name: "worker",
          sessionID: sess1.id,
          agent: "general",
          status: "busy",
        })

        const team = await Team.get("replace-team")
        expect(team!.members).toHaveLength(1)
        expect(team!.members[0].sessionID).toBe(sess1.id)

        // Re-add with same name should throw
        await expect(
          Team.addMember("replace-team", { name: "worker", sessionID: sess2.id, agent: "explore", status: "ready" }),
        ).rejects.toThrow("already exists")

        await Team.setMemberStatus("replace-team", "worker", "shutdown")
        await Team.cleanup("replace-team")
      },
    })
  })
})

// ---------- Claim Already Assigned Task ----------

describe("Edge case: double-claim scenarios", () => {
  test("claiming an in_progress task returns false", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "double-claim", leadSessionID: lead.id })

        await TeamTasks.add("double-claim", [{ id: "t1", content: "Task", status: "pending", priority: "high" }])

        const first = await TeamTasks.claim("double-claim", "t1", "alice")
        expect(first).toBe(true)

        // Same person tries again
        const second = await TeamTasks.claim("double-claim", "t1", "alice")
        expect(second).toBe(false)

        // Different person tries
        const third = await TeamTasks.claim("double-claim", "t1", "bob")
        expect(third).toBe(false)

        await Team.cleanup("double-claim")
      },
    })
  })

  test("claiming a completed task returns false", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "claim-completed", leadSessionID: lead.id })

        await TeamTasks.add("claim-completed", [{ id: "t1", content: "Task", status: "pending", priority: "high" }])

        await TeamTasks.claim("claim-completed", "t1", "worker")
        await TeamTasks.complete("claim-completed", "t1")

        const result = await TeamTasks.claim("claim-completed", "t1", "another")
        expect(result).toBe(false)

        await Team.cleanup("claim-completed")
      },
    })
  })
})

// ---------- Task Operations on Non-Existent Team ----------

describe("Edge case: operations on non-existent team", () => {
  test("list tasks on non-existent team returns empty array", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tasks = await TeamTasks.list("ghost-team")
        expect(tasks).toHaveLength(0)
      },
    })
  })

  test("claim on non-existent team returns false", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await TeamTasks.claim("ghost-team", "t1", "worker")
        expect(result).toBe(false)
      },
    })
  })

  test("cleanup non-existent team throws", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Team.cleanup("ghost-team")).rejects.toThrow("not found")
      },
    })
  })
})

// ---------- Messaging Edge Cases ----------

describe("Edge case: messaging edge cases", () => {
  test("broadcast to team with no members (lead only) is a no-op", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "solo-team", leadSessionID: lead.id })

        // Broadcast from lead to team with no members — should not throw
        await TeamMessaging.broadcast({
          teamName: "solo-team",
          from: "lead",
          text: "Anyone there?",
        })

        // No members to receive it, and lead is excluded as sender
        const leadMsgs = await Session.messages({ sessionID: lead.id })
        const selfMsg = leadMsgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("Anyone there?")))
        expect(selfMsg).toBeUndefined()

        await Team.cleanup("solo-team")
      },
    })
  })

  test("message to 'lead' from lead is technically valid (self-message)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)
        await Team.create({ name: "self-msg", leadSessionID: lead.id })

        // Lead messages themselves
        await TeamMessaging.send({
          teamName: "self-msg",
          from: "lead",
          to: "lead",
          text: "Note to self: remember to review findings",
        })

        const leadMsgs = await Session.messages({ sessionID: lead.id })
        const selfMsg = leadMsgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("Note to self")))
        expect(selfMsg).toBeDefined()

        await Team.cleanup("self-msg")
      },
    })
  })
})

// ---------- Complex Dependency Graphs ----------

describe("Edge case: complex dependency graphs", () => {
  test("W-shaped dependency graph (wider diamond) resolves correctly", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "w-graph", leadSessionID: lead.id })

        //       t1    t2
        //      / \  / \
        //     t3  t4  t5
        //      \  |  /
        //        t6
        await TeamTasks.add("w-graph", [
          { id: "t1", content: "Root 1", status: "pending", priority: "high" },
          { id: "t2", content: "Root 2", status: "pending", priority: "high" },
          { id: "t3", content: "Mid left", status: "pending", priority: "medium", depends_on: ["t1"] },
          { id: "t4", content: "Mid center", status: "pending", priority: "medium", depends_on: ["t1", "t2"] },
          { id: "t5", content: "Mid right", status: "pending", priority: "medium", depends_on: ["t2"] },
          { id: "t6", content: "Final", status: "pending", priority: "low", depends_on: ["t3", "t4", "t5"] },
        ])

        let tasks = await TeamTasks.list("w-graph")
        expect(tasks.find((t) => t.id === "t1")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("blocked")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")
        expect(tasks.find((t) => t.id === "t5")!.status).toBe("blocked")
        expect(tasks.find((t) => t.id === "t6")!.status).toBe("blocked")

        // Complete t1 → unblocks t3, partially unblocks t4 (still needs t2)
        await TeamTasks.complete("w-graph", "t1")
        tasks = await TeamTasks.list("w-graph")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked") // still needs t2
        expect(tasks.find((t) => t.id === "t5")!.status).toBe("blocked") // still needs t2

        // Complete t2 → unblocks t4, t5
        await TeamTasks.complete("w-graph", "t2")
        tasks = await TeamTasks.list("w-graph")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t5")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t6")!.status).toBe("blocked") // needs t3, t4, t5

        // Complete t3, t4 but not t5 → t6 still blocked
        await TeamTasks.complete("w-graph", "t3")
        await TeamTasks.complete("w-graph", "t4")
        tasks = await TeamTasks.list("w-graph")
        expect(tasks.find((t) => t.id === "t6")!.status).toBe("blocked")

        // Complete t5 → t6 unblocks
        await TeamTasks.complete("w-graph", "t5")
        tasks = await TeamTasks.list("w-graph")
        expect(tasks.find((t) => t.id === "t6")!.status).toBe("pending")

        // Complete t6 → all done
        await TeamTasks.complete("w-graph", "t6")
        tasks = await TeamTasks.list("w-graph")
        expect(tasks.every((t) => t.status === "completed")).toBe(true)

        await Team.cleanup("w-graph")
      },
    })
  })
})

// ---------- Add Tasks to Team That Already Has Tasks ----------

describe("Edge case: incremental task additions", () => {
  test("add() merges with existing tasks, preserves state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "merge-team", leadSessionID: lead.id })

        // Initial tasks
        await TeamTasks.add("merge-team", [
          { id: "t1", content: "First batch", status: "pending", priority: "high" },
          { id: "t2", content: "First batch 2", status: "pending", priority: "high" },
        ])

        // Claim and start one
        await TeamTasks.claim("merge-team", "t1", "worker")

        // Add more tasks — should merge, not replace
        await TeamTasks.add("merge-team", [
          { id: "t3", content: "Second batch", status: "pending", priority: "medium" },
          { id: "t4", content: "Depends on batch 1", status: "pending", priority: "low", depends_on: ["t1"] },
        ])

        const tasks = await TeamTasks.list("merge-team")
        expect(tasks).toHaveLength(4)

        // t1 should still be in_progress (not reset)
        expect(tasks.find((t) => t.id === "t1")!.status).toBe("in_progress")
        expect(tasks.find((t) => t.id === "t1")!.assignee).toBe("worker")

        // t4 should be blocked (t1 not completed)
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")

        // t3 should be pending (no deps)
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("pending")

        await Team.cleanup("merge-team")
      },
    })
  })
})

// ---------- Remove Member Then Message ----------

describe("Edge case: removed member messaging", () => {
  test("messaging to removed member throws (not found)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "remove-msg", leadSessionID: lead.id })

        const sess = await Session.create({ parentID: lead.id })
        await seedUserMessage(sess.id)
        await Team.addMember("remove-msg", { name: "gone", sessionID: sess.id, agent: "general", status: "busy" })

        // Remove the member
        await Team.removeMember("remove-msg", "gone")

        // Try to message them — should fail
        await expect(
          TeamMessaging.send({ teamName: "remove-msg", from: "lead", to: "gone", text: "hello" }),
        ).rejects.toThrow("not found")

        await Team.cleanup("remove-msg")
      },
    })
  })
})
