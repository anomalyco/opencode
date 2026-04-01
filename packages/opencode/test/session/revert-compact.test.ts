import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionRevert } from "../../src/session/revert"
import { SessionCompaction } from "../../src/session/compaction"
import { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { MessageID, PartID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function user(sessionID: string, agent = "default") {
  return Session.updateMessage({
    id: MessageID.ascending(),
    role: "user" as const,
    sessionID: sessionID as any,
    agent,
    model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
    time: { created: Date.now() },
  })
}

function assistant(sessionID: string, parentID: string, dir: string) {
  return Session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant" as const,
    sessionID: sessionID as any,
    mode: "default",
    agent: "default",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelID.make("gpt-4"),
    providerID: ProviderID.make("openai"),
    parentID: parentID as any,
    time: { created: Date.now() },
    finish: "end_turn",
  })
}

function text(sessionID: string, messageID: string, content: string) {
  return Session.updatePart({
    id: PartID.ascending(),
    messageID: messageID as any,
    sessionID: sessionID as any,
    type: "text" as const,
    text: content,
  })
}

function tool(sessionID: string, messageID: string) {
  return Session.updatePart({
    id: PartID.ascending(),
    messageID: messageID as any,
    sessionID: sessionID as any,
    type: "tool" as const,
    tool: "bash",
    callID: "call-1",
    state: {
      status: "completed" as const,
      input: {},
      output: "done",
      title: "",
      metadata: {},
      time: { start: 0, end: 1 },
    },
  })
}

