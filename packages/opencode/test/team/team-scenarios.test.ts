/**
 * Tier 1: Sophisticated mock-server E2E scenarios for Agent Teams
 *
 * These tests exercise complex multi-teammate orchestration patterns inspired
 * by Claude Code's documented use cases (parallel code review, competing
 * hypotheses, cross-layer coordination, error recovery, cleanup safety).
 *
 * Uses Bun.serve() mock Anthropic SSE server so SessionPrompt.loop() runs
 * without hitting real APIs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Team, TeamTasks, type TeamTask } from "../../src/team"
import { TeamMessaging } from "../../src/team/messaging"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"
import { Bus } from "../../src/bus"
import { TeamEvent } from "../../src/team/events"
import { tmpdir } from "../fixture/fixture"
import {
  TeamCreateTool,
  TeamSpawnTool,
  TeamMessageTool,
  TeamBroadcastTool,
  TeamTasksTool,
  TeamClaimTool,
  TeamShutdownTool,
  TeamCleanupTool,
} from "../../src/tool/team"

Log.init({ print: false })

// ---------- Mock Anthropic SSE server ----------

/** Track requests per-test to verify which sessions hit the API */
const serverState = {
  server: null as ReturnType<typeof Bun.serve> | null,
  requestLog: [] as Array<{ body: any; timestamp: number }>,
  /** Per-session response queues: sessionID (from x-session-id header or body) -> Response[] */
  responseQueues: new Map<string, Response[]>(),
  /** Default response for any request without a queued response */
  defaultResponse: null as (() => Response) | null,
}

function anthropicSSE(text: string) {
  const chunks = [
    {
      type: "message_start",
      message: {
        id: "msg-" + Math.random().toString(36).slice(2),
        model: "claude-3-5-sonnet-20241022",
        usage: { input_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null, container: null },
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
    { type: "message_stop" },
  ]
  const payload = chunks.map((c) => `event: ${c.type}\ndata: ${JSON.stringify(c)}`).join("\n\n") + "\n\n"
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )
}

beforeAll(() => {
  serverState.server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Log the request
      let body: any = null
      try {
        body = await req.clone().json()
      } catch {}
      serverState.requestLog.push({ body, timestamp: Date.now() })

      // Return default response (simple text)
      return anthropicSSE("Done.")
    },
  })
})

beforeEach(() => {
  serverState.requestLog.length = 0
  serverState.responseQueues.clear()
  serverState.defaultResponse = null
})

afterAll(() => {
  serverState.server?.stop()
})

// ---------- Helpers ----------

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

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 30000,
  intervalMs: number = 100,
  description: string = "condition",
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

function makeInstance(server: ReturnType<typeof Bun.serve>) {
  return async (dir: string) => {
    await Bun.write(
      path.join(dir, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        enabled_providers: ["anthropic"],
        provider: {
          anthropic: {
            options: {
              apiKey: "test-anthropic-key",
              baseURL: `${server.url.origin}/v1`,
            },
          },
        },
      }),
    )
  }
}

// ---------- Scenario 1: Parallel Code Review ----------

