import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.task", () => {
  test("description sorts subagents by name and is stable across calls", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const first = await TaskTool.init({ agent: build })
        const second = await TaskTool.init({ agent: build })

        expect(first.description).toBe(second.description)

        const alpha = first.description.indexOf("- alpha: Alpha agent")
        const explore = first.description.indexOf("- explore:")
        const general = first.description.indexOf("- general:")
        const zebra = first.description.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      },
    })
  })

  test("task inherits parent variant when omitted", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: {
            providerID: ProviderID.make("test"),
            modelID: ModelID.make("test-model"),
          },
          time: { created: Date.now() },
        })
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user.id,
          sessionID: session.id,
          mode: "build",
          agent: "build",
          variant: "high",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("test-model"),
          providerID: ProviderID.make("test"),
          time: { created: Date.now() },
        })

        const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue({
          info: assistant,
          parts: [],
        })

        try {
          const tool = await TaskTool.init()
          let meta: Record<string, unknown> | undefined
          type Ctx = Parameters<typeof tool.execute>[1]
          const ctx: Ctx = {
            agent: "build",
            sessionID: session.id,
            messageID: assistant.id,
            abort: new AbortController().signal,
            callID: "call-1",
            extra: { bypassAgentCheck: true },
            messages: [],
            ask: async () => {},
            metadata(input) {
              meta = input.metadata
            },
          }

          await tool.execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "general",
            },
            ctx,
          )

          expect(prompt).toHaveBeenCalledTimes(1)
          expect(prompt.mock.calls[0]?.[0].variant).toBe("high")
          expect(meta?.variant).toBe("high")
        } finally {
          prompt.mockRestore()
        }
      },
    })
  })

  test("task ignores supplied variant and inherits parent variant", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: {
            providerID: ProviderID.make("test"),
            modelID: ModelID.make("test-model"),
          },
          time: { created: Date.now() },
        })
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user.id,
          sessionID: session.id,
          mode: "build",
          agent: "build",
          variant: "high",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("test-model"),
          providerID: ProviderID.make("test"),
          time: { created: Date.now() },
        })

        const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue({
          info: assistant,
          parts: [],
        })

        try {
          const tool = await TaskTool.init()
          type Ctx = Parameters<typeof tool.execute>[1]
          const ctx: Ctx = {
            agent: "build",
            sessionID: session.id,
            messageID: assistant.id,
            abort: new AbortController().signal,
            callID: "call-1",
            messages: [],
            ask: async () => {},
            metadata() {},
          }

          await tool.execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "general",
              variant: "low",
            } as Parameters<typeof tool.execute>[0],
            ctx,
          )

          expect(prompt).toHaveBeenCalledTimes(1)
          expect(prompt.mock.calls[0]?.[0].variant).toBe("high")
        } finally {
          prompt.mockRestore()
        }
      },
    })
  })
})
