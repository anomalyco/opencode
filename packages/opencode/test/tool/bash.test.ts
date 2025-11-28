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

  test("description includes shell information", async () => {
    const bash = await BashTool.init()
    expect(bash.description).toContain("**Shell**:")
    expect(bash.description).toContain("Ensure your command syntax is compatible with this shell")
    // Should contain a shell name (bash, zsh, fish, etc.)
    const shellMatch = bash.description.match(/You are executing commands in `([^`]+)`/)
    expect(shellMatch).toBeTruthy()
    expect(shellMatch?.[1]).toBeTruthy()
  })

  test("shell name detection is platform-aware", async () => {
    const bash = await BashTool.init()
    const shellMatch = bash.description.match(/You are executing commands in `([^`]+)`/)
    const detectedShell = shellMatch?.[1]

    expect(detectedShell).toBeTruthy()

    // Verify detected shell is appropriate for the platform
    if (process.platform === "win32") {
      // On Windows, should detect cmd, powershell, bash (WSL/Git Bash), or similar
      expect(["cmd", "powershell", "pwsh", "bash", "zsh"].some((s) => detectedShell?.toLowerCase().includes(s))).toBe(
        true,
      )
    } else {
      // On Unix-like systems, should detect bash, zsh, fish, sh, or similar
      expect(["bash", "zsh", "fish", "sh", "nu"].some((s) => detectedShell === s)).toBe(true)
    }
  })

  // TODO: better test
  // test("cd ../ should ask for permission for external directory", async () => {
  //   await Instance.provide({
  //     directory: projectRoot,
  //     fn: async () => {
  //       bash.execute(
  //         {
  //           command: "cd ../",
  //           description: "Try to cd to parent directory",
  //         },
  //         ctx,
  //       )
  //       // Give time for permission to be asked
  //       await new Promise((resolve) => setTimeout(resolve, 1000))
  //       expect(Permission.pending()[ctx.sessionID]).toBeDefined()
  //     },
  //   })
  // })
})
