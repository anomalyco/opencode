import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_test-task-session"),
  messageID: MessageID.make("msg_test-task-message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  mock.restore()
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

  test("creates a fresh session when task_id is invalid", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const tool = await TaskTool.init({ agent: build })
        const msg = MessageV2.WithParts.parse({
          info: {
            id: MessageID.make("msg_test-task-parent"),
            sessionID: ctx.sessionID,
            role: "assistant",
            time: { created: 0 },
            parentID: MessageID.make("msg_test-task-user"),
            modelID: ModelID.make("test-model"),
            providerID: ProviderID.opencode,
            mode: "build",
            agent: "build",
            path: {
              cwd: tmp.path,
              root: tmp.path,
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
          },
          parts: [],
        })
        const out = MessageV2.WithParts.parse({
          info: msg.info,
          parts: [
            {
              id: PartID.make("prt_test-task-reply"),
              sessionID: ctx.sessionID,
              messageID: msg.info.id,
              type: "text",
              text: "done",
            },
          ],
        })

        const get = spyOn(MessageV2, "get").mockResolvedValue(msg)
        const parts = spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([{ type: "text", text: "run" }])
        const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(out)

        const result = await tool.execute(
          {
            description: "Run task",
            prompt: "run",
            subagent_type: "general",
            task_id: "invalid-task-id",
          },
          ctx,
        )

        expect(get).toHaveBeenCalledTimes(1)
        expect(parts).toHaveBeenCalledTimes(1)
        expect(prompt).toHaveBeenCalledTimes(1)
        expect(result.output).toMatch(/^task_id: ses_/)
        expect(result.output).toContain("<task_result>\ndone\n</task_result>")
      },
    })
  })

  test("reuses an existing session when task_id is valid", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const tool = await TaskTool.init({ agent: build })
        const child = await Session.create({
          parentID: ctx.sessionID,
          title: "child",
        })
        const msg = MessageV2.WithParts.parse({
          info: {
            id: MessageID.make("msg_test-task-parent"),
            sessionID: ctx.sessionID,
            role: "assistant",
            time: { created: 0 },
            parentID: MessageID.make("msg_test-task-user"),
            modelID: ModelID.make("test-model"),
            providerID: ProviderID.opencode,
            mode: "build",
            agent: "build",
            path: {
              cwd: tmp.path,
              root: tmp.path,
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
          },
          parts: [],
        })
        const out = MessageV2.WithParts.parse({
          info: msg.info,
          parts: [
            {
              id: PartID.make("prt_test-task-reply"),
              sessionID: child.id,
              messageID: msg.info.id,
              type: "text",
              text: "done",
            },
          ],
        })

        spyOn(MessageV2, "get").mockResolvedValue(msg)
        spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([{ type: "text", text: "run" }])
        spyOn(SessionPrompt, "prompt").mockResolvedValue(out)

        const result = await tool.execute(
          {
            description: "Run task",
            prompt: "run",
            subagent_type: "general",
            task_id: child.id,
          },
          ctx,
        )

        expect(result.output).toContain(`task_id: ${child.id}`)
      },
    })
  })
})
