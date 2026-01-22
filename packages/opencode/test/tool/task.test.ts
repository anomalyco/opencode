import { describe, expect, test } from "bun:test"
import path from "path"
import { TaskTool } from "../../src/tool/task"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Tool } from "../../src/tool/tool"

const projectRoot = path.join(__dirname, "../..")

describe("tool.task", () => {
  test("handles invalid session_id gracefully", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "assistant",
          parentID: Identifier.ascending("message"),
          modelID: "dummy-model",
          providerID: "dummy-provider",
          mode: "auto",
          agent: "primary",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 }
          },
          time: { created: Date.now() }
        })

        const ctx: Tool.Context = {
          sessionID: session.id,
          messageID: messageID,
          agent: "primary",
          abort: AbortSignal.any([]),
          metadata: () => {},
          ask: async () => {},
        }

        let error: Error | undefined
        try {
          const task = await TaskTool.init({ agent: { name: "primary" } as any })
          await task.execute(
            {
              description: "test subtask",
              prompt: "do something",
              subagent_type: "explore",
              session_id: "invalid_id_format",
            },
            ctx,
          )
        } catch (e) {
          error = e as Error
        }
        expect(error).toBeDefined()
        expect(error?.message).not.toContain("Invalid string: must start with")
      }
    })
  })
})
