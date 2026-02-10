import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Team, TeamTasks, type TeamTask } from "../../src/team"
import { TeamMessaging } from "../../src/team/messaging"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"
import { Env } from "../../src/env"
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

const serverState = {
  server: null as ReturnType<typeof Bun.serve> | null,
  responses: [] as Array<{ response: Response; resolve?: (capture: any) => void }>,
}

function anthropicSSE(text: string) {
  const chunks = [
    {
      type: "message_start",
      message: {
        id: "msg-team-test",
        model: "claude-3-5-sonnet-20241022",
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
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
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload))
        controller.close()
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  )
}

function queueResponse(text: string) {
  serverState.responses.push({ response: anthropicSSE(text) })
}

beforeAll(() => {
  serverState.server = Bun.serve({
    port: 0,
    async fetch(req) {
      const next = serverState.responses.shift()
      if (!next) {
        // Return a valid SSE "end_turn" response so the loop exits gracefully
        return anthropicSSE("(no queued response)")
      }
      return next.response
    },
  })
})

beforeEach(() => {
  serverState.responses.length = 0
})

afterAll(() => {
  serverState.server?.stop()
})

// ---------- Helpers ----------

function mockCtx(sessionID: string, overrides?: Partial<any>) {
  return {
    sessionID,
    messageID: Identifier.ascending("message"),
    agent: "general",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => {},
    ...overrides,
  } as any
}

// ---------- E2E Tests ----------

