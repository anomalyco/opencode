import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.task", () => {
  afterEach(() => {
    mock.restore()
  })

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

  test("returns the latest non-empty text from a subagent result", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          build: {
            description: "Build agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        if (!build) throw new Error("expected build agent")

        const tool = await TaskTool.init({ agent: build })

        const sessionID = SessionID.make("ses_parent")
        const messageID = MessageID.make("msg_parent")
        const subtaskID = SessionID.make("ses_subtask")

        const createSpy = spyOn(Session, "create").mockResolvedValue({ id: subtaskID } as any)
        const messageSpy = spyOn(MessageV2, "get").mockResolvedValue({
          info: {
            role: "assistant",
            modelID: "gpt-5.2",
            providerID: "openai",
          },
          parts: [],
        } as any)
        const configSpy = spyOn(Config, "get").mockResolvedValue({ experimental: {} } as any)
        const resolveSpy = spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([
          { type: "text", text: "work" },
        ] as any)
        const promptSpy = spyOn(SessionPrompt, "prompt").mockResolvedValue({
          parts: [
            { type: "text", text: "draft" },
            { type: "text", text: "final answer" },
            { type: "text", text: "" },
          ],
        } as any)

        const result = await tool.execute(
          {
            description: "Inspect",
            prompt: "Do work",
            subagent_type: "build",
          },
          {
            sessionID,
            messageID,
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )

        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(messageSpy).toHaveBeenCalledWith({ sessionID, messageID })
        expect(configSpy).toHaveBeenCalledTimes(1)
        expect(resolveSpy).toHaveBeenCalledWith("Do work")
        expect(promptSpy).toHaveBeenCalledTimes(1)
        expect(result.output).toContain("final answer")
        expect(result.output).not.toContain("\n\ndraft\n")
      },
    })
  })
})