describe("Scenario 1: Parallel code review — 3 reviewers, 6 tasks", () => {
  test("three reviewers spawned concurrently, each claim and complete 2 tasks, all idle with notifications", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create lead and team with 6 tasks (2 per reviewer domain)
        const lead = await Session.create({})
        await seedUserMessage(lead.id, "Coordinate a parallel code review")

        const createTool = await TeamCreateTool.init()
        await createTool.execute(
          {
            name: "review-team",
            tasks: [
              { id: "sec-1", content: "Review auth token handling for security vulnerabilities", priority: "high" },
              { id: "sec-2", content: "Check input validation and SQL injection vectors", priority: "high" },
              { id: "perf-1", content: "Profile database query performance in user endpoints", priority: "medium" },
              { id: "perf-2", content: "Analyze memory allocation patterns in event loop", priority: "medium" },
              { id: "test-1", content: "Verify unit test coverage for auth module", priority: "medium" },
              { id: "test-2", content: "Check integration test coverage for API endpoints", priority: "low" },
            ],
          },
          mockCtx(lead.id),
        )

        // Verify initial task state
        let tasks = await TeamTasks.list("review-team")
        expect(tasks).toHaveLength(6)
        expect(tasks.every((t) => t.status === "pending")).toBe(true)

        // Spawn 3 reviewers concurrently via the tool
        const spawnTool = await TeamSpawnTool.init()
        const leadMsgs = await Session.messages({ sessionID: lead.id })

        const [secResult, perfResult, testResult] = await Promise.all([
          spawnTool.execute(
            { name: "security-reviewer", agent: "general", prompt: "Review for security issues", claim_task: "sec-1" },
            mockCtx(lead.id, leadMsgs),
          ),
          spawnTool.execute(
            { name: "perf-reviewer", agent: "general", prompt: "Review for performance issues", claim_task: "perf-1" },
            mockCtx(lead.id, leadMsgs),
          ),
          spawnTool.execute(
            { name: "test-reviewer", agent: "general", prompt: "Review test coverage", claim_task: "test-1" },
            mockCtx(lead.id, leadMsgs),
          ),
        ])

        // Verify all 3 spawned
        expect(secResult.title).toContain("Spawned")
        expect(perfResult.title).toContain("Spawned")
        expect(testResult.title).toContain("Spawned")

        // Verify 3 auto-claimed tasks
        tasks = await TeamTasks.list("review-team")
        const claimed = tasks.filter((t) => t.status === "in_progress")
        expect(claimed).toHaveLength(3)
        expect(claimed.map((t) => t.assignee).sort()).toEqual(["perf-reviewer", "security-reviewer", "test-reviewer"])

        // Wait for all 3 to go idle (their SessionPrompt.loop() hits mock server and finishes)
        const allIdle = await waitFor(
          async () => {
            const team = await Team.get("review-team")
            return team!.members.every((m) => m.status === "ready")
          },
          30000,
          200,
          "all 3 reviewers idle",
        )
        expect(allIdle).toBe(true)

        // Now simulate each reviewer completing their tasks and claiming the next
        // (In real usage the LLM would call these tools, but here we call them directly
        //  to exercise the task coordination logic that the loop can't reach with mock server)
        const team = await Team.get("review-team")!

        // Each reviewer completes task 1 and claims task 2
        await TeamTasks.complete("review-team", "sec-1")
        await TeamTasks.claim("review-team", "sec-2", "security-reviewer")
        await TeamTasks.complete("review-team", "perf-1")
        await TeamTasks.claim("review-team", "perf-2", "perf-reviewer")
        await TeamTasks.complete("review-team", "test-1")
        await TeamTasks.claim("review-team", "test-2", "test-reviewer")

        // Complete remaining tasks
        await TeamTasks.complete("review-team", "sec-2")
        await TeamTasks.complete("review-team", "perf-2")
        await TeamTasks.complete("review-team", "test-2")

        // Verify all 6 tasks completed
        tasks = await TeamTasks.list("review-team")
        expect(tasks.every((t) => t.status === "completed")).toBe(true)

        // Simulate each reviewer sending findings to lead
        await TeamMessaging.send({
          teamName: "review-team",
          from: "security-reviewer",
          to: "lead",
          text: "Found XSS vulnerability in user profile endpoint and weak token rotation",
        })
        await TeamMessaging.send({
          teamName: "review-team",
          from: "perf-reviewer",
          to: "lead",
          text: "N+1 query in /users endpoint, 300ms p99 latency. Memory leak in WebSocket handler.",
        })
        await TeamMessaging.send({
          teamName: "review-team",
          from: "test-reviewer",
          to: "lead",
          text: "Auth module has 42% coverage, needs 60%+. API integration tests missing for PUT/DELETE.",
        })

        // Verify lead received all 3 findings + 3 idle notifications = 6 team messages
        const leadMsgsAfter = await Session.messages({ sessionID: lead.id })
        const teamMessages = leadMsgsAfter.filter((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from")),
        )
        // 3 idle notifications + 3 finding messages
        expect(teamMessages.length).toBeGreaterThanOrEqual(6)

        // Verify content of findings
        const allText = teamMessages.flatMap((m) => m.parts.filter((p) => p.type === "text").map((p: any) => p.text))
        expect(allText.some((t: string) => t.includes("XSS vulnerability"))).toBe(true)
        expect(allText.some((t: string) => t.includes("N+1 query"))).toBe(true)
        expect(allText.some((t: string) => t.includes("42% coverage"))).toBe(true)

        // Cleanup
        for (const m of (await Team.get("review-team"))!.members) {
          await Team.setMemberStatus("review-team", m.name, "shutdown")
        }
        await Team.cleanup("review-team")
      },
    })
  })
})

// ---------- Scenario 2: Self-Claim Waterfall ----------

