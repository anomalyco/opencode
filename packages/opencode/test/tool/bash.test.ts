import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test("cd ../ should ask for permission for external directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Execute in the background - don't await since it may block on permission
        const executePromise = bash.execute(
          {
            command: "cd ../",
            description: "Try to cd to parent directory",
          },
          ctx,
        )
        // Poll for permission request with timeout
        const maxAttempts = 50
        let attempts = 0
        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          if (Permission.pending()[ctx.sessionID]) break
          attempts++
        }
        expect(Permission.pending()[ctx.sessionID]).toBeDefined()
        // Clean up - reject the permission to allow the promise to resolve
        Permission.respond(ctx.sessionID, false)
        await executePromise.catch(() => {})
      },
    })
  })
})