describe("revert + compact workflow", () => {
  test("should properly handle compact command after revert", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a session
        const session = await Session.create({})
        const sessionID = session.id

        // Create a user message
        const userMsg1 = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID,
          agent: "default",
          model: {
            providerID: ProviderID.make("openai"),
            modelID: ModelID.make("gpt-4"),
          },
          time: {
            created: Date.now(),
          },
        })

        // Add a text part to the user message
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMsg1.id,
          sessionID,
          type: "text",
          text: "Hello, please help me",
        })

        // Create an assistant response message
        const assistantMsg1: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "default",
          agent: "default",
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: userMsg1.id,
          time: {
            created: Date.now(),
          },
          finish: "end_turn",
        }
        await Session.updateMessage(assistantMsg1)

        // Add a text part to the assistant message
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistantMsg1.id,
          sessionID,
          type: "text",
          text: "Sure, I'll help you!",
        })

        // Create another user message
        const userMsg2 = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID,
          agent: "default",
          model: {
            providerID: ProviderID.make("openai"),
            modelID: ModelID.make("gpt-4"),
          },
          time: {
            created: Date.now(),
          },
        })

        await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMsg2.id,
          sessionID,
          type: "text",
          text: "What's the capital of France?",
        })

        // Create another assistant response
        const assistantMsg2: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "default",
          agent: "default",
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: userMsg2.id,
          time: {
            created: Date.now(),
          },
          finish: "end_turn",
        }
        await Session.updateMessage(assistantMsg2)

        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistantMsg2.id,
          sessionID,
          type: "text",
          text: "The capital of France is Paris.",
        })

        // Verify messages before revert
        let messages = await Session.messages({ sessionID })
        expect(messages.length).toBe(4) // 2 user + 2 assistant messages
        const messageIds = messages.map((m) => m.info.id)
        expect(messageIds).toContain(userMsg1.id)
        expect(messageIds).toContain(userMsg2.id)
        expect(messageIds).toContain(assistantMsg1.id)
        expect(messageIds).toContain(assistantMsg2.id)

        // Revert the last user message (userMsg2)
        await SessionRevert.revert({
          sessionID,
          messageID: userMsg2.id,
        })

        // Check that revert state is set
        let sessionInfo = await Session.get(sessionID)
        expect(sessionInfo.revert).toBeDefined()
        const revertMessageID = sessionInfo.revert?.messageID
        expect(revertMessageID).toBeDefined()

        // Messages should still be in the list (not removed yet, just marked for revert)
        messages = await Session.messages({ sessionID })
        expect(messages.length).toBe(4)

        // Now clean up the revert state (this is what the compact endpoint should do)
        await SessionRevert.cleanup(sessionInfo)

        // After cleanup, the reverted messages (those after the revert point) should be removed
        messages = await Session.messages({ sessionID })
        const remainingIds = messages.map((m) => m.info.id)
        // The revert point is somewhere in the message chain, so we should have fewer messages
        expect(messages.length).toBeLessThan(4)
        // userMsg2 and assistantMsg2 should be removed (they come after the revert point)
        expect(remainingIds).not.toContain(userMsg2.id)
        expect(remainingIds).not.toContain(assistantMsg2.id)

        // Revert state should be cleared
        sessionInfo = await Session.get(sessionID)
        expect(sessionInfo.revert).toBeUndefined()

        // Clean up
        await Session.remove(sessionID)
      },
    })
  })

  test("should properly clean up revert state before creating compaction message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a session
        const session = await Session.create({})
        const sessionID = session.id

        // Create initial messages
        const userMsg = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID,
          agent: "default",
          model: {
            providerID: ProviderID.make("openai"),
            modelID: ModelID.make("gpt-4"),
          },
          time: {
            created: Date.now(),
          },
        })

        await Session.updatePart({
          id: PartID.ascending(),
          messageID: userMsg.id,
          sessionID,
          type: "text",
          text: "Hello",
        })

        const assistantMsg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID,
          mode: "default",
          agent: "default",
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          parentID: userMsg.id,
          time: {
            created: Date.now(),
          },
          finish: "end_turn",
        }
        await Session.updateMessage(assistantMsg)

        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistantMsg.id,
          sessionID,
          type: "text",
          text: "Hi there!",
        })

        // Revert the user message
        await SessionRevert.revert({
          sessionID,
          messageID: userMsg.id,
        })

        // Check that revert state is set
        let sessionInfo = await Session.get(sessionID)
        expect(sessionInfo.revert).toBeDefined()

        // Simulate what the compact endpoint does: cleanup revert before creating compaction
        await SessionRevert.cleanup(sessionInfo)

        // Verify revert state is cleared
        sessionInfo = await Session.get(sessionID)
        expect(sessionInfo.revert).toBeUndefined()

        // Verify messages are properly cleaned up
        const messages = await Session.messages({ sessionID })
        expect(messages.length).toBe(0) // All messages should be reverted

        // Clean up
        await Session.remove(sessionID)
      },
    })
  })

  test("cleanup with partID removes parts from the revert point onward", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id

        const u1 = await user(sid)
        const p1 = await text(sid, u1.id, "first part")
        const p2 = await tool(sid, u1.id)
        const p3 = await text(sid, u1.id, "third part")

        // Set revert state pointing at a specific part
        await Session.setRevert({
          sessionID: sid,
          revert: { messageID: u1.id, partID: p2.id },
          summary: { additions: 0, deletions: 0, files: 0 },
        })

        const info = await Session.get(sid)
        await SessionRevert.cleanup(info)

        const msgs = await Session.messages({ sessionID: sid })
        expect(msgs.length).toBe(1)
        // Only the first part should remain (before the revert partID)
        expect(msgs[0].parts.length).toBe(1)
        expect(msgs[0].parts[0].id).toBe(p1.id)

        const cleared = await Session.get(sid)
        expect(cleared.revert).toBeUndefined()
      },
    })
  })

  test("cleanup removes messages after revert point but keeps earlier ones", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id

        const u1 = await user(sid)
        await text(sid, u1.id, "hello")
        const a1 = await assistant(sid, u1.id, tmp.path)
        await text(sid, a1.id, "hi back")

        const u2 = await user(sid)
        await text(sid, u2.id, "second question")
        const a2 = await assistant(sid, u2.id, tmp.path)
        await text(sid, a2.id, "second answer")

        // Revert from u2 onward
        await Session.setRevert({
          sessionID: sid,
          revert: { messageID: u2.id },
          summary: { additions: 0, deletions: 0, files: 0 },
        })

        const info = await Session.get(sid)
        await SessionRevert.cleanup(info)

        const msgs = await Session.messages({ sessionID: sid })
        const ids = msgs.map((m) => m.info.id)
        expect(ids).toContain(u1.id)
        expect(ids).toContain(a1.id)
        expect(ids).not.toContain(u2.id)
        expect(ids).not.toContain(a2.id)
      },
    })
  })

  test("cleanup is a no-op when session has no revert state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id

        const u1 = await user(sid)
        await text(sid, u1.id, "hello")

        const info = await Session.get(sid)
        expect(info.revert).toBeUndefined()
        await SessionRevert.cleanup(info)

        const msgs = await Session.messages({ sessionID: sid })
        expect(msgs.length).toBe(1)
      },
    })
  })
})
