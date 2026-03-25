import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.task", () => {
  async function run(name: string) {
    const session = await Session.create({})
    const messageID = MessageID.ascending()
    await Session.updateMessage({
      id: messageID,
      sessionID: session.id,
      role: "assistant",
      time: {
        created: Date.now(),
        completed: Date.now(),
      },
      parentID: MessageID.ascending(),
      modelID: ModelID.make("gpt-5.2"),
      providerID: ProviderID.make("openai"),
      mode: "",
      agent: "build",
      path: {
        cwd: Instance.worktree,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    })

    let tools: Record<string, boolean> | undefined
    let mocked = true
    const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      tools = input.tools
      return {
        info: {
          role: "assistant",
        },
        parts: [{ type: "text", text: "ok" }],
      } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
    })

    try {
      const build = await Agent.get("build")
      const task = await TaskTool.init({ agent: build })
      const result = await task.execute(
        {
          description: "todo perms",
          prompt: "check",
          subagent_type: name,
        },
        {
          agent: "build",
          sessionID: session.id,
          messageID,
          abort: new AbortController().signal,
          messages: [],
          extra: { bypassAgentCheck: true },
          metadata() {},
          async ask() {},
        },
      )
      const child = await Session.get(result.metadata.sessionId)
      const agent = await Agent.get(name)
      if (!agent) throw new Error(`missing agent: ${name}`)
      const init = Permission.merge(agent.permission, child.permission ?? [])
      if (!tools) throw new Error("task prompt missing tools")
      prompt.mockRestore()
      mocked = false
      await SessionPrompt.prompt({
        sessionID: child.id,
        agent: agent.name,
        model: {
          providerID: ProviderID.make("openai"),
          modelID: ModelID.make("gpt-5.2"),
        },
        noReply: true,
        tools,
        parts: [{ type: "text", text: "noop" }],
      })
      const next = await Session.get(child.id)
      return {
        init,
        tools,
        rules: Permission.merge(agent.permission, next.permission ?? []),
      }
    } finally {
      if (mocked) prompt.mockRestore()
    }
  }

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

  test("subagent defaults todo tools to deny without explicit todo allow", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          todoer: {
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await run("todoer")

        expect(Permission.evaluate("todowrite", "*", result.init).action).toBe("deny")
        expect(Permission.evaluate("todoread", "*", result.init).action).toBe("deny")
        expect(Permission.evaluate("task", "*", result.init).action).toBe("deny")
        expect(Permission.evaluate("todowrite", "*", result.rules).action).toBe("deny")
        expect(Permission.evaluate("todoread", "*", result.rules).action).toBe("deny")
        expect(Permission.evaluate("task", "*", result.rules).action).toBe("deny")
        expect(result.tools).toMatchObject({
          todowrite: false,
          todoread: false,
          task: false,
        })
      },
    })
  })

  test("subagent inherits explicit todowrite allow without enabling todoread", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          todoer: {
            mode: "subagent",
            permission: {
              todowrite: "allow",
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await run("todoer")

        expect(Permission.evaluate("todowrite", "*", result.init).action).toBe("allow")
        expect(Permission.evaluate("todoread", "*", result.init).action).toBe("deny")
        expect(Permission.evaluate("todowrite", "*", result.rules).action).toBe("allow")
        expect(Permission.evaluate("todoread", "*", result.rules).action).toBe("deny")
        expect(result.tools).toEqual({
          todoread: false,
          task: false,
        })
      },
    })
  })

  test("subagent inherits explicit todo read and write allow", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          todoer: {
            mode: "subagent",
            permission: {
              todowrite: "allow",
              todoread: "allow",
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await run("todoer")

        expect(Permission.evaluate("todowrite", "*", result.init).action).toBe("allow")
        expect(Permission.evaluate("todoread", "*", result.init).action).toBe("allow")
        expect(Permission.evaluate("todowrite", "*", result.rules).action).toBe("allow")
        expect(Permission.evaluate("todoread", "*", result.rules).action).toBe("allow")
        expect(result.tools).toEqual({
          task: false,
        })
      },
    })
  })
})
