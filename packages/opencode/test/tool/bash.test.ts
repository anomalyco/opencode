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
      expect(["cmd", "powershell"]).toContain(detectedShell!)
    } else {
      expect(["bash", "zsh", "fish", "ksh", "csh", "tcsh", "dash"]).toContain(detectedShell!)
    }
  })

  test("description uses dynamic shell-specific language", async () => {
    const bash = await BashTool.init()
    const shellMatch = bash.description.match(/You are executing commands in `([^`]+)`/)
    const detectedShell = shellMatch?.[1]

    expect(detectedShell).toBeTruthy()

    // Should contain shell-specific command references
    if (detectedShell) {
      expect(bash.description).toContain(`${detectedShell} command`)
      expect(bash.description).toContain(`${detectedShell} commands`)
    }

    // Should NOT contain generic "bash command" references
    expect(bash.description).not.toContain("bash command")
    expect(bash.description).not.toContain("bash commands")

    // Should still contain "Bash tool" references (tool name)
    expect(bash.description).toContain("Bash tool")
  })

  test("shell-specific language works for different shell types", async () => {
    // Test with fish shell (current environment)
    const originalShell = process.env.SHELL

    try {
      // Mock fish shell environment
      process.env.SHELL = "/opt/homebrew/bin/fish"
      const bashFish = await BashTool.init()
      expect(bashFish.description).toContain("fish command")
      expect(bashFish.description).toContain("fish commands")

      // Mock zsh shell environment
      process.env.SHELL = "/bin/zsh"
      const bashZsh = await BashTool.init()
      expect(bashZsh.description).toContain("zsh command")
      expect(bashZsh.description).toContain("zsh commands")

      // Mock bash shell environment
      process.env.SHELL = "/bin/bash"
      const bashBash = await BashTool.init()
      expect(bashBash.description).toContain("bash command")
      expect(bashBash.description).toContain("bash commands")
    } finally {
      // Restore original shell
      if (originalShell) {
        process.env.SHELL = originalShell
      } else {
        delete process.env.SHELL
      }
    }
  })

  test("description uses dynamic shell-specific language", async () => {
    const bash = await BashTool.init()
    const shellMatch = bash.description.match(/You are executing commands in `([^`]+)`/)
    const detectedShell = shellMatch?.[1]

    expect(detectedShell).toBeTruthy()

    // Should contain shell-specific command references
    if (detectedShell) {
      expect(bash.description).toContain(`${detectedShell} command`)
      expect(bash.description).toContain(`${detectedShell} commands`)
    }

    // Should NOT contain generic "bash command" references
    expect(bash.description).not.toContain("bash command")
    expect(bash.description).not.toContain("bash commands")

    // Should still contain "Bash tool" references (tool name)
    expect(bash.description).toContain("Bash tool")
  })

  test("shell-specific language works for different shell types", async () => {
    // Test with fish shell (current environment)
    const originalShell = process.env.SHELL

    try {
      // Mock fish shell environment
      process.env.SHELL = "/opt/homebrew/bin/fish"
      const bashFish = await BashTool.init()
      expect(bashFish.description).toContain("fish command")
      expect(bashFish.description).toContain("fish commands")

      // Mock zsh shell environment
      process.env.SHELL = "/bin/zsh"
      const bashZsh = await BashTool.init()
      expect(bashZsh.description).toContain("zsh command")
      expect(bashZsh.description).toContain("zsh commands")

      // Mock bash shell environment
      process.env.SHELL = "/bin/bash"
      const bashBash = await BashTool.init()
      expect(bashBash.description).toContain("bash command")
      expect(bashBash.description).toContain("bash commands")
    } finally {
      // Restore original shell
      if (originalShell) {
        process.env.SHELL = originalShell
      } else {
        delete process.env.SHELL
      }
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
