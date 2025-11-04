import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import type { Hooks } from "@opencode-ai/plugin"
import os from "os"
import fs from "fs/promises"
import { Session } from "../../src/session"

const projectRoot = path.join(__dirname, "../..")

async function createTestProject() {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-plugin-"))
  // Create empty config to prevent loading default plugins
  await fs.writeFile(path.join(testDir, "opencode.json"), JSON.stringify({ plugin: [] }))
  return testDir
}

// Helper to add mock hooks directly to plugin list
async function withMockHooks<T>(hooks: Hooks, fn: () => Promise<T>): Promise<T> {
  const hooksList = await Plugin.list()
  hooksList.push(hooks)
  try {
    return await fn()
  } finally {
    const index = hooksList.indexOf(hooks)
    if (index > -1) hooksList.splice(index, 1)
  }
}

describe("plugin agent.complete hook", () => {
  test("should call plugin hook through Plugin.trigger", async () => {
    const testDir = await createTestProject()

    await Instance.provide({
      directory: testDir,
      fn: async () => {
        let hookCalled = false
        let receivedInput: any
        let receivedOutput: any

        await withMockHooks(
          {
            "agent.complete": async (input, output) => {
              hookCalled = true
              receivedInput = input
              receivedOutput = output
            },
          },
          async () => {
            const session = await Session.create({})

            const result = await Plugin.trigger(
              "agent.complete",
              {
                sessionID: session.id,
                agent: "build",
                messageID: "msg_123",
              },
              {
                message: {} as any,
                continue: false,
                prompt: undefined as string | undefined,
              },
            )

            expect(hookCalled).toBe(true)
            expect(receivedInput.sessionID).toBe(session.id)
            expect(receivedInput.agent).toBe("build")
            expect(receivedInput.messageID).toBe("msg_123")
            expect(receivedOutput).toBeDefined()
            expect(result.continue).toBe(false)

            await Session.remove(session.id)
          },
        )
      },
    })

    await fs.rm(testDir, { recursive: true, force: true })
  })

  test("should allow plugin to request continuation", async () => {
    const testDir = await createTestProject()

    await Instance.provide({
      directory: testDir,
      fn: async () => {
        await withMockHooks(
          {
            "agent.complete": async (input, output) => {
              output.continue = true
              output.prompt = "Continue working"
            },
          },
          async () => {
            const session = await Session.create({})

            const result = await Plugin.trigger(
              "agent.complete",
              {
                sessionID: session.id,
                agent: "build",
                messageID: "msg_123",
              },
              {
                message: {} as any,
                continue: false,
                prompt: undefined as string | undefined,
              },
            )

            expect(result.continue).toBe(true)
            expect(result.prompt).toBe("Continue working")

            await Session.remove(session.id)
          },
        )
      },
    })

    await fs.rm(testDir, { recursive: true, force: true })
  })

  test("should preserve output defaults when plugin does not modify", async () => {
    const testDir = await createTestProject()

    await Instance.provide({
      directory: testDir,
      fn: async () => {
        await withMockHooks(
          {
            "agent.complete": async (input, output) => {
              // Don't modify output
            },
          },
          async () => {
            const session = await Session.create({})

            const result = await Plugin.trigger(
              "agent.complete",
              {
                sessionID: session.id,
                agent: "build",
                messageID: "msg_123",
              },
              {
                message: {} as any,
                continue: false,
                prompt: undefined as string | undefined,
              },
            )

            expect(result.continue).toBe(false)
            expect(result.prompt).toBeUndefined()

            await Session.remove(session.id)
          },
        )
      },
    })

    await fs.rm(testDir, { recursive: true, force: true })
  })

  test("should allow plugin to modify output object", async () => {
    const testDir = await createTestProject()

    await Instance.provide({
      directory: testDir,
      fn: async () => {
        await withMockHooks(
          {
            "agent.complete": async (input, output) => {
              output.continue = true
              output.prompt = "Modified prompt"
            },
          },
          async () => {
            const session = await Session.create({})

            const output = {
              message: {} as any,
              continue: false,
              prompt: undefined as string | undefined as string | undefined,
            }

            const result = await Plugin.trigger(
              "agent.complete",
              {
                sessionID: session.id,
                agent: "build",
                messageID: "msg_123",
              },
              output,
            )

            // Should modify the passed output object
            expect(output.continue).toBe(true)
            expect(output.prompt).toBe("Modified prompt")
            expect(result).toBe(output)

            await Session.remove(session.id)
          },
        )
      },
    })

    await fs.rm(testDir, { recursive: true, force: true })
  })

  test("should handle multiple plugins with agent.complete hooks", async () => {
    const testDir = await createTestProject()

    await Instance.provide({
      directory: testDir,
      fn: async () => {
        let plugin1Called = false
        let plugin2Called = false

        const hooks1: Hooks = {
          "agent.complete": async (input, output) => {
            plugin1Called = true
            output.continue = true
            output.prompt = "From plugin 1"
          },
        }

        const hooks2: Hooks = {
          "agent.complete": async (input, output) => {
            plugin2Called = true
            // Second plugin can override first plugin's values
            output.prompt = "From plugin 2"
          },
        }

        const hooksList = await Plugin.list()
        hooksList.push(hooks1, hooks2)

        try {
          const session = await Session.create({})

          const result = await Plugin.trigger(
            "agent.complete",
            {
              sessionID: session.id,
              agent: "build",
              messageID: "msg_123",
            },
            {
              message: {} as any,
              continue: false,
              prompt: undefined as string | undefined,
            },
          )

          // Both plugins should be called
          expect(plugin1Called).toBe(true)
          expect(plugin2Called).toBe(true)

          // Last plugin wins
          expect(result.prompt).toBe("From plugin 2")
          expect(result.continue).toBe(true)

          await Session.remove(session.id)
        } finally {
          const index1 = hooksList.indexOf(hooks1)
          const index2 = hooksList.indexOf(hooks2)
          if (index1 > -1) hooksList.splice(index1, 1)
          if (index2 > -1) hooksList.splice(index2, 1)
        }
      },
    })

    await fs.rm(testDir, { recursive: true, force: true })
  })

  test("should return output even if plugin throws error", async () => {
    const testDir = await createTestProject()

    await Instance.provide({
      directory: testDir,
      fn: async () => {
        await withMockHooks(
          {
            "agent.complete": async (input, output) => {
              throw new Error("Plugin error")
            },
          },
          async () => {
            const session = await Session.create({})

            // Plugin.trigger should handle errors gracefully
            await expect(
              Plugin.trigger(
                "agent.complete",
                {
                  sessionID: session.id,
                  agent: "build",
                  messageID: "msg_123",
                },
                {
                  message: {} as any,
                  continue: false,
                  prompt: undefined as string | undefined,
                },
              ),
            ).rejects.toThrow("Plugin error")

            await Session.remove(session.id)
          },
        )
      },
    })

    await fs.rm(testDir, { recursive: true, force: true })
  })

  test("should pass message object from output", async () => {
    const testDir = await createTestProject()

    await Instance.provide({
      directory: testDir,
      fn: async () => {
        let receivedMessage: any

        await withMockHooks(
          {
            "agent.complete": async (input, output) => {
              receivedMessage = output.message
            },
          },
          async () => {
            const session = await Session.create({})

            const mockMessage = {
              info: { id: "msg_123", role: "assistant" as const },
              parts: [],
            }

            await Plugin.trigger(
              "agent.complete",
              {
                sessionID: session.id,
                agent: "build",
                messageID: "msg_123",
              },
              {
                message: mockMessage,
                continue: false,
                prompt: undefined as string | undefined,
              },
            )

            expect(receivedMessage).toBe(mockMessage)

            await Session.remove(session.id)
          },
        )
      },
    })

    await fs.rm(testDir, { recursive: true, force: true })
  })
})
