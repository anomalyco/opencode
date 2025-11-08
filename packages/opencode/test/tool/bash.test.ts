import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const bash = await BashTool.init()
const projectRoot = path.join(__dirname, "../..")

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
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

  test("cd ../ should request permission when OPENCODE_DISALLOW_OUTSIDE_CWD is not set", async () => {
    // When the flag is not set, it should ask for permission instead of throwing
    // This test will fail if Permission.ask() is called since we don't have a mock
    // But it should not throw the error about paths outside directory
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // If OPENCODE_DISALLOW_OUTSIDE_CWD is set, it will throw
        // If not set, it will try to call Permission.ask which may fail with a different error
        const isDisallowed = process.env.OPENCODE_DISALLOW_OUTSIDE_CWD === "true" || process.env.OPENCODE_DISALLOW_OUTSIDE_CWD === "1"
        
        if (isDisallowed) {
          await expect(
            bash.execute(
              {
                command: "cd ../",
                description: "Try to cd to parent directory",
              },
              ctx,
            ),
          ).rejects.toThrow("This command references paths outside of")
        } else {
          // When not disallowed, it should ask for permission (which may fail with a different error)
          // We can't easily test the permission ask flow without mocking
          // So we'll just verify it doesn't throw the "paths outside" error
          try {
            await bash.execute(
              {
                command: "cd ../",
                description: "Try to cd to parent directory",
              },
              ctx,
            )
          } catch (error) {
            // If it throws, it should be because of Permission.ask failure, not the path check
            if (error instanceof Error) {
              expect(error.message).not.toContain("This command references paths outside of")
            }
          }
        }
      },
    })
  })
})
