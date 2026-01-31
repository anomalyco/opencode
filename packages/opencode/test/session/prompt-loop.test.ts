import { describe, expect, test } from "bun:test"
import path from "path"

const projectRoot = path.join(__dirname, "../..")

// Ensure isolated XDG dirs even when running this test file directly.
await import("../preload")

const { Identifier } = await import("../../src/id/id")
const { Instance } = await import("../../src/project/instance")
const { Session } = await import("../../src/session")
const { SessionPrompt } = await import("../../src/session/prompt")

describe("SessionPrompt.loop", () => {
  test("exits when assistant finish is unknown but text exists", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        try {
          const userId = Identifier.ascending("message")
          await Session.updateMessage({
            id: userId,
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "sisyphus",
            model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: userId,
            sessionID: session.id,
            type: "text",
            text: "ping",
            time: { start: Date.now(), end: Date.now() },
          })

          const assistantId = Identifier.ascending("message")
          await Session.updateMessage({
            id: assistantId,
            parentID: userId,
            role: "assistant",
            mode: "sisyphus",
            agent: "sisyphus",
            path: { cwd: Instance.directory, root: Instance.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: "unknown",
            modelID: "claude-sonnet-4-5",
            providerID: "anthropic",
            time: { created: Date.now(), completed: Date.now() },
            sessionID: session.id,
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: assistantId,
            sessionID: session.id,
            type: "text",
            text: "pong",
            time: { start: Date.now(), end: Date.now() },
          })

          const result = (await Promise.race([
            SessionPrompt.loop(session.id),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1_000)),
          ])) as Awaited<ReturnType<typeof SessionPrompt.loop>>

          expect(result.info.id).toBe(assistantId)
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })
})