describe("Team e2e: full lifecycle", () => {
  test("create team, add tasks, spawn teammate (noReply), claim, complete, cleanup", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // 1. Create lead session
        const leadSession = await Session.create({})

        // 2. Create team via tool
        const createTool = await TeamCreateTool.init()
        const createResult = await createTool.execute(
          {
            name: "e2e-team",
            tasks: [
              { id: "t1", content: "Research auth module", priority: "high" },
              { id: "t2", content: "Write tests", priority: "medium", depends_on: ["t1"] },
            ],
          },
          mockCtx(leadSession.id),
        )
        expect(createResult.title).toContain("Created team")
        expect(createResult.metadata.teamName).toBe("e2e-team")

        // Verify team exists
        const team = await Team.get("e2e-team")
        expect(team).toBeDefined()
        expect(team!.leadSessionID).toBe(leadSession.id)

        // Verify tasks were created with dependency resolution
        const tasks = await TeamTasks.list("e2e-team")
        expect(tasks).toHaveLength(2)
        expect(tasks.find((t) => t.id === "t1")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("blocked") // blocked by t1

        // 3. Create a child session manually (simulating spawn without the full loop)
        const childSession = await Session.create({
          parentID: leadSession.id,
          title: "researcher (@explore teammate)",
          permission: [
            { permission: "team_create", pattern: "*", action: "deny" as const },
            { permission: "team_spawn", pattern: "*", action: "deny" as const },
            { permission: "team_shutdown", pattern: "*", action: "deny" as const },
            { permission: "team_cleanup", pattern: "*", action: "deny" as const },
          ],
        })

        // Register as team member
        await Team.addMember("e2e-team", {
          name: "researcher",
          sessionID: childSession.id,
          agent: "explore",
          status: "busy",
        })

        // Create a user message in child session so messaging can resolve model info
        const childMsgId = Identifier.ascending("message")
        await Session.updateMessage({
          id: childMsgId,
          sessionID: childSession.id,
          role: "user",
          agent: "explore",
          model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: childMsgId,
          sessionID: childSession.id,
          type: "text",
          text: "You are researcher, a teammate. Research the auth module.",
        })

        // 4. Teammate claims a task
        const claimTool = await TeamClaimTool.init()
        const claimResult = await claimTool.execute({ task_id: "t1" }, mockCtx(childSession.id))
        expect(claimResult.title).toContain("Claimed")

        // Verify claim
        const tasksAfterClaim = await TeamTasks.list("e2e-team")
        const t1 = tasksAfterClaim.find((t) => t.id === "t1")!
        expect(t1.status).toBe("in_progress")
        expect(t1.assignee).toBe("researcher")

        // 5. Teammate completes the task
        const tasksTool = await TeamTasksTool.init()
        const completeResult = await tasksTool.execute({ action: "complete", task_id: "t1" }, mockCtx(childSession.id))
        expect(completeResult.title).toContain("Completed")

        // Verify t2 is now unblocked
        const tasksAfterComplete = await TeamTasks.list("e2e-team")
        expect(tasksAfterComplete.find((t) => t.id === "t2")!.status).toBe("pending")

        // 6. Teammate sends message to lead
        // First create a user message in lead session so messaging can find model info
        const leadMsgId = Identifier.ascending("message")
        await Session.updateMessage({
          id: leadMsgId,
          sessionID: leadSession.id,
          role: "user",
          agent: "general",
          model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: leadMsgId,
          sessionID: leadSession.id,
          type: "text",
          text: "init",
        })

        const messageTool = await TeamMessageTool.init()
        const msgResult = await messageTool.execute(
          { to: "lead", text: "Found 3 vulnerabilities in auth module" },
          mockCtx(childSession.id),
        )
        expect(msgResult.title).toContain("Message sent")

        // Verify the message was injected into lead's session
        const leadMsgs = await Session.messages({ sessionID: leadSession.id })
        const teamMsg = leadMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from researcher]")),
        )
        expect(teamMsg).toBeDefined()

        // 7. Lead sends shutdown
        const shutdownTool = await TeamShutdownTool.init()
        const shutResult = await shutdownTool.execute({ name: "researcher" }, mockCtx(leadSession.id))
        expect(shutResult.title).toContain("Shutdown")

        // Verify member status changed
        const teamAfterShutdown = await Team.get("e2e-team")
        expect(teamAfterShutdown!.members[0].status).toBe("shutdown_requested")

        // Simulate the teammate acknowledging and stopping
        await Team.setMemberStatus("e2e-team", "researcher", "shutdown")

        // 8. Cleanup
        const cleanupTool = await TeamCleanupTool.init()
        const cleanupResult = await cleanupTool.execute({ name: "e2e-team" }, mockCtx(leadSession.id))
        expect(cleanupResult.title).toContain("cleaned up")

        // Verify team is gone
        const teamAfterCleanup = await Team.get("e2e-team")
        expect(teamAfterCleanup).toBeUndefined()
      },
    })
  })

  test("full spawn with SessionPrompt.loop() — teammate runs and goes idle", async () => {
    const server = serverState.server!

    // Queue a response for the teammate's loop
    queueResponse("I have finished researching the auth module. Found no issues.")

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create lead session and team
        const leadSession = await Session.create({})
        await Team.create({ name: "loop-team", leadSessionID: leadSession.id })

        // Create a user message in lead session for messaging to work
        const leadMsgId = Identifier.ascending("message")
        await Session.updateMessage({
          id: leadMsgId,
          sessionID: leadSession.id,
          role: "user",
          agent: "general",
          model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: leadMsgId,
          sessionID: leadSession.id,
          type: "text",
          text: "init lead",
        })

        // Create child session with teammate permissions
        const childSession = await Session.create({
          parentID: leadSession.id,
          title: "auto-runner (@general teammate)",
          permission: [
            { permission: "team_create", pattern: "*", action: "deny" as const },
            { permission: "team_spawn", pattern: "*", action: "deny" as const },
            { permission: "team_shutdown", pattern: "*", action: "deny" as const },
            { permission: "team_cleanup", pattern: "*", action: "deny" as const },
            { permission: "todowrite", pattern: "*", action: "deny" as const },
            { permission: "todoread", pattern: "*", action: "deny" as const },
          ],
        })

        // Register as member
        await Team.addMember("loop-team", {
          name: "auto-runner",
          sessionID: childSession.id,
          agent: "general",
          status: "busy",
        })

        // Create the initial user message for the teammate
        const msgId = Identifier.ascending("message")
        await Session.updateMessage({
          id: msgId,
          sessionID: childSession.id,
          role: "user",
          agent: "general",
          model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: msgId,
          sessionID: childSession.id,
          type: "text",
          text: "You are auto-runner, a teammate. Research the auth module.",
        })

        // Run the teammate's prompt loop — it should hit our mock server and finish
        const result = await SessionPrompt.loop({ sessionID: childSession.id })

        // Verify the loop completed — result should be an assistant message
        expect(result.reason).toBe("completed")
        if (result.reason === "cancelled") throw new Error("expected completed result")
        expect(result.message.info.role).toBe("assistant")

        // Verify the response text was captured
        const childMsgs = await Session.messages({ sessionID: childSession.id })
        const assistantMsg = childMsgs.find((m) => m.info.role === "assistant")
        expect(assistantMsg).toBeDefined()
        const textPart = assistantMsg!.parts.find((p) => p.type === "text")
        expect(textPart).toBeDefined()

        // Cleanup
        await Team.setMemberStatus("loop-team", "auto-runner", "shutdown")
        await Team.cleanup("loop-team")
      },
    })
  })
})