describe("Scenario 2: Self-claim waterfall — single worker cascading through dependency chain", () => {
  test("worker completes t1, claims t2 (now unblocked), cascades through 4-deep chain", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)

        const createTool = await TeamCreateTool.init()
        await createTool.execute(
          {
            name: "waterfall-team",
            tasks: [
              { id: "t1", content: "Define API schema", priority: "high" },
              { id: "t2", content: "Implement endpoints", priority: "high", depends_on: ["t1"] },
              { id: "t3", content: "Write integration tests", priority: "medium", depends_on: ["t2"] },
              { id: "t4", content: "Deploy to staging", priority: "low", depends_on: ["t3"] },
            ],
          },
          mockCtx(lead.id),
        )

        // Verify cascade: only t1 is claimable, rest blocked
        let tasks = await TeamTasks.list("waterfall-team")
        expect(tasks.find((t) => t.id === "t1")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("blocked")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("blocked")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")

        // Spawn worker and auto-claim t1
        const spawnTool = await TeamSpawnTool.init()
        const leadMsgs = await Session.messages({ sessionID: lead.id })
        const spawnResult = await spawnTool.execute(
          { name: "worker", agent: "general", prompt: "Complete all tasks in order", claim_task: "t1" },
          mockCtx(lead.id, leadMsgs),
        )
        expect(spawnResult.title).toContain("Spawned")

        // Worker cascades through the chain
        // Step 1: complete t1 → t2 unblocks
        await TeamTasks.complete("waterfall-team", "t1")
        tasks = await TeamTasks.list("waterfall-team")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("blocked")

        // Step 2: claim and complete t2 → t3 unblocks
        const claimed2 = await TeamTasks.claim("waterfall-team", "t2", "worker")
        expect(claimed2).toBe(true)
        await TeamTasks.complete("waterfall-team", "t2")
        tasks = await TeamTasks.list("waterfall-team")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")

        // Step 3: claim and complete t3 → t4 unblocks
        const claimed3 = await TeamTasks.claim("waterfall-team", "t3", "worker")
        expect(claimed3).toBe(true)
        await TeamTasks.complete("waterfall-team", "t3")
        tasks = await TeamTasks.list("waterfall-team")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("pending")

        // Step 4: claim and complete t4 → all done
        const claimed4 = await TeamTasks.claim("waterfall-team", "t4", "worker")
        expect(claimed4).toBe(true)
        await TeamTasks.complete("waterfall-team", "t4")
        tasks = await TeamTasks.list("waterfall-team")
        expect(tasks.every((t) => t.status === "completed")).toBe(true)

        // Verify no tasks left pending or blocked
        expect(tasks.filter((t) => t.status === "pending" || t.status === "blocked")).toHaveLength(0)

        // Verify worker cannot claim already-completed tasks
        const reClaim = await TeamTasks.claim("waterfall-team", "t1", "worker")
        expect(reClaim).toBe(false)

        // Wait for loop to finish
        await waitFor(
          async () => {
            const team = await Team.get("waterfall-team")
            return team!.members.find((m) => m.name === "worker")?.status === "ready"
          },
          15000,
          200,
          "worker idle",
        )

        // Cleanup
        await Team.setMemberStatus("waterfall-team", "worker", "shutdown")
        await Team.cleanup("waterfall-team")
      },
    })
  })
})

// ---------- Scenario 3: Teammate-to-Teammate Debate ----------

