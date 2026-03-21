import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

const providerID = ProviderID.make("test")
const modelID = ModelID.make("test-model")

async function seed() {
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID, modelID },
  })
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "assistant",
    time: { created: Date.now() },
    parentID: user.id,
    modelID,
    providerID,
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  })
  return { session, msg }
}

function reply(text: string, error?: MessageV2.Assistant["error"]): MessageV2.WithParts {
  const messageID = MessageID.ascending()
  return {
    info: {
      id: messageID,
      sessionID: SessionID.make("child"),
      role: "assistant",
      time: { created: Date.now() },
      error,
      parentID: MessageID.ascending(),
      modelID,
      providerID,
      mode: "alpha",
      agent: "alpha",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: text
      ? [
          {
            id: PartID.ascending(),
            sessionID: SessionID.make("child"),
            messageID,
            type: "text",
            text,
          },
        ]
      : [],
  }
}

function ctx(sessionID: SessionID, messageID: MessageID) {
  return {
    sessionID,
    messageID,
    agent: "build",
    abort: new AbortController().signal,
    extra: { bypassAgentCheck: true },
    messages: [],
    metadata() {},
    ask: async () => {},
  }
}

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

  test("returns the child assistant text when the subagent succeeds", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
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
        const tool = await TaskTool.init({ agent: build })
        const input = await seed()
        const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(reply("subagent finished"))

        try {
          const result = await tool.execute(
            {
              description: "Run alpha",
              prompt: "Finish the task",
              subagent_type: "alpha",
            },
            ctx(input.session.id, input.msg.id),
          )

          expect(result.output).toContain("task_id:")
          expect(result.output).toContain("<task_result>")
          expect(result.output).toContain("subagent finished")
        } finally {
          prompt.mockRestore()
        }
      },
    })
  })

  test("throws the child provider error when the subagent fails", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
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
        const tool = await TaskTool.init({ agent: build })
        const input = await seed()
        const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(
          reply(
            "",
            new MessageV2.APIError({
              message: "Anthropic rate limit exceeded",
              isRetryable: true,
            }).toObject() as MessageV2.APIError,
          ),
        )

        try {
          await expect(
            tool.execute(
              {
                description: "Run alpha",
                prompt: "Finish the task",
                subagent_type: "alpha",
              },
              ctx(input.session.id, input.msg.id),
            ),
          ).rejects.toThrow("Anthropic rate limit exceeded")
        } finally {
          prompt.mockRestore()
        }
      },
    })
  })
})
