import { describe, expect, test } from "bun:test"
import { App } from "../../src/app/app"
import { BashTool } from "../../src/tool/bash"

const ctx = {
  sessionID: "test",
  messageID: "",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.bash", () => {
  describe("sudo detection", () => {
    test("error message format", async () => {
      await App.provide({ cwd: process.cwd() }, async () => {
        try {
          await BashTool.execute(
            { command: "sudo apt update", description: "Test sudo error" },
            ctx,
          )
        } catch (error) {
          expect((error as Error).message).toMatchSnapshot()
        }
      })
    })

    test("rejects commands starting with sudo", async () => {
      await App.provide({ cwd: process.cwd() }, async () => {
        const sudoCommands = [
          "sudo apt update",
          "sudo -u user command",
          "sudo",
          "  sudo command",
          "sudo -i",
          "sudo su",
        ]

        for (const command of sudoCommands) {
          expect(
            BashTool.execute({ command, description: "Test sudo" }, ctx),
          ).rejects.toThrow(/Sudo commands are not supported/)
        }
      })
    })

    test("rejects sudo in command chains", async () => {
      await App.provide({ cwd: process.cwd() }, async () => {
        const chainedSudoCommands = [
          "echo test; sudo apt update",
          "echo test && sudo command",
          "echo test || sudo command",
          "cat file | sudo tee output",
        ]

        for (const command of chainedSudoCommands) {
          expect(
            BashTool.execute(
              { command, description: "Test chained sudo" },
              ctx,
            ),
          ).rejects.toThrow(/Sudo commands are not supported/)
        }
      })
    })

    test("allows commands with sudo in non-command context", async () => {
      await App.provide({ cwd: process.cwd() }, async () => {
        const validCommands = [
          {
            command: "echo 'sudo is mentioned but not a command'",
            expectExit: 0,
          },
          { command: "echo sudo | cat", expectExit: 0 },
          { command: "echo test && echo sudo", expectExit: 0 },
          { command: "echo mysudo", expectExit: 0 },
          { command: "echo test | grep test", expectExit: 0 },
        ]

        for (const { command, expectExit } of validCommands) {
          const result = await BashTool.execute(
            { command, description: "Test non-sudo" },
            ctx,
          )
          expect(result).toBeDefined()
          expect(result.metadata.exit).toBe(expectExit)
        }
      })
    })
  })

  describe("basic functionality", () => {
    test("executes simple commands", async () => {
      await App.provide({ cwd: process.cwd() }, async () => {
        const result = await BashTool.execute(
          { command: "echo 'Hello, World!'", description: "Test echo" },
          ctx,
        )
        expect(result.output).toContain("Hello, World!")
        expect(result.metadata.exit).toBe(0)
      })
    })

    test("handles command errors", async () => {
      await App.provide({ cwd: process.cwd() }, async () => {
        const result = await BashTool.execute(
          { command: "exit 1", description: "Test error" },
          ctx,
        )
        expect(result.metadata.exit).toBe(1)
      })
    })

    test("respects timeout", async () => {
      await App.provide({ cwd: process.cwd() }, async () => {
        const result = await BashTool.execute(
          {
            command: "sleep 0.1 && echo done",
            description: "Test timeout",
            timeout: 200, // 200ms timeout, sleep is 100ms so should succeed
          },
          ctx,
        )
        expect(result.output).toContain("done")
      })
    })
  })
})