describe("Scenario 3: Teammate-to-teammate debate — cross-session message exchange", () => {
  test("two teammates exchange hypotheses, lead receives synthesized findings", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)

        await Team.create({ name: "debate-team", leadSessionID: lead.id })

        // Create two teammates manually (to avoid spawn loop race with messaging)
        const sess1 = await Session.create({ parentID: lead.id })
        const sess2 = await Session.create({ parentID: lead.id })
        await seedUserMessage(sess1.id, "I am hypothesis-a")
        await seedUserMessage(sess2.id, "I am hypothesis-b")

        await Team.addMember("debate-team", {
          name: "hypothesis-a",
          sessionID: sess1.id,
          agent: "general",
          status: "busy",
        })
        await Team.addMember("debate-team", {
          name: "hypothesis-b",
          sessionID: sess2.id,
          agent: "general",
          status: "busy",
        })

        // Round 1: A proposes a theory to B
        await TeamMessaging.send({
          teamName: "debate-team",
          from: "hypothesis-a",
          to: "hypothesis-b",
          text: "I believe the WebSocket disconnection is caused by a timeout in the load balancer. The default nginx proxy_read_timeout is 60s.",
        })

        // Verify B received the message
        let bMsgs = await Session.messages({ sessionID: sess2.id })
        const aToB = bMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("WebSocket disconnection")),
        )
        expect(aToB).toBeDefined()

        // Round 2: B challenges A's theory and proposes alternative
        await TeamMessaging.send({
          teamName: "debate-team",
          from: "hypothesis-b",
          to: "hypothesis-a",
          text:
            "I disagree. The nginx timeout would cause a 504, not a clean close. " +
            "I think the client-side heartbeat interval (30s) mismatches the server keep-alive (25s), " +
            "causing the server to close the connection before the next heartbeat.",
        })

        // Verify A received B's challenge
        let aMsgs = await Session.messages({ sessionID: sess1.id })
        const bToA = aMsgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("heartbeat interval")))
        expect(bToA).toBeDefined()

        // Round 3: A concedes and refines
        await TeamMessaging.send({
          teamName: "debate-team",
          from: "hypothesis-a",
          to: "hypothesis-b",
          text:
            "Good point about the 504 vs clean close distinction. " +
            "Let me check — the keep-alive mismatch would explain the logs showing connection_closed event without error.",
        })

        // Round 4: Both send findings to lead
        await TeamMessaging.send({
          teamName: "debate-team",
          from: "hypothesis-a",
          to: "lead",
          text:
            "FINDING: Root cause is likely keep-alive mismatch (server 25s vs client heartbeat 30s). " +
            "Hypothesis-b convinced me the nginx timeout theory doesn't match the clean-close behavior.",
        })
        await TeamMessaging.send({
          teamName: "debate-team",
          from: "hypothesis-b",
          to: "lead",
          text:
            "FINDING: Both teammates converged on keep-alive mismatch as root cause. " +
            "Recommend setting client heartbeat to 20s (below server 25s keep-alive).",
        })

        // Verify lead received both findings
        const leadMsgs = await Session.messages({ sessionID: lead.id })
        const findings = leadMsgs.filter((m) => m.parts.some((p) => p.type === "text" && p.text.includes("FINDING")))
        expect(findings).toHaveLength(2)

        // Verify the debate had multiple rounds (messages accumulated in each session)
        aMsgs = await Session.messages({ sessionID: sess1.id })
        bMsgs = await Session.messages({ sessionID: sess2.id })
        const aTeamMsgs = aMsgs.filter((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from")),
        )
        const bTeamMsgs = bMsgs.filter((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from")),
        )
        // A received 1 message from B
        expect(aTeamMsgs).toHaveLength(1)
        // B received 2 messages from A (initial theory + concession)
        expect(bTeamMsgs).toHaveLength(2)

        // Cleanup
        await Team.setMemberStatus("debate-team", "hypothesis-a", "shutdown")
        await Team.setMemberStatus("debate-team", "hypothesis-b", "shutdown")
        await Team.cleanup("debate-team")
      },
    })
  })
})

// ---------- Scenario 4: Error Recovery ----------

describe("Scenario 4: Error recovery — teammate loop finishes, lead spawns replacement", () => {
  test("teammate goes idle after loop ends, lead receives notification, can spawn replacement", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)

        await Team.create({ name: "recovery-team", leadSessionID: lead.id })
        await TeamTasks.add("recovery-team", [
          { id: "investigate", content: "Investigate the memory leak", status: "pending", priority: "high" },
        ])

        // Spawn first investigator
        const spawnTool = await TeamSpawnTool.init()
        const leadMsgs = await Session.messages({ sessionID: lead.id })
        const result1 = await spawnTool.execute(
          {
            name: "investigator-1",
            agent: "general",
            prompt: "Investigate the memory leak",
            claim_task: "investigate",
          },
          mockCtx(lead.id, leadMsgs),
        )
        expect(result1.title).toContain("Spawned")

        // Wait for it to go idle (mock server returns quick response)
        const idle1 = await waitFor(
          async () => {
            const team = await Team.get("recovery-team")
            return team!.members.find((m) => m.name === "investigator-1")?.status === "ready"
          },
          15000,
          200,
          "investigator-1 idle",
        )
        expect(idle1).toBe(true)

        // Verify lead got idle notification
        const leadMsgsAfterIdle = await Session.messages({ sessionID: lead.id })
        const idleNotif = leadMsgsAfterIdle.find((m) =>
          m.parts.some(
            (p) =>
              p.type === "text" && p.text.includes("[Team message from investigator-1]") && p.text.includes("finished"),
          ),
        )
        expect(idleNotif).toBeDefined()

        // Lead decides to spawn a replacement with different approach
        // First, unclaim the task by resetting it
        await TeamTasks.update("recovery-team", [
          { id: "investigate", content: "Investigate the memory leak", status: "pending", priority: "high" },
        ])

        // Shutdown the first one
        await Team.setMemberStatus("recovery-team", "investigator-1", "shutdown")

        // Spawn replacement
        const leadMsgs2 = await Session.messages({ sessionID: lead.id })
        const result2 = await spawnTool.execute(
          {
            name: "investigator-2",
            agent: "general",
            prompt: "Try a different approach: use heap snapshots to find the leak",
            claim_task: "investigate",
          },
          mockCtx(lead.id, leadMsgs2),
        )
        expect(result2.title).toContain("Spawned")

        // Verify task is claimed by new investigator
        const tasks = await TeamTasks.list("recovery-team")
        const task = tasks.find((t) => t.id === "investigate")!
        expect(task.status).toBe("in_progress")
        expect(task.assignee).toBe("investigator-2")

        // Verify team has both members (old shutdown, new active)
        const team = await Team.get("recovery-team")!
        expect(team!.members).toHaveLength(2)
        expect(team!.members.find((m) => m.name === "investigator-1")!.status).toBe("shutdown")
        const inv2 = team!.members.find((m) => m.name === "investigator-2")!
        expect(["busy", "ready"]).toContain(inv2.status)

        // Wait for replacement to finish
        await waitFor(
          async () => {
            const t = await Team.get("recovery-team")
            return t!.members.find((m) => m.name === "investigator-2")?.status === "ready"
          },
          15000,
          200,
          "investigator-2 idle",
        )

        // Cleanup
        await Team.setMemberStatus("recovery-team", "investigator-2", "shutdown")
        await Team.cleanup("recovery-team")
      },
    })
  })
})

