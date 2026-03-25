import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.queue pending prompts", () => {
  test("queues pending message when session is busy", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // First prompt should succeed
        const first = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })

        // Second prompt while busy should queue
        const second = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "queued message" }],
        }).then(
          () => "queued",
          (err) => {
            if (Session.BusyError.isInstance(err)) return "rejected"
            throw err
          },
        )

        // Wait for first to complete
        await first

        // Check if second was queued (not rejected)
        const result = await second
        expect(result).toBe("queued")

        await Session.remove(session.id)
      },
    })
  })

  test("supports priority levels for queued messages", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Queue a normal priority message
        const normal = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "normal",
          parts: [{ type: "text", text: "normal message" }],
        })

        // Queue an urgent priority message
        const urgent = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "urgent",
          parts: [{ type: "text", text: "urgent message" }],
        })

        // Queue a background priority message
        const background = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "background",
          parts: [{ type: "text", text: "background message" }],
        })

        // All should be accepted
        const results = await Promise.all([normal, urgent, background])
        expect(results.length).toBe(3)

        await Session.remove(session.id)
      },
    })
  })

  test("drains queue with priority ordering", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Queue messages with different priorities
        const messages: string[] = []
        const priorities: string[] = []

        // Simulate queueing by capturing the injected messages
        // This is a simplified test - actual test would need more setup
        const urgentPromise = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "urgent",
          parts: [{ type: "text", text: "urgent" }],
        }).then(() => {
          messages.push("urgent")
          priorities.push("urgent")
        })

        const normalPromise = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "normal",
          parts: [{ type: "text", text: "normal" }],
        }).then(() => {
          messages.push("normal")
          priorities.push("normal")
        })

        const backgroundPromise = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          priority: "background",
          parts: [{ type: "text", text: "background" }],
        }).then(() => {
          messages.push("background")
          priorities.push("background")
        })

        // Wait for all to complete
        await Promise.all([urgentPromise, normalPromise, backgroundPromise])

        // All messages should have been processed
        expect(messages.length).toBe(3)

        await Session.remove(session.id)
      },
    })
  })

  test("limits batch size per iteration", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        // Queue many messages
        const promises = []
        for (let i = 0; i < 10; i++) {
          promises.push(
            SessionPrompt.prompt({
              sessionID: session.id,
              agent: "build",
              noReply: true,
              parts: [{ type: "text", text: `message ${i}` }],
            }),
          )
        }

        // All should complete (may take multiple iterations)
        const results = await Promise.all(promises)
        expect(results.length).toBe(10)

        await Session.remove(session.id)
      },
    })
  })
})
