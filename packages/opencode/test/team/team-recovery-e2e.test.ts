import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Team } from "../../src/team"
import { TeamMessaging } from "../../src/team/messaging"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"
import { Bus } from "../../src/bus"
import { TeamEvent } from "../../src/team/events"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// ---------- Mock Anthropic SSE server ----------

const serverState = {
  server: null as ReturnType<typeof Bun.serve> | null,
  responses: [] as Array<{ response: Response }>,
  requests: [] as Array<{ url: string; body: any }>,
}

function anthropicSSE(text: string) {
  const chunks = [
    {
      type: "message_start",
      message: {
        id: "msg-recovery-test",
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
      const body = await req.json().catch(() => ({}))
      serverState.requests.push({ url: req.url, body })
      const next = serverState.responses.shift()
      if (!next) return anthropicSSE("(no queued response)")
      return next.response
    },
  })
})

beforeEach(() => {
  serverState.responses.length = 0
  serverState.requests.length = 0
})

afterAll(() => {
  serverState.server?.stop()
})

describe("Team recovery e2e: full restart cycle", () => {
  test("recovery marks active members interrupted, team_message auto-wakes them", async () => {
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

    let leadSessionID: string
    let memberSessionID: string

    // ===== PHASE 1: First boot — create team with active teammate =====
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create lead session
        const leadSession = await Session.create({})
        leadSessionID = leadSession.id

        // Create a user message in lead session (needed for message injection later)
        const leadMsgId = Identifier.ascending("message")
        await Session.updateMessage({
          id: leadMsgId,
          sessionID: leadSession.id,
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: leadMsgId,
          sessionID: leadSession.id,
          type: "text",
          text: "Create a team and spawn a researcher",
        })

        // Create team
        await Team.create({
          name: "recovery-e2e",
          leadSessionID: leadSession.id,
        })

        // Create child session for the teammate
        const memberSession = await Session.create({
          parentID: leadSession.id,
          title: "researcher (teammate)",
        })
        memberSessionID = memberSession.id

        // Register as team member with status "busy"
        await Team.addMember("recovery-e2e", {
          name: "researcher",
          sessionID: memberSession.id,
          agent: "explore",
          status: "busy",
          prompt: "Research the session module",
          model: "anthropic/claude-3-5-sonnet-20241022",
          planApproval: "none",
        })

        // Create a user message in the member session (needed for loop to work)
        const memberMsgId = Identifier.ascending("message")
        await Session.updateMessage({
          id: memberMsgId,
          sessionID: memberSession.id,
          role: "user",
          agent: "explore",
          model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: memberMsgId,
          sessionID: memberSession.id,
          type: "text",
          text: "You are researcher, a teammate. Research the session module.",
        })

        // Verify setup
        const team = await Team.get("recovery-e2e")
        expect(team).toBeDefined()
        expect(team!.members).toHaveLength(1)
        expect(team!.members[0].status).toBe("busy")
        expect(team!.members[0].sessionID).toBe(memberSession.id)
      },
    })

    // ===== PHASE 2: "Server dies" — instance is gone, no loops running =====
    // (Instance.provide already disposed the context above)

    // ===== PHASE 3: Second boot — recovery runs =====
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Run recovery
        const result = await Team.recover()
        expect(result.interrupted).toBe(1)

        // Verify member is now "ready"
        const team = await Team.get("recovery-e2e")
        expect(team!.members[0].status).toBe("ready")

        // Verify lead session got a notification message
        const msgs = await Session.messages({ sessionID: leadSessionID! })
        const lastMsg = msgs[msgs.length - 1]
        expect(lastMsg.info.role).toBe("user")
        const textParts = lastMsg.parts.filter((p) => p.type === "text")
        const hasNotification = textParts.some(
          (p) => p.type === "text" && p.text.includes("Server was restarted"),
        )
        expect(hasNotification).toBe(true)

        // ===== PHASE 4: User says "continue" — lead LLM sends team_message =====
        // Simulate what the LLM would do: send a team_message to the researcher
        // Queue a mock LLM response for the researcher's auto-waked loop
        queueResponse("I have resumed my research after the restart.")

        // Verify the member session is idle (no loop running)
        const statusBefore = SessionStatus.get(memberSessionID!)
        expect(statusBefore.type).toBe("idle")

        // Send team_message — this should trigger auto-wake
        await TeamMessaging.send({
          teamName: "recovery-e2e",
          from: "lead",
          to: "researcher",
          text: "Continue your work on the session module research.",
        })

        // Give the auto-waked loop time to process
        await Bun.sleep(500)

        // Verify the teammate's loop ran (mock LLM was called)
        const anthropicRequests = serverState.requests.filter((r) =>
          r.url.includes("/v1/messages"),
        )
        expect(anthropicRequests.length).toBeGreaterThanOrEqual(1)

        // Wait for loop to fully complete
        await Bun.sleep(500)

        // The session status should return to idle after the loop finishes
        const statusAfter = SessionStatus.get(memberSessionID!)
        expect(statusAfter.type).toBe("idle")
      },
    })
  })

  test("recovery with no active members is a no-op", async () => {
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
        await Team.create({ name: "noop-team", leadSessionID: leadSession.id })
        await Team.addMember("noop-team", {
          name: "worker",
          sessionID: "ses_fake",
          agent: "general",
          status: "ready",
          planApproval: "none",
        })
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Team.recover()
        expect(result.interrupted).toBe(0)

        const team = await Team.get("noop-team")
        expect(team!.members[0].status).toBe("ready")
      },
    })
  })
})