// ---------- Scenario 5: Cleanup Safety Guards ----------

describe("Scenario 5: Cleanup with active members blocked", () => {
  test("cleanup fails with active members, succeeds only after all shutdown", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)

        await Team.create({ name: "cleanup-team", leadSessionID: lead.id })

        // Add 3 members with varying statuses
        const s1 = await Session.create({ parentID: lead.id })
        const s2 = await Session.create({ parentID: lead.id })
        const s3 = await Session.create({ parentID: lead.id })

        await Team.addMember("cleanup-team", { name: "active-1", sessionID: s1.id, agent: "general", status: "busy" })
        await Team.addMember("cleanup-team", { name: "active-2", sessionID: s2.id, agent: "general", status: "busy" })
        await Team.addMember("cleanup-team", { name: "idle-1", sessionID: s3.id, agent: "general", status: "ready" })

        const cleanupTool = await TeamCleanupTool.init()

        // Attempt 1: cleanup with active members → fail
        const attempt1 = await cleanupTool.execute({ name: "cleanup-team" }, mockCtx(lead.id))
        expect(attempt1.title).toBe("Cleanup failed")
        expect(attempt1.output).toContain("non-shutdown member")

        // Shutdown one active member
        await Team.setMemberStatus("cleanup-team", "active-1", "shutdown")

        // Attempt 2: still one active member → fail
        const attempt2 = await cleanupTool.execute({ name: "cleanup-team" }, mockCtx(lead.id))
        expect(attempt2.title).toBe("Cleanup failed")
        expect(attempt2.output).toContain("non-shutdown member")

        // Shutdown second active member
        await Team.setMemberStatus("cleanup-team", "active-2", "shutdown")

        // Ready members also block cleanup now
        await Team.setMemberStatus("cleanup-team", "idle-1", "shutdown")

        // Attempt 3: all members shutdown → success
        const attempt3 = await cleanupTool.execute({ name: "cleanup-team" }, mockCtx(lead.id))
        expect(attempt3.title).toContain("cleaned up")

        // Verify team is gone
        const team = await Team.get("cleanup-team")
        expect(team).toBeUndefined()
      },
    })
  })

  test("cleanup via direct call enforces same constraint", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "direct-cleanup", leadSessionID: lead.id })

        const s1 = await Session.create({ parentID: lead.id })
        await Team.addMember("direct-cleanup", { name: "worker", sessionID: s1.id, agent: "general", status: "busy" })

        // Direct call should throw
        await expect(Team.cleanup("direct-cleanup")).rejects.toThrow("non-shutdown member")

        // After shutdown, cleanup works
        await Team.setMemberStatus("direct-cleanup", "worker", "shutdown")
        await Team.cleanup("direct-cleanup")
        expect(await Team.get("direct-cleanup")).toBeUndefined()
      },
    })
  })
})

// ---------- Scenario 6: Large Team Scaling ----------

