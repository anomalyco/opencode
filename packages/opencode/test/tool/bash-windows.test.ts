import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { detectCommandShell, parseCommand } from "../../src/tool/bash"

const projectRoot = path.join(__dirname, "../..")

describe("shell detection", () => {
  test("detectCommandShell detects PowerShell", () => {
    expect(detectCommandShell("powershell.exe -Command Get-Process")).toBe("powershell")
    expect(detectCommandShell("powershell -Command Get-Process")).toBe("powershell")
    expect(detectCommandShell("pwsh -Command Get-Process")).toBe("pwsh")
    expect(detectCommandShell("pwsh.exe -Command Get-Process")).toBe("pwsh")
  })

  test("detectCommandShell detects CMD", () => {
    expect(detectCommandShell("cmd.exe /c echo hello")).toBe("cmd")
    expect(detectCommandShell("cmd /c echo hello")).toBe("cmd")
  })

  test("detectCommandShell detects Bash", () => {
    expect(detectCommandShell("bash -c echo hello")).toBe("bash")
    expect(detectCommandShell("/bin/bash -c echo hello")).toBe("bash")
    expect(detectCommandShell("sh -c echo hello")).toBe("bash")
  })

  test("detectCommandShell returns other for unknown commands", () => {
    expect(detectCommandShell("git status")).toBe("other")
    expect(detectCommandShell("npm install")).toBe("other")
    expect(detectCommandShell("echo hello")).toBe("other")
  })
})

describe("command parsing", () => {
  test("parseCommand bypasses shell for PowerShell", () => {
    const result = parseCommand("powershell.exe -Command Get-Process")
    expect(result.shouldBypassShell).toBe(true)
    expect(result.executable).toBe("powershell.exe")
    expect(result.args).toEqual(["-Command", "Get-Process"])
  })

  test("parseCommand bypasses shell for pwsh", () => {
    const result = parseCommand("pwsh -NoProfile -Command Get-Process")
    expect(result.shouldBypassShell).toBe(true)
    expect(result.executable).toBe("pwsh")
    expect(result.args).toEqual(["-NoProfile", "-Command", "Get-Process"])
  })

  test("parseCommand bypasses shell for cmd.exe", () => {
    const result = parseCommand("cmd.exe /c echo hello")
    expect(result.shouldBypassShell).toBe(true)
    expect(result.executable).toBe("cmd.exe")
    expect(result.args).toEqual(["/c", "echo", "hello"])
  })

  test("parseCommand uses shell for other commands", () => {
    const result = parseCommand("git status")
    expect(result.shouldBypassShell).toBe(false)
    expect(result.executable).toBe("git status")
    expect(result.args).toEqual([])
  })

  test("parseCommand uses shell for npm commands", () => {
    const result = parseCommand("npm install")
    expect(result.shouldBypassShell).toBe(false)
    expect(result.executable).toBe("npm install")
    expect(result.args).toEqual([])
  })
})

describe("tool.bash Windows execution", () => {
  test("basic echo on Windows (or Unix)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo hello",
            description: "Echo test message",
          },
          {
            sessionID: "test",
            messageID: "",
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            metadata: () => {},
            ask: async () => {},
          },
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("hello")
      },
    })
  })

  test("detects PowerShell command on Windows", async () => {
    if (process.platform !== "win32") {
      // Skip PowerShell tests on non-Windows platforms
      return
    }
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        // This should trigger shell bypass for PowerShell
        const result = await bash.execute(
          {
            command: "powershell.exe -NoProfile -Command Get-Process",
            description: "Get PowerShell process test",
          },
          {
            sessionID: "test",
            messageID: "",
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            metadata: () => {},
            ask: async () => {},
          },
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("detects cmd.exe command on Windows", async () => {
    if (process.platform !== "win32") {
      // Skip CMD tests on non-Windows platforms
      return
    }
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        // This should trigger shell bypass for CMD
        const result = await bash.execute(
          {
            command: "cmd.exe /c echo hello from cmd",
            description: "CMD echo test",
          },
          {
            sessionID: "test",
            messageID: "",
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            metadata: () => {},
            ask: async () => {},
          },
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("hello from cmd")
      },
    })
  })

  test("uses shell wrapper for git commands", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "git status",
            description: "Git status test",
          },
          {
            sessionID: "test",
            messageID: "",
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            metadata: () => {},
            ask: async () => {},
          },
        )
        // Should use shell wrapper, not direct execution
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("handles commands with quotes correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: 'echo "test with spaces"',
            description: "Echo with spaces test",
          },
          {
            sessionID: "test",
            messageID: "",
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            metadata: () => {},
            ask: async () => {},
          },
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test with spaces")
      },
    })
  })
})