describe("Team e2e: messaging", () => {
  test("teammate-to-teammate messaging via lead", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create lead and two teammates
        const leadSession = await Session.create({})
        await Team.create({ name: "msg-team", leadSessionID: leadSession.id })

        const sess1 = await Session.create({ parentID: leadSession.id })
        const sess2 = await Session.create({ parentID: leadSession.id })

        await Team.addMember("msg-team", {
          name: "alice",
          sessionID: sess1.id,
          agent: "general",
          status: "busy",
        })
        await Team.addMember("msg-team", {
          name: "bob",
          sessionID: sess2.id,
          agent: "general",
          status: "busy",
        })

        // Create user messages in both sessions so messaging can resolve model info
        for (const sess of [sess1, sess2]) {
          const mid = Identifier.ascending("message")
          await Session.updateMessage({
            id: mid,
            sessionID: sess.id,
            role: "user",
            agent: "general",
            model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            time: { created: Date.now() },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: mid,
            sessionID: sess.id,
            type: "text",
            text: "init",
          })
        }

        // Alice sends message to Bob
        await TeamMessaging.send({
          teamName: "msg-team",
          from: "alice",
          to: "bob",
          text: "I found a bug in the parser",
        })

        // Verify Bob received it
        const bobMsgs = await Session.messages({ sessionID: sess2.id })
        const received = bobMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from alice]")),
        )
        expect(received).toBeDefined()
        expect(received!.parts.find((p) => p.type === "text")!.text).toContain("bug in the parser")

        // Bob sends message back to Alice
        await TeamMessaging.send({
          teamName: "msg-team",
          from: "bob",
          to: "alice",
          text: "Can you share the stack trace?",
        })

        const aliceMsgs = await Session.messages({ sessionID: sess1.id })
        const reply = aliceMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from bob]")),
        )
        expect(reply).toBeDefined()

        // Cleanup
        await Team.setMemberStatus("msg-team", "alice", "shutdown")
        await Team.setMemberStatus("msg-team", "bob", "shutdown")
        await Team.cleanup("msg-team")
      },
    })
  })

  test("broadcast sends to all members except sender", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const leadSession = await Session.create({})
        await Team.create({ name: "bcast-team", leadSessionID: leadSession.id })

        const sess1 = await Session.create({ parentID: leadSession.id })
        const sess2 = await Session.create({ parentID: leadSession.id })

        await Team.addMember("bcast-team", { name: "m1", sessionID: sess1.id, agent: "general", status: "busy" })
        await Team.addMember("bcast-team", { name: "m2", sessionID: sess2.id, agent: "general", status: "busy" })

        // Create user messages in all sessions
        for (const sess of [leadSession, sess1, sess2]) {
          const mid = Identifier.ascending("message")
          await Session.updateMessage({
            id: mid,
            sessionID: sess.id,
            role: "user",
            agent: "general",
            model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
            time: { created: Date.now() },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: mid,
            sessionID: sess.id,
            type: "text",
            text: "init",
          })
        }

        // Lead broadcasts
        await TeamMessaging.broadcast({
          teamName: "bcast-team",
          from: "lead",
          text: "Wrap up your work, we're synthesizing results",
        })

        // m1 and m2 should both get the message
        for (const sess of [sess1, sess2]) {
          const msgs = await Session.messages({ sessionID: sess.id })
          const bcast = msgs.find((m) =>
            m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from lead]")),
          )
          expect(bcast).toBeDefined()
          expect(bcast!.parts.find((p) => p.type === "text")!.text).toContain("synthesizing results")
        }

        // Lead should NOT have received the broadcast (sender excluded)
        const leadMsgs = await Session.messages({ sessionID: leadSession.id })
        const leadBcast = leadMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from lead]")),
        )
        expect(leadBcast).toBeUndefined()

        // Cleanup
        await Team.setMemberStatus("bcast-team", "m1", "shutdown")
        await Team.setMemberStatus("bcast-team", "m2", "shutdown")
        await Team.cleanup("bcast-team")
      },
    })
  })

  test("messaging to shutdown teammate throws", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const leadSession = await Session.create({})
        await Team.create({ name: "dead-team", leadSessionID: leadSession.id })

        const sess = await Session.create({ parentID: leadSession.id })
        await Team.addMember("dead-team", { name: "dead", sessionID: sess.id, agent: "general", status: "shutdown" })

        await expect(
          TeamMessaging.send({ teamName: "dead-team", from: "lead", to: "dead", text: "hello" }),
        ).rejects.toThrow("shut down")

        await Team.cleanup("dead-team")
      },
    })
  })
})