describe("Scenario 6: Large team scaling — 5 teammates concurrently", () => {
  test("5 teammates spawned concurrently, all finish independently, no state corruption", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)

        const createTool = await TeamCreateTool.init()
        await createTool.execute(
          {
            name: "large-team",
            tasks: [
              { id: "t1", content: "Module A refactoring", priority: "high" },
              { id: "t2", content: "Module B refactoring", priority: "high" },
              { id: "t3", content: "Module C refactoring", priority: "medium" },
              { id: "t4", content: "Module D refactoring", priority: "medium" },
              { id: "t5", content: "Module E refactoring", priority: "low" },
            ],
          },
          mockCtx(lead.id),
        )

        // Spawn all 5 concurrently
        const spawnTool = await TeamSpawnTool.init()
        const leadMsgs = await Session.messages({ sessionID: lead.id })
        const names = ["alpha", "beta", "gamma", "delta", "epsilon"]

        const spawns = await Promise.all(
          names.map((name, i) =>
            spawnTool.execute(
              {
                name,
                agent: "general",
                prompt: `Refactor Module ${String.fromCharCode(65 + i)}`,
                claim_task: `t${i + 1}`,
              },
              mockCtx(lead.id, leadMsgs),
            ),
          ),
        )

        // Verify all 5 spawned successfully
        expect(spawns.every((s) => s.title.includes("Spawned"))).toBe(true)

        // Verify team has 5 members
        let team = await Team.get("large-team")
        expect(team!.members).toHaveLength(5)

        // Verify all 5 tasks claimed by different members
        let tasks = await TeamTasks.list("large-team")
        const claimedTasks = tasks.filter((t) => t.status === "in_progress")
        expect(claimedTasks).toHaveLength(5)
        const assignees = new Set(claimedTasks.map((t) => t.assignee))
        expect(assignees.size).toBe(5) // all unique

        // Wait for all 5 to go idle
        const allIdle = await waitFor(
          async () => {
            const t = await Team.get("large-team")
            return t!.members.every((m) => m.status === "ready")
          },
          45000,
          200,
          "all 5 teammates idle",
        )
        expect(allIdle).toBe(true)

        // Verify lead received 5 idle notifications
        const leadMsgsAfter = await Session.messages({ sessionID: lead.id })
        const idleNotifs = leadMsgsAfter.filter((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("finished")),
        )
        expect(idleNotifs).toHaveLength(5)

        // Verify no state corruption — team config still consistent
        team = await Team.get("large-team")
        expect(team!.members).toHaveLength(5)
        expect(team!.leadSessionID).toBe(lead.id)
        expect(new Set(team!.members.map((m) => m.name))).toEqual(new Set(names))
        expect(new Set(team!.members.map((m) => m.sessionID)).size).toBe(5)

        // Broadcast to all 5 — verify no corruption
        await TeamMessaging.broadcast({
          teamName: "large-team",
          from: "lead",
          text: "All modules refactored. Synthesizing results.",
        })
        for (const member of team!.members) {
          const msgs = await Session.messages({ sessionID: member.sessionID })
          const bcast = msgs.find((m) =>
            m.parts.some((p) => p.type === "text" && p.text.includes("Synthesizing results")),
          )
          expect(bcast).toBeDefined()
        }

        // Concurrent task completion from all 5
        await Promise.all(names.map((_, i) => TeamTasks.complete("large-team", `t${i + 1}`)))
        tasks = await TeamTasks.list("large-team")
        expect(tasks.every((t) => t.status === "completed")).toBe(true)

        // Cleanup
        for (const name of names) {
          await Team.setMemberStatus("large-team", name, "shutdown")
        }
        await Team.cleanup("large-team")
      },
    })
  })
})

// ---------- Scenario: Cross-Layer Coordination ----------

