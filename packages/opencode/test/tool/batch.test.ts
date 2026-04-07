import { describe, expect, test } from "bun:test"
import path from "path"
import * as fs from "fs/promises"
import { BatchTool } from "../../src/tool/batch"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const baseCtx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.batch", () => {
  test("uses the current model tool set for apply_patch", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const batch = await BatchTool.init()
        const file = path.join(tmp.path, "made.txt")

        await batch.execute(
          {
            tool_calls: [
              {
                tool: "apply_patch",
                parameters: {
                  patchText: "*** Begin Patch\n*** Add File: made.txt\n+hello\n*** End Patch",
                },
              },
            ],
          },
          {
            ...baseCtx,
            extra: {
              allow: ["batch", "apply_patch"],
              model: {
                providerID: "openai",
                api: { id: "gpt-5.2" },
              },
            },
          },
        )

        expect(await fs.readFile(file, "utf-8")).toBe("hello\n")
      },
    })
  })

  test("rejects tools that are not enabled for the turn", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const batch = await BatchTool.init()
        const file = path.join(tmp.path, "blocked.txt")

        await batch.execute(
          {
            tool_calls: [
              {
                tool: "apply_patch",
                parameters: {
                  patchText: "*** Begin Patch\n*** Add File: blocked.txt\n+hello\n*** End Patch",
                },
              },
            ],
          },
          {
            ...baseCtx,
            extra: {
              allow: ["batch"],
              model: {
                providerID: "openai",
                api: { id: "gpt-5.2" },
              },
            },
          },
        )

        await expect(fs.access(file)).rejects.toThrow()
      },
    })
  })
})
