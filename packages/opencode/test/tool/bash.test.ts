import { describe, expect, test, mock } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Mock Permission.ask to auto-allow in tests
Permission.ask = mock(async () => {
  return
})

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

  test("cd ../ should fail outside of project root", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        expect(
          bash.execute(
            {
              command: "cd ../",
              description: "Try to cd to parent directory",
            },
            ctx,
          ),
        ).rejects.toThrow("This command references paths outside of")
      },
    })
  })

  test("should allow commands when bash permission='allow' via wildcard", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with bash='allow' via wildcard
    Agent.get = mock(async () => ({
      permission: {
        edit: "allow" as const,
        bash: { "*": "allow" as const },
        webfetch: "allow" as const,
        external_directory: "ask" as const,
        doom_loop: "ask" as const,
      },
    })) as any

    const originalAsk = Permission.ask
    const permissionAskMock = mock(async () => {})
    Permission.ask = permissionAskMock

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "echo 'permission test'",
              description: "Test bash permission",
            },
            ctx,
          )

          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output).toContain("permission test")

          // Verify Permission.ask was NOT called
          expect(permissionAskMock).not.toHaveBeenCalled()
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should deny commands when bash permission='deny' via wildcard", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with bash='deny' via wildcard
    Agent.get = mock(async () => ({
      permission: {
        edit: "allow" as const,
        bash: { "*": "deny" as const },
        webfetch: "allow" as const,
        external_directory: "ask" as const,
        doom_loop: "ask" as const,
      },
    })) as any

    const originalAsk = Permission.ask
    const permissionAskMock = mock(async () => {})
    Permission.ask = permissionAskMock

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          await expect(
            bash.execute(
              {
                command: "echo 'should be denied'",
                description: "Test bash permission deny",
              },
              ctx,
            ),
          ).rejects.toThrow("Permission denied: Command not allowed by bash permissions")

          // Verify Permission.ask was NOT called
          expect(permissionAskMock).not.toHaveBeenCalled()
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should ask for permission when bash permission='ask' via wildcard", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with bash='ask' via wildcard
    Agent.get = mock(async () => ({
      permission: {
        edit: "allow" as const,
        bash: { "*": "ask" as const },
        webfetch: "allow" as const,
        external_directory: "ask" as const,
        doom_loop: "ask" as const,
      },
    })) as any

    const originalAsk = Permission.ask
    const permissionAskMock = mock(async (input: any) => {
      expect(input.type).toBe("bash")
      // Resolve without throwing to simulate user approval
    })
    Permission.ask = permissionAskMock

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "echo 'ask permission'",
              description: "Test bash permission ask",
            },
            ctx,
          )

          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output).toContain("ask permission")

          // Verify Permission.ask WAS called
          expect(permissionAskMock).toHaveBeenCalled()
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should deny when no wildcard match (undefined permission)", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with specific command allowed, but not echo
    Agent.get = mock(async () => ({
      permission: {
        edit: "allow" as const,
        bash: { "ls *": "allow" as const }, // Only ls is allowed
        webfetch: "allow" as const,
        external_directory: "ask" as const,
        doom_loop: "ask" as const,
      },
    })) as any

    const originalAsk = Permission.ask
    const permissionAskMock = mock(async () => {})
    Permission.ask = permissionAskMock

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          // echo doesn't match any pattern, should default to deny
          await expect(
            bash.execute(
              {
                command: "echo 'no match'",
                description: "Test undefined permission",
              },
              ctx,
            ),
          ).rejects.toThrow("Permission denied: Command not allowed by bash permissions")

          // Verify Permission.ask was NOT called
          expect(permissionAskMock).not.toHaveBeenCalled()
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })
})