describe("Team e2e: task coordination", () => {
  test("concurrent claim prevention", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const leadSession = await Session.create({})
        await Team.create({ name: "race-team", leadSessionID: leadSession.id })

        const sess1 = await Session.create({ parentID: leadSession.id })
        const sess2 = await Session.create({ parentID: leadSession.id })

        await Team.addMember("race-team", { name: "racer1", sessionID: sess1.id, agent: "general", status: "busy" })
        await Team.addMember("race-team", { name: "racer2", sessionID: sess2.id, agent: "general", status: "busy" })

        await TeamTasks.add("race-team", [
          { id: "contested", content: "Only one can claim this", status: "pending", priority: "high" },
        ])

        // Race: both try to claim at the same time
        const [result1, result2] = await Promise.all([
          TeamTasks.claim("race-team", "contested", "racer1"),
          TeamTasks.claim("race-team", "contested", "racer2"),
        ])

        // Exactly one should succeed
        expect([result1, result2].filter(Boolean)).toHaveLength(1)

        const tasks = await TeamTasks.list("race-team")
        const task = tasks.find((t) => t.id === "contested")!
        expect(task.status).toBe("in_progress")
        expect(["racer1", "racer2"]).toContain(task.assignee!)

        await Team.setMemberStatus("race-team", "racer1", "shutdown")
        await Team.setMemberStatus("race-team", "racer2", "shutdown")
        await Team.cleanup("race-team")
      },
    })
  })

  test("chained dependency resolution across multiple tasks", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const leadSession = await Session.create({})
        await Team.create({ name: "chain-team", leadSessionID: leadSession.id })

        // t1 -> t2 -> t3 -> t4 (linear chain)
        await TeamTasks.add("chain-team", [
          { id: "t1", content: "Foundation", status: "pending", priority: "high" },
          { id: "t2", content: "Layer 1", status: "pending", priority: "high", depends_on: ["t1"] },
          { id: "t3", content: "Layer 2", status: "pending", priority: "medium", depends_on: ["t2"] },
          { id: "t4", content: "Final", status: "pending", priority: "low", depends_on: ["t3"] },
        ])

        // Verify initial states
        let tasks = await TeamTasks.list("chain-team")
        expect(tasks.find((t) => t.id === "t1")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("blocked")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("blocked")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")

        // Complete t1 -> unblocks t2 only
        await TeamTasks.claim("chain-team", "t1", "worker")
        await TeamTasks.complete("chain-team", "t1")
        tasks = await TeamTasks.list("chain-team")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("blocked")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")

        // Complete t2 -> unblocks t3 only
        await TeamTasks.claim("chain-team", "t2", "worker")
        await TeamTasks.complete("chain-team", "t2")
        tasks = await TeamTasks.list("chain-team")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")

        // Complete t3 -> unblocks t4
        await TeamTasks.claim("chain-team", "t3", "worker")
        await TeamTasks.complete("chain-team", "t3")
        tasks = await TeamTasks.list("chain-team")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("pending")

        // Complete the chain
        await TeamTasks.claim("chain-team", "t4", "worker")
        await TeamTasks.complete("chain-team", "t4")
        tasks = await TeamTasks.list("chain-team")
        expect(tasks.every((t) => t.status === "completed")).toBe(true)

        await Team.cleanup("chain-team")
      },
    })
  })

  test("diamond dependency — task with multiple deps unblocks when all complete", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const leadSession = await Session.create({})
        await Team.create({ name: "diamond-team", leadSessionID: leadSession.id })

        //     t1
        //    /  \
        //   t2   t3
        //    \  /
        //     t4
        await TeamTasks.add("diamond-team", [
          { id: "t1", content: "Root", status: "pending", priority: "high" },
          { id: "t2", content: "Left", status: "pending", priority: "high", depends_on: ["t1"] },
          { id: "t3", content: "Right", status: "pending", priority: "high", depends_on: ["t1"] },
          { id: "t4", content: "Join", status: "pending", priority: "high", depends_on: ["t2", "t3"] },
        ])

        // Complete t1 — unblocks t2 and t3 but not t4
        await TeamTasks.claim("diamond-team", "t1", "w")
        await TeamTasks.complete("diamond-team", "t1")
        let tasks = await TeamTasks.list("diamond-team")
        expect(tasks.find((t) => t.id === "t2")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t3")!.status).toBe("pending")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")

        // Complete t2 only — t4 still blocked (needs t3)
        await TeamTasks.claim("diamond-team", "t2", "w")
        await TeamTasks.complete("diamond-team", "t2")
        tasks = await TeamTasks.list("diamond-team")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("blocked")

        // Complete t3 — now t4 unblocks
        await TeamTasks.claim("diamond-team", "t3", "w")
        await TeamTasks.complete("diamond-team", "t3")
        tasks = await TeamTasks.list("diamond-team")
        expect(tasks.find((t) => t.id === "t4")!.status).toBe("pending")

        await Team.cleanup("diamond-team")
      },
    })
  })
})

