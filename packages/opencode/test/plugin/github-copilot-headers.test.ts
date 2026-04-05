import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { CopilotAuthPlugin } from "../../src/plugin/github-copilot/copilot"

function fake(parts: Array<{ type: string; synthetic?: boolean }>, parent?: string) {
  const client = {
    session: {
      message: async () => ({
        data: {
          parts,
        },
      }),
      get: async () => ({
        data: {
          parentID: parent,
        },
      }),
    },
  }

  return {
    client,
    directory: "/tmp",
  } as unknown as PluginInput
}

async function run(input: PluginInput) {
  const hooks = await CopilotAuthPlugin(input)
  const hook = hooks["chat.headers"]
  if (!hook) throw new Error("missing chat.headers hook")

  const out = { headers: {} as Record<string, string> }
  await hook(
    {
      sessionID: "ses_1",
      agent: "build",
      model: {
        providerID: "github-copilot",
        modelID: "gpt-5.3-codex",
        api: {
          npm: "@ai-sdk/openai-compatible",
        },
      },
      provider: {
        source: "config",
        info: {} as never,
        options: {},
      },
      message: {
        id: "msg_1",
        sessionID: "ses_1",
      },
    } as unknown as Parameters<NonNullable<(typeof hooks)["chat.headers"]>>[0],
    out,
  )
  return out.headers["x-initiator"]
}

describe("plugin.github-copilot.chat.headers", () => {
  test("marks compaction continuation synthetic user message as agent initiated", async () => {
    const val = await run(fake([{ type: "text", synthetic: true }]))
    expect(val).toBe("agent")
  })

  test("marks compaction part message as agent initiated", async () => {
    const val = await run(fake([{ type: "compaction" }]))
    expect(val).toBe("agent")
  })

  test("marks subagent session messages as agent initiated", async () => {
    const val = await run(fake([{ type: "text" }], "ses_parent"))
    expect(val).toBe("agent")
  })

  test("keeps normal primary user message as user initiated", async () => {
    const val = await run(fake([{ type: "text" }]))
    expect(val).toBeUndefined()
  })
})
