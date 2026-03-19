import { describe, expect, spyOn, test } from "bun:test"
import { TaskTool } from "../../src/tool/task"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import type { Agent as AgentNamespace } from "../../src/agent/agent"

const ctx = {
  sessionID: SessionID.make("ses_parent"),
  messageID: MessageID.make("msg_parent"),
  callID: "call-task",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.task", () => {
  test("does not hard-disable todo tools for subagents that allow them", async () => {
    const subagent = {
      name: "todo-enabled-subagent",
      mode: "subagent",
      options: {},
      permission: [
        { permission: "todowrite", pattern: "*", action: "allow" },
        { permission: "todoread", pattern: "*", action: "allow" },
      ],
    } satisfies AgentNamespace.Info

    let createdSessionInput: any
    let promptInput: any

    const listSpy = spyOn(Agent, "list").mockResolvedValue([subagent])
    const getSpy = spyOn(Agent, "get").mockImplementation((async () => subagent) as any)
    const configSpy = spyOn(Config, "get").mockResolvedValue({ experimental: {} } as any)
    const createSpy = spyOn(Session, "create").mockImplementation((async (input: any) => {
      createdSessionInput = input
      return { id: SessionID.make("ses_child") } as any
    }) as any)
    const messageSpy = spyOn(MessageV2, "get").mockResolvedValue({
      info: {
        role: "assistant",
        modelID: "gpt-test",
        providerID: "openai",
      },
      parts: [],
    } as any)
    const resolveSpy = spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([
      { type: "text", text: "diagnose" },
    ] as any)
    const promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
      promptInput = input
      return {
        parts: [{ type: "text", text: "done" }],
      } as any
    }) as any)

    try {
      const tool = await TaskTool.init()
      await tool.execute(
        {
          description: "Diagnose cluster",
          prompt: "Use todo tools if available",
          subagent_type: subagent.name,
        },
        ctx as any,
      )

      expect(createdSessionInput?.permission?.some((rule: any) => rule.permission === "todowrite")).toBe(false)
      expect(createdSessionInput?.permission?.some((rule: any) => rule.permission === "todoread")).toBe(false)
      expect(promptInput?.tools?.todowrite).toBeUndefined()
      expect(promptInput?.tools?.todoread).toBeUndefined()
      expect(promptInput?.tools?.task).toBe(false)
    } finally {
      promptSpy.mockRestore()
      resolveSpy.mockRestore()
      messageSpy.mockRestore()
      createSpy.mockRestore()
      configSpy.mockRestore()
      getSpy.mockRestore()
      listSpy.mockRestore()
    }
  })
})
