import { describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskTool } from "../../src/tool/task"
import type { Tool } from "../../src/tool/tool"
import { tmpdir } from "../fixture/fixture"

const primary = {
  name: "primary",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
} satisfies Agent.Info

const subagent = {
  name: "build",
  mode: "subagent",
  description: "Build agent",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
} satisfies Agent.Info

function assistant(id: string, session: string, parent: string): MessageV2.Assistant {
  return {
    id,
    sessionID: session,
    role: "assistant",
    parentID: parent,
    time: { created: Date.now() },
    modelID: "test-model",
    providerID: "test",
    mode: primary.name,
    agent: primary.name,
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as unknown as MessageV2.Assistant
}

describe("tool.task", () => {
  test("rejects non-positive subagent timeout", async () => {
    await using tmp = await tmpdir({
      git: true,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = spyOn(Agent, "list").mockImplementation(async () => [subagent])
        const get = spyOn(Agent, "get").mockImplementation(async (name) => (name === subagent.name ? subagent : primary))
        const prompt = spyOn(SessionPrompt, "prompt")

        try {
          const tool = await TaskTool.init({ agent: primary })
          const abort = new AbortController()
          const ctx = {
            sessionID: "session",
            messageID: "message",
            agent: primary.name,
            abort: abort.signal,
            messages: [],
            extra: {
              bypassAgentCheck: true,
              subagentTimeout: 0,
            },
            metadata() {},
            async ask() {},
          } satisfies Tool.Context

          await expect(
            tool.execute(
              {
                description: "bad timeout",
                prompt: "wait forever",
                subagent_type: subagent.name,
              },
              ctx,
            ),
          ).rejects.toThrow("Invalid subagent timeout value: 0. Timeout must be greater than 0.")
          expect(get).not.toHaveBeenCalled()
          expect(prompt).not.toHaveBeenCalled()
        } finally {
          list.mockRestore()
          get.mockRestore()
          prompt.mockRestore()
        }
      },
    })
  })

  test("cancels subagent prompt and reports timeout", async () => {
    await using tmp = await tmpdir({
      git: true,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const parent = Identifier.ascending("message")
        const message = Identifier.ascending("message")
        await Session.updateMessage(assistant(message, session.id, parent))

        let canceled = 0
        const list = spyOn(Agent, "list").mockImplementation(async () => [subagent])
        const get = spyOn(Agent, "get").mockImplementation(async (name) => (name === subagent.name ? subagent : primary))
        const prompt = spyOn(SessionPrompt, "prompt")
        prompt.mockImplementation((async () => {
          return new Promise<MessageV2.WithParts>(() => {})
        }) as unknown as typeof SessionPrompt.prompt)
        const cancel = spyOn(SessionPrompt, "cancel").mockImplementation(() => {
          canceled++
        })

        try {
          const tool = await TaskTool.init({ agent: primary })
          const abort = new AbortController()
          const ctx = {
            sessionID: session.id,
            messageID: message,
            agent: primary.name,
            abort: abort.signal,
            messages: [],
            extra: {
              bypassAgentCheck: true,
              subagentTimeout: 5,
            },
            metadata() {},
            async ask() {},
          } satisfies Tool.Context

          const result = tool.execute(
            {
              description: "slow task",
              prompt: "wait forever",
              subagent_type: subagent.name,
            },
            ctx,
          )

          await expect(result).rejects.toThrow("Subagent timed out after 5ms")
          expect(prompt).toHaveBeenCalled()
          expect(canceled).toBe(1)
        } finally {
          list.mockRestore()
          get.mockRestore()
          prompt.mockRestore()
          cancel.mockRestore()
          await Session.remove(session.id)
        }
      },
    })
  })
})
