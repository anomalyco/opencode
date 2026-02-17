import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { TaskTool } from "../../src/tool/task"
import type { Tool } from "../../src/tool/tool"
import * as AgentModule from "../../src/agent/agent"
import * as ConfigModule from "../../src/config/config"
import * as MessageV2Module from "../../src/session/message-v2"
import * as PermissionNextModule from "../../src/permission/next"
import * as SessionModule from "../../src/session"
import * as SessionPromptModule from "../../src/session/prompt"

const ctx: Tool.Context = {
  sessionID: "parent-session",
  messageID: "parent-message",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.task", () => {
  const restorers: Array<() => void> = []

  function remember<T extends { mockRestore(): void }>(spy: T) {
    restorers.push(() => spy.mockRestore())
    return spy
  }

  beforeEach(() => {
    remember(
      spyOn(AgentModule.Agent, "list").mockResolvedValue([
        {
          name: "general",
          mode: "subagent",
          description: "General worker",
          options: {},
          permission: [],
        } as any,
      ]),
    )
    remember(
      spyOn(PermissionNextModule.PermissionNext, "evaluate").mockReturnValue({
        action: "allow",
      } as any),
    )
    remember(
      spyOn(ConfigModule.Config, "get").mockResolvedValue({
        experimental: {
          primary_tools: [],
        },
      } as any),
    )
    remember(
      spyOn(AgentModule.Agent, "get").mockResolvedValue({
        name: "general",
        mode: "subagent",
        description: "General worker",
        options: {},
        permission: [],
      } as any),
    )
    remember(
      spyOn(SessionModule.Session, "create").mockResolvedValue({
        id: "task-session-123",
      } as any),
    )
    remember(
      spyOn(MessageV2Module.MessageV2, "get").mockResolvedValue({
        info: {
          role: "assistant",
          modelID: "gpt-5",
          providerID: "openai",
        },
      } as any),
    )
    remember(
      spyOn(SessionPromptModule.SessionPrompt, "resolvePromptParts").mockResolvedValue([
        { type: "text", text: "do work" },
      ] as any),
    )
    remember(spyOn(SessionPromptModule.SessionPrompt, "cancel").mockImplementation(() => {}))
  })

  afterEach(() => {
    while (restorers.length > 0) {
      const restore = restorers.pop()
      restore?.()
    }
  })

  test("returns task_id and task_error output when subagent prompt fails", async () => {
    remember(
      spyOn(SessionPromptModule.SessionPrompt, "prompt").mockRejectedValue(new Error("Tool execution aborted")),
    )

    const tool = await TaskTool.init()
    const result = await tool.execute(
      {
        description: "Analyze auth flow",
        prompt: "inspect auth implementation",
        subagent_type: "general",
      },
      ctx,
    )

    expect(result.metadata.sessionId).toBe("task-session-123")
    expect(result.output).toContain("task_id: task-session-123")
    expect(result.output).toContain("<task_error>")
    expect(result.output).toContain("Tool execution aborted")
    expect(result.output).toContain("</task_error>")
  })

  test("keeps success path unchanged and still returns task_id", async () => {
    remember(
      spyOn(SessionPromptModule.SessionPrompt, "prompt").mockResolvedValue({
        parts: [{ type: "text", text: "completed" }],
      } as any),
    )

    const tool = await TaskTool.init()
    const result = await tool.execute(
      {
        description: "Analyze auth flow",
        prompt: "inspect auth implementation",
        subagent_type: "general",
      },
      ctx,
    )

    expect(result.metadata.sessionId).toBe("task-session-123")
    expect(result.output).toContain("task_id: task-session-123")
    expect(result.output).toContain("<task_result>")
    expect(result.output).toContain("completed")
    expect(result.output).toContain("</task_result>")
  })
})