describe("Scenario: Cross-layer coordination — frontend, backend, tests with dependencies", () => {
  test("3 teams own different layers, diamond dependency resolves correctly", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await seedUserMessage(lead.id)

        const createTool = await TeamCreateTool.init()
        await createTool.execute(
          {
            name: "cross-layer",
            tasks: [
              // Layer 1: parallel
              { id: "api-schema", content: "Define REST API schema", priority: "high" },
              { id: "db-migration", content: "Write database migration", priority: "high" },
              // Layer 2: depends on layer 1
              {
                id: "backend-impl",
                content: "Implement API handlers",
                priority: "high",
                depends_on: ["api-schema", "db-migration"],
              },
              {
                id: "frontend-api",
                content: "Generate TypeScript API client",
                priority: "high",
                depends_on: ["api-schema"],
              },
              // Layer 3: depends on layer 2
              {
                id: "frontend-ui",
                content: "Build React components",
                priority: "medium",
                depends_on: ["frontend-api"],
              },
              {
                id: "integration-tests",
                content: "Write E2E tests",
                priority: "medium",
                depends_on: ["backend-impl", "frontend-ui"],
              },
            ],
          },
          mockCtx(lead.id),
        )

        // Verify dependency structure
        let tasks = await TeamTasks.list("cross-layer")
        expect(tasks.find((t) => t.id === "api-schema")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "db-migration")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "backend-impl")!.status).toBe("blocked") // needs both api-schema + db-migration
        expect(tasks.find((t) => t.id === "frontend-api")!.status).toBe("blocked") // needs api-schema
        expect(tasks.find((t) => t.id === "frontend-ui")!.status).toBe("blocked") // needs frontend-api
        expect(tasks.find((t) => t.id === "integration-tests")!.status).toBe("blocked") // needs backend-impl + frontend-ui

        // Spawn 3 teammates for different layers
        const spawnTool = await TeamSpawnTool.init()
        const leadMsgs = await Session.messages({ sessionID: lead.id })

        await Promise.all([
          spawnTool.execute(
            { name: "backend-dev", agent: "general", prompt: "Own backend tasks", claim_task: "api-schema" },
            mockCtx(lead.id, leadMsgs),
          ),
          spawnTool.execute(
            { name: "db-dev", agent: "general", prompt: "Own database tasks", claim_task: "db-migration" },
            mockCtx(lead.id, leadMsgs),
          ),
          spawnTool.execute(
            { name: "frontend-dev", agent: "general", prompt: "Own frontend tasks" },
            mockCtx(lead.id, leadMsgs),
          ),
        ])

        // Complete api-schema → frontend-api unblocks, but backend-impl still blocked
        await TeamTasks.complete("cross-layer", "api-schema")
        tasks = await TeamTasks.list("cross-layer")
        expect(tasks.find((t) => t.id === "frontend-api")!.status).toBe("pending") // unblocked!
        expect(tasks.find((t) => t.id === "backend-impl")!.status).toBe("blocked") // still needs db-migration

        // Frontend-dev claims frontend-api
        const frontendClaim = await TeamTasks.claim("cross-layer", "frontend-api", "frontend-dev")
        expect(frontendClaim).toBe(true)

        // Complete db-migration → backend-impl unblocks
        await TeamTasks.complete("cross-layer", "db-migration")
        tasks = await TeamTasks.list("cross-layer")
        expect(tasks.find((t) => t.id === "backend-impl")!.status).toBe("pending")

        // Backend-dev claims and completes backend-impl
        await TeamTasks.claim("cross-layer", "backend-impl", "backend-dev")
        await TeamTasks.complete("cross-layer", "backend-impl")

        // Frontend-dev completes frontend-api → frontend-ui unblocks
        await TeamTasks.complete("cross-layer", "frontend-api")
        tasks = await TeamTasks.list("cross-layer")
        expect(tasks.find((t) => t.id === "frontend-ui")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "integration-tests")!.status).toBe("blocked") // still needs frontend-ui

        // Frontend-dev completes frontend-ui → integration-tests unblocks (diamond resolves!)
        await TeamTasks.claim("cross-layer", "frontend-ui", "frontend-dev")
        await TeamTasks.complete("cross-layer", "frontend-ui")
        tasks = await TeamTasks.list("cross-layer")
        expect(tasks.find((t) => t.id === "integration-tests")!.status).toBe("pending") // diamond resolved!

        // Complete integration-tests
        await TeamTasks.claim("cross-layer", "integration-tests", "backend-dev")
        await TeamTasks.complete("cross-layer", "integration-tests")

        // All done
        tasks = await TeamTasks.list("cross-layer")
        expect(tasks.every((t) => t.status === "completed")).toBe(true)

        // Cleanup
        for (const m of (await Team.get("cross-layer"))!.members) {
          await Team.setMemberStatus("cross-layer", m.name, "shutdown")
        }
        await Team.cleanup("cross-layer")
      },
    })
  })
})

// ---------- Scenario: Task Assignment Race Conditions ----------

describe("Scenario: 5-way concurrent claim race", () => {
  test("5 teammates race to claim 2 tasks, exactly 2 winners", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "race-5", leadSessionID: lead.id })

        // Add 5 members
        const members: string[] = []
        for (let i = 0; i < 5; i++) {
          const sess = await Session.create({ parentID: lead.id })
          const name = `racer-${i}`
          members.push(name)
          await Team.addMember("race-5", { name, sessionID: sess.id, agent: "general", status: "busy" })
        }

        // Add 2 tasks
        await TeamTasks.add("race-5", [
          { id: "prize-1", content: "First prize task", status: "pending", priority: "high" },
          { id: "prize-2", content: "Second prize task", status: "pending", priority: "high" },
        ])

        // All 5 race for prize-1
        const raceResults1 = await Promise.all(members.map((name) => TeamTasks.claim("race-5", "prize-1", name)))
        const winners1 = raceResults1.filter(Boolean).length
        expect(winners1).toBe(1)

        // All 5 race for prize-2 (the winner of prize-1 might also try but should fail)
        const raceResults2 = await Promise.all(members.map((name) => TeamTasks.claim("race-5", "prize-2", name)))
        const winners2 = raceResults2.filter(Boolean).length
        expect(winners2).toBe(1)

        // Verify exactly 2 tasks in_progress
        const tasks = await TeamTasks.list("race-5")
        const inProgress = tasks.filter((t) => t.status === "in_progress")
        expect(inProgress).toHaveLength(2)
        // The same person could win both races since we don't prevent multi-claim.
        // Just verify both have an assignee from our member list.
        for (const t of inProgress) {
          expect(members).toContain(t.assignee!)
        }

        // Cleanup
        for (const name of members) {
          await Team.setMemberStatus("race-5", name, "shutdown")
        }
        await Team.cleanup("race-5")
      },
    })
  })
})

