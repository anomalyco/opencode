import { describe, test, expect, afterEach } from "bun:test"
import { SendMessageTool, AgentListTool } from "../../src/tool/send_message"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-send-message"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("send_message tool", () => {
  test("tool id and description are correct", async () => {
    expect(SendMessageTool.id).toBe("send_message")
    const def = await SendMessageTool.init()
    expect(def.description).toContain("message")
    // Parameters should require sessionID and message
    const ok = def.parameters.safeParse({ sessionID: "ses_abc", message: "hello" })
    expect(ok.success).toBe(true)
    const missing = def.parameters.safeParse({ sessionID: "ses_abc" })
    expect(missing.success).toBe(false)
  })

  test("throws when target session does not exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await SendMessageTool.init()
        expect(tool.execute({ sessionID: "ses_nonexistent", message: "hello" }, ctx)).rejects.toThrow("not found")
      },
    })
  })
})

describe("agent_list tool", () => {
  test("tool id and description are correct", async () => {
    expect(AgentListTool.id).toBe("agent_list")
    const def = await AgentListTool.init()
    expect(def.description).toContain("session")
    // No required params
    expect(def.parameters.safeParse({}).success).toBe(true)
  })

  test("returns empty result when no child sessions exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AgentListTool.init()
        const res = await tool.execute({}, ctx)
        expect(res.output).toContain("No active sub-agent")
        expect(res.metadata.count).toBe(0)
      },
    })
  })
})
