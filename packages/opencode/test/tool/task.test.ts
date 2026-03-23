import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
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

  test("prefers the resolved subtask model over the subagent fallback model", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const explicitModel = {
          providerID: ProviderID.make("opencode"),
          modelID: ModelID.make("kimi-k2.5-free"),
        }

        const userMessage = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: {
            created: Date.now(),
          },
          agent: "build",
          model: explicitModel,
        })

        const assistantMessage = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          parentID: userMessage.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          time: {
            created: Date.now(),
          },
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: explicitModel.modelID,
          providerID: explicitModel.providerID,
        })

        let capturedPrompt: Parameters<typeof SessionPrompt.prompt>[0] | undefined

        const promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation(
          (async (input: any) => {
            capturedPrompt = input
            return {
              info: assistantMessage,
              parts: [
                {
                  id: PartID.ascending(),
                  messageID: assistantMessage.id,
                  sessionID: assistantMessage.sessionID,
                  type: "text",
                  text: "done",
                },
              ],
            }
          }) as any,
        )

        try {
          const tool = await TaskTool.init()
          await tool.execute(
            {
              description: "delegate",
              prompt: "delegate this task",
              subagent_type: "general",
            },
            {
              sessionID: session.id,
              messageID: assistantMessage.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: {
                bypassAgentCheck: true,
                preferredModel: explicitModel,
              },
              messages: [],
              metadata() {},
              ask: async () => {},
            },
          )
        } finally {
          promptSpy.mockRestore()
        }

        expect(capturedPrompt?.model).toEqual(explicitModel)

        await Session.remove(session.id)
      },
    })
  })
})
