import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { MessageV2 } from "../../src/session/message-v2"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { Snapshot } from "../../src/snapshot"
import { tmpdir } from "../fixture/fixture"

let cfg: string | undefined

beforeEach(() => {
  cfg = process.env.OPENCODE_CONFIG_CONTENT
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ snapshot: true })
})

afterEach(() => {
  if (cfg === undefined) {
    delete process.env.OPENCODE_CONFIG_CONTENT
    return
  }
  process.env.OPENCODE_CONFIG_CONTENT = cfg
})

test("conversation mode reverts messages but keeps files", async () => {
  await using tmp = await tmpdir({ git: true, config: { snapshot: true } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Create a session
      const session = await Session.create({})
      const sessionID = session.id

      // Create a user message with file modification intent
      const userMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID,
        agent: "default",
        model: {
          providerID: "openai",
          modelID: "gpt-4",
        },
        time: {
          created: Date.now(),
        },
      })

      // Add text part to user message
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsg.id,
        sessionID,
        type: "text",
        text: "Modify test.txt",
      })

      // Create assistant response with patch
      const assistantMsg: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
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
        modelID: "gpt-4",
        providerID: "openai",
        parentID: userMsg.id,
        time: {
          created: Date.now(),
        },
        finish: "end_turn",
      }
      await Session.updateMessage(assistantMsg)

      // Create test file
      const filePath = path.join(tmp.path, "test.txt")
      const originalContent = "ORIGINAL"
      await Bun.write(filePath, originalContent)

      // Add patch part to assistant message
      const patchPart: MessageV2.PatchPart = {
        id: Identifier.ascending("part"),
        sessionID,
        messageID: assistantMsg.id,
        type: "patch",
        hash: "abc123",
        files: ["test.txt"],
      }
      await Session.updatePart(patchPart)

      // Modify file
      const modifiedContent = "MODIFIED"
      await Bun.write(filePath, modifiedContent)

      // Verify file is modified
      expect(await Bun.file(filePath).text()).toBe(modifiedContent)

      // Revert with conversation mode
      await SessionRevert.revert({
        sessionID,
        messageID: assistantMsg.id,
        mode: "conversation",
      })

      // Verify file content is unchanged
      expect(await Bun.file(filePath).text()).toBe(modifiedContent)

      // Verify session.revert.mode is "conversation"
      const updatedSession = await Session.get(sessionID)
      expect(updatedSession.revert?.mode).toBe("conversation")
    },
  })
})

test("default revert reverts code when messages share timestamp", async () => {
  await using tmp = await tmpdir({ git: true, config: { snapshot: true } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const sessionID = session.id
      const now = Date.now()

      const userMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID,
        agent: "default",
        model: {
          providerID: "openai",
          modelID: "gpt-4",
        },
        time: {
          created: now,
        },
      })

      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsg.id,
        sessionID,
        type: "text",
        text: "Modify test.txt",
      })

      const assistantMsg: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
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
        modelID: "gpt-4",
        providerID: "openai",
        parentID: userMsg.id,
        time: {
          created: now,
        },
        finish: "end_turn",
      }
      await Session.updateMessage(assistantMsg)

      const filePath = path.join(tmp.path, "test.txt")
      await Bun.write(filePath, "ORIGINAL")

      const hash = await Snapshot.track()
      expect(hash).toBeTruthy()

      await Bun.write(filePath, "MODIFIED")

      const patch = await Snapshot.patch(hash!)
      expect(patch.files.length).toBeGreaterThan(0)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID,
        messageID: assistantMsg.id,
        type: "patch",
        hash: patch.hash,
        files: patch.files.map((x) => path.relative(tmp.path, x).replaceAll("\\", "/")),
      })

      const messages = await Session.messages({ sessionID })
      expect(messages.map((x) => x.info.id)).toEqual([userMsg.id, assistantMsg.id])

      await SessionRevert.revert({
        sessionID,
        messageID: userMsg.id,
      })

      expect(await Bun.file(filePath).text()).toBe("ORIGINAL")
    },
  })
})