// ---------- Scenario: Full Lifecycle with Bus Events ----------

describe("Scenario: Full lifecycle with bus event verification", () => {
  test("every team action emits the correct bus event in order", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({ git: true, init: makeInstance(server) })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Array<{ type: string; payload: any }> = []

        const unsubs = [
          Bus.subscribe(TeamEvent.Created, (p) => events.push({ type: "created", payload: p })),
          Bus.subscribe(TeamEvent.MemberSpawned, (p) => events.push({ type: "spawned", payload: p })),
          Bus.subscribe(TeamEvent.MemberStatusChanged, (p) => events.push({ type: "status_changed", payload: p })),
          Bus.subscribe(TeamEvent.TaskUpdated, (p) => events.push({ type: "task_updated", payload: p })),
          Bus.subscribe(TeamEvent.TaskClaimed, (p) => events.push({ type: "task_claimed", payload: p })),
          Bus.subscribe(TeamEvent.Message, (p) => events.push({ type: "message", payload: p })),
          Bus.subscribe(TeamEvent.Broadcast, (p) => events.push({ type: "broadcast", payload: p })),
          Bus.subscribe(TeamEvent.Cleaned, (p) => events.push({ type: "cleaned", payload: p })),
        ]

        const lead = await Session.create({})
        await Team.create({ name: "event-lifecycle", leadSessionID: lead.id })

        const s1 = await Session.create({ parentID: lead.id })
        const s2 = await Session.create({ parentID: lead.id })
        await seedUserMessage(s1.id)
        await seedUserMessage(s2.id)
        await seedUserMessage(lead.id)

        // 1. Add members → spawned events
        await Team.addMember("event-lifecycle", { name: "w1", sessionID: s1.id, agent: "general", status: "busy" })
        await Team.addMember("event-lifecycle", { name: "w2", sessionID: s2.id, agent: "general", status: "busy" })

        // 2. Add tasks → task_updated
        await TeamTasks.add("event-lifecycle", [
          { id: "et1", content: "event task", status: "pending", priority: "high" },
        ])

        // 3. Claim → task_claimed
        await TeamTasks.claim("event-lifecycle", "et1", "w1")

        // 4. Message → message
        await TeamMessaging.send({ teamName: "event-lifecycle", from: "w1", to: "lead", text: "hello" })

        // 5. Broadcast → broadcast
        await TeamMessaging.broadcast({ teamName: "event-lifecycle", from: "lead", text: "update" })

        // 6. Status change → status_changed
        await Team.setMemberStatus("event-lifecycle", "w1", "ready")
        await Team.setMemberStatus("event-lifecycle", "w2", "shutdown")
        await Team.setMemberStatus("event-lifecycle", "w1", "shutdown")

        // 7. Cleanup → cleaned
        await Team.cleanup("event-lifecycle")

        // Wait briefly for async event delivery
        await new Promise((r) => setTimeout(r, 100))

        // Verify all event types appeared
        const types = events.map((e) => e.type)
        expect(types).toContain("created")
        expect(types).toContain("spawned")
        expect(types).toContain("task_updated")
        expect(types).toContain("task_claimed")
        expect(types).toContain("message")
        expect(types).toContain("broadcast")
        expect(types).toContain("status_changed")
        expect(types).toContain("cleaned")

        // Verify ordering: created before spawned before task_updated before claimed
        const createdIdx = types.indexOf("created")
        const spawnedIdx = types.indexOf("spawned")
        const taskUpdatedIdx = types.indexOf("task_updated")
        const claimedIdx = types.indexOf("task_claimed")
        const cleanedIdx = types.indexOf("cleaned")

        expect(createdIdx).toBeLessThan(spawnedIdx)
        expect(spawnedIdx).toBeLessThan(taskUpdatedIdx)
        expect(taskUpdatedIdx).toBeLessThan(claimedIdx)
        expect(claimedIdx).toBeLessThan(cleanedIdx)

        // Verify event payloads — Bus.subscribe callback receives { type, properties }
        const spawnedEvts = events.filter((e) => e.type === "spawned")
        expect(spawnedEvts).toHaveLength(2)
        expect(spawnedEvts.map((e) => e.payload.properties.member.name).sort()).toEqual(["w1", "w2"])

        const claimedEvt = events.find((e) => e.type === "task_claimed")!
        expect(claimedEvt.payload.properties.taskId).toBe("et1")
        expect(claimedEvt.payload.properties.memberName).toBe("w1")

        for (const unsub of unsubs) unsub()
      },
    })
  })
})
