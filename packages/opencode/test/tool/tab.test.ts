import { describe, expect, test } from "bun:test"
import { TabTool } from "../../src/tool/tab"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
  extra: { bypassAgentCheck: true },
}

describe("tool.tab", () => {
  test("init returns tool with description and parameters", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TabTool.init()
        expect(tool.description).toBeTruthy()
        expect(tool.parameters).toBeDefined()
      },
    })
  })

  test("execute throws for non-existent agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TabTool.init()
        await expect(
          tool.execute(
            {
              description: "Test task",
              prompt: "Do something",
              subagent_type: "nonexistent_agent_xyz",
            },
            ctx,
          ),
        ).rejects.toThrow("Unknown agent type")
      },
    })
  })

  test("parameter schema validates required fields", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TabTool.init()
        const schema = tool.parameters
        const valid = schema.safeParse({
          description: "A task",
          prompt: "Do it",
          subagent_type: "coder",
        })
        expect(valid.success).toBe(true)

        const missing = schema.safeParse({
          description: "A task",
        })
        expect(missing.success).toBe(false)
      },
    })
  })

  test("parameter schema accepts optional label and directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TabTool.init()
        const schema = tool.parameters
        const result = schema.safeParse({
          description: "A task",
          prompt: "Do it",
          subagent_type: "coder",
          label: "My Tab",
          directory: "/tmp/work",
        })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.label).toBe("My Tab")
          expect(result.data.directory).toBe("/tmp/work")
        }
      },
    })
  })
})