test("default revert still reverts conversation and code", async () => {
  await using tmp = await tmpdir({ git: true, config: { snapshot: true } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const sessionID = session.id

      const userMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID,
        agent: "default",
        model: {
          providerID: "openai",
          modelID: "gpt-4",
        },
        time: {
          created: Date.now(),
        },
      })

      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsg.id,
        sessionID,
        type: "text",
        text: "Modify test.txt",
      })

      const assistantMsg: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
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
        modelID: "gpt-4",
        providerID: "openai",
        parentID: userMsg.id,
        time: {
          created: Date.now(),
        },
        finish: "end_turn",
      }
      await Session.updateMessage(assistantMsg)

      const filePath = path.join(tmp.path, "test.txt")
      const originalContent = "ORIGINAL"
      await Bun.write(filePath, originalContent)

      const hash = await Snapshot.track()
      expect(hash).toBeTruthy()

      const modifiedContent = "MODIFIED"
      await Bun.write(filePath, modifiedContent)

      const patch = await Snapshot.patch(hash!)
      expect(patch.files.length).toBeGreaterThan(0)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID,
        messageID: assistantMsg.id,
        type: "patch",
        hash: patch.hash,
        files: patch.files.map((x) => path.relative(tmp.path, x).replaceAll("\\", "/")),
      })

      expect(await Bun.file(filePath).text()).toBe(modifiedContent)

      await SessionRevert.revert({
        sessionID,
        messageID: userMsg.id,
      })

      expect(await Bun.file(filePath).text()).toBe(originalContent)

      const updatedSession = await Session.get(sessionID)
      expect(updatedSession.revert?.mode).toBe("conversation_and_code")
    },
  })
})

test("sequential revert keeps prior conversation mode", async () => {
  await using tmp = await tmpdir({ git: true, config: { snapshot: true } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const sessionID = session.id

      const userMsg1 = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID,
        agent: "default",
        model: {
          providerID: "openai",
          modelID: "gpt-4",
        },
        time: {
          created: Date.now(),
        },
      })

      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsg1.id,
        sessionID,
        type: "text",
        text: "First message",
      })

      const assistantMsg1: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
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
        modelID: "gpt-4",
        providerID: "openai",
        parentID: userMsg1.id,
        time: {
          created: Date.now(),
        },
        finish: "end_turn",
      }
      await Session.updateMessage(assistantMsg1)

      const filePath = path.join(tmp.path, "test.txt")
      const originalContent = "ORIGINAL"
      await Bun.write(filePath, originalContent)

      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID,
        messageID: assistantMsg1.id,
        type: "text",
        text: "First response",
      })

      const userMsg2 = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID,
        agent: "default",
        model: {
          providerID: "openai",
          modelID: "gpt-4",
        },
        time: {
          created: Date.now(),
        },
      })

      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsg2.id,
        sessionID,
        type: "text",
        text: "Second message",
      })

      const assistantMsg2: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
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
        modelID: "gpt-4",
        providerID: "openai",
        parentID: userMsg2.id,
        time: {
          created: Date.now(),
        },
        finish: "end_turn",
      }
      await Session.updateMessage(assistantMsg2)

      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID,
        messageID: assistantMsg2.id,
        type: "text",
        text: "Second response",
      })

      const snap = await Snapshot.track()
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID,
        messageID: assistantMsg2.id,
        type: "patch",
        hash: snap ?? "",
        files: ["test.txt"],
      })

      const modifiedContent = "MODIFIED"
      await Bun.write(filePath, modifiedContent)

      await SessionRevert.revert({
        sessionID,
        messageID: userMsg2.id,
        mode: "conversation",
      })

      let updatedSession = await Session.get(sessionID)
      expect(updatedSession.revert?.mode).toBe("conversation")

      await SessionRevert.revert({
        sessionID,
        messageID: userMsg1.id,
      })

      updatedSession = await Session.get(sessionID)
      expect(updatedSession.revert?.mode).toBe("conversation")
      expect(await Bun.file(filePath).text()).toBe(modifiedContent)
    },
  })
})
