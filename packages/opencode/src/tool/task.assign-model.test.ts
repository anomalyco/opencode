import { expect, spyOn, test } from "bun:test"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { SessionID, MessageID } from "../session/schema"
import { Instance } from "../project/instance"
import { TaskTool } from "./task"
import { tmpdir } from "../../test/fixture/fixture"

test("task tool uses assigned subagent model", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      subagent_model_assignments: {
        general: "openai/gpt-4.1",
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.create({})
      const metadataCalls: Array<{ metadata?: { model?: { providerID: string; modelID: string } } }> = []

      const getSpy = spyOn(MessageV2, "get").mockResolvedValue({
        info: {
          role: "assistant",
          providerID: "opencode",
          modelID: "kimi-k2.5-free",
        } as any,
        parts: [],
      })
      const promptSpy = spyOn(SessionPrompt, "prompt").mockResolvedValue({
        info: {
          id: MessageID.make("msg_result"),
        },
        parts: [{ type: "text", text: "assigned model" }],
      } as any)

      try {
        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Test task",
            prompt: "check model",
            subagent_type: "general",
          },
          {
            sessionID: parent.id,
            messageID: MessageID.make("msg_parent"),
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata(input) {
              metadataCalls.push(input as any)
            },
            ask: async () => {},
          },
        )

        const selectedModel = metadataCalls[0]?.metadata?.model
        expect(selectedModel).toBeDefined()
        expect(String(selectedModel?.providerID)).toBe("openai")
        expect(String(selectedModel?.modelID)).toBe("gpt-4.1")

        const promptInput = promptSpy.mock.calls[0]?.[0] as any
        expect(promptInput).toBeDefined()
        expect(promptInput.agent).toBe("general")
        expect(String(promptInput.model.providerID)).toBe("openai")
        expect(String(promptInput.model.modelID)).toBe("gpt-4.1")

        expect(result.output).toContain("<task_result>")
        expect(result.output).toContain("assigned model")
      } finally {
        getSpy.mockRestore()
        promptSpy.mockRestore()
      }
    },
  })
})