describe("Team e2e: bus events", () => {
  test("bus events fire for team lifecycle", async () => {
    const server = serverState.server!

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
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
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: string[] = []

        const unsubs = [
          Bus.subscribe(TeamEvent.Created, () => events.push("created")),
          Bus.subscribe(TeamEvent.MemberSpawned, () => events.push("member_spawned")),
          Bus.subscribe(TeamEvent.MemberStatusChanged, () => events.push("member_status_changed")),
          Bus.subscribe(TeamEvent.TaskUpdated, () => events.push("task_updated")),
          Bus.subscribe(TeamEvent.TaskClaimed, () => events.push("task_claimed")),
          Bus.subscribe(TeamEvent.Cleaned, () => events.push("cleaned")),
        ]

        const leadSession = await Session.create({})
        await Team.create({ name: "event-team", leadSessionID: leadSession.id })
        expect(events).toContain("created")

        const sess = await Session.create({ parentID: leadSession.id })
        await Team.addMember("event-team", { name: "worker", sessionID: sess.id, agent: "general", status: "busy" })
        expect(events).toContain("member_spawned")

        await TeamTasks.add("event-team", [{ id: "t1", content: "task", status: "pending", priority: "high" }])
        expect(events).toContain("task_updated")

        await TeamTasks.claim("event-team", "t1", "worker")
        expect(events).toContain("task_claimed")

        await Team.setMemberStatus("event-team", "worker", "shutdown")
        expect(events).toContain("member_status_changed")

        await Team.cleanup("event-team")
        expect(events).toContain("cleaned")

        for (const unsub of unsubs) unsub()
      },
    })
  })
})
