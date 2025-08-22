import { describe, it, expect, beforeEach } from "bun:test"
import { PersistentShell } from "../../src/shell/persistent"
import { ModeController, ExecutionMode } from "../../src/shell/mode"
import { Shell } from "../../src/shell/shell"
import path from "path"

describe("PersistentShell", () => {
  let shell: PersistentShell

  beforeEach(() => {
    shell = new PersistentShell()
  })

  describe("execute", () => {
    it("should execute simple commands", async () => {
      const result = await shell.execute("echo hello")
      expect(result.success).toBe(true)
      expect(result.stdout.trim()).toBe("hello")
      expect(result.exitCode).toBe(0)
    })

    it("should handle command failures", async () => {
      const result = await shell.execute("nonexistentcommand123")
      expect(result.success).toBe(false)
      expect(result.exitCode).not.toBe(0)
    })

    it("should execute with timeout", async () => {
      const result = await shell.execute("echo quick", { timeout: 5000 })
      expect(result.success).toBe(true)
      expect(result.stdout.trim()).toBe("quick")
    })
  })

  describe("cd command", () => {
    it("should change working directory", async () => {
      const tempDir = "/tmp"
      const result = await shell.execute(`cd ${tempDir}`)
      expect(result.success).toBe(true)
      expect(shell.getWorkingDir()).toBe(tempDir)
    })

    it("should handle cd to home directory", async () => {
      const result = await shell.execute("cd")
      expect(result.success).toBe(true)
      expect(shell.getWorkingDir()).toBe(process.env.HOME || "/")
    })

    it("should handle cd with ~ expansion", async () => {
      const result = await shell.execute("cd ~/")
      expect(result.success).toBe(true)
      expect(shell.getWorkingDir()).toBe(process.env.HOME || "/")
    })

    it("should handle cd to non-existent directory", async () => {
      const result = await shell.execute("cd /nonexistent/directory/path")
      expect(result.success).toBe(false)
      expect(result.stderr).toContain("no such file or directory")
    })

    it("should handle quoted paths", async () => {
      const result = await shell.execute('cd "/tmp"')
      expect(result.success).toBe(true)
      expect(shell.getWorkingDir()).toBe("/tmp")
    })
  })

  describe("export command", () => {
    it("should set environment variables", () => {
      const result = shell["handleExportCommand"]("export TEST_VAR=hello")
      expect(result.success).toBe(true)
      expect(shell.getEnv("TEST_VAR")).toBe("hello")
    })

    it("should handle quoted values", () => {
      const result = shell["handleExportCommand"]('export TEST_VAR="hello world"')
      expect(result.success).toBe(true)
      expect(shell.getEnv("TEST_VAR")).toBe("hello world")
    })

    it("should handle invalid export syntax", () => {
      const result = shell["handleExportCommand"]("export invalid syntax")
      expect(result.success).toBe(false)
      expect(result.stderr).toContain("invalid syntax")
    })
  })

  describe("state management", () => {
    it("should reset state", async () => {
      await shell.execute("cd /tmp")
      shell.setEnv("TEST_VAR", "value")
      
      shell.reset()
      
      expect(shell.getWorkingDir()).not.toBe("/tmp")
      expect(shell.getEnv("TEST_VAR")).toBeUndefined()
    })

    it("should maintain environment across commands", async () => {
      shell.setEnv("MY_VAR", "test")
      const result = await shell.execute("echo $MY_VAR")
      expect(result.stdout.trim()).toBe("test")
    })
  })
})

describe("ModeController", () => {
  let controller: ModeController

  beforeEach(() => {
    controller = new ModeController()
  })

  describe("mode management", () => {
    it("should initialize with Auto mode by default", () => {
      expect(controller.getMode()).toBe(ExecutionMode.Auto)
    })

    it("should set mode", () => {
      controller.setMode(ExecutionMode.Shell)
      expect(controller.getMode()).toBe(ExecutionMode.Shell)
    })

    it("should toggle through modes", () => {
      controller.setMode(ExecutionMode.Shell)
      expect(controller.toggleMode()).toBe(ExecutionMode.Agent)
      expect(controller.toggleMode()).toBe(ExecutionMode.Auto)
      expect(controller.toggleMode()).toBe(ExecutionMode.Shell)
    })
  })

  describe("routing logic", () => {
    it("should route shell builtins to shell", async () => {
      expect(await controller.shouldRouteToShell("cd /tmp")).toBe(true)
      expect(await controller.shouldRouteToShell("export VAR=value")).toBe(true)
      expect(await controller.shouldRouteToShell("pwd")).toBe(true)
    })

    it("should route commands with operators to shell", async () => {
      expect(await controller.shouldRouteToShell("ls | grep test")).toBe(true)
      expect(await controller.shouldRouteToShell("echo hello && echo world")).toBe(true)
      expect(await controller.shouldRouteToShell("cat file.txt > output.txt")).toBe(true)
    })

    it("should route environment assignments to shell", async () => {
      expect(await controller.shouldRouteToShell("VAR=value")).toBe(true)
      expect(await controller.shouldRouteToShell("PATH=/usr/bin:$PATH")).toBe(true)
    })

    it("should route system commands to shell", async () => {
      expect(await controller.shouldRouteToShell("ls")).toBe(true)
      expect(await controller.shouldRouteToShell("echo")).toBe(true)
    })

    it("should route natural language to agent", async () => {
      expect(await controller.shouldRouteToShell("what is the weather today")).toBe(false)
      expect(await controller.shouldRouteToShell("help me write a function")).toBe(false)
      expect(await controller.shouldRouteToShell("explain this code")).toBe(false)
    })

    it("should respect forced modes", async () => {
      controller.setMode(ExecutionMode.Shell)
      expect(await controller.shouldRouteToShell("help me")).toBe(true)
      
      controller.setMode(ExecutionMode.Agent)
      expect(await controller.shouldRouteToShell("ls")).toBe(false)
    })
  })

  describe("tokenization", () => {
    it("should tokenize simple commands", () => {
      const tokens = controller["tokenize"]("ls -la /tmp")
      expect(tokens).toEqual(["ls", "-la", "/tmp"])
    })

    it("should handle quoted strings", () => {
      const tokens = controller["tokenize"]('echo "hello world" test')
      expect(tokens).toEqual(["echo", "hello world", "test"])
    })

    it("should handle single quotes", () => {
      const tokens = controller["tokenize"]("echo 'hello world' test")
      expect(tokens).toEqual(["echo", "hello world", "test"])
    })

    it("should handle escaped characters", () => {
      const tokens = controller["tokenize"]("echo hello\\ world")
      expect(tokens).toEqual(["echo", "hello world"])
    })
  })

  describe("mode display", () => {
    it("should provide correct display info for each mode", () => {
      controller.setMode(ExecutionMode.Shell)
      let display = controller.getModeDisplay()
      expect(display.name).toBe("Shell")
      expect(display.color).toBe("blue")
      expect(display.icon).toBe("▌")

      controller.setMode(ExecutionMode.Agent)
      display = controller.getModeDisplay()
      expect(display.name).toBe("Agent")
      expect(display.color).toBe("purple")
      expect(display.icon).toBe("▌")

      controller.setMode(ExecutionMode.Auto)
      display = controller.getModeDisplay()
      expect(display.name).toBe("Auto")
      expect(display.color).toBe("green")
      expect(display.icon).toBe("▌")
    })
  })
})

describe("Shell integration", () => {
  it("should provide singleton instances", () => {
    const shell1 = Shell.get()
    const shell2 = Shell.get()
    expect(shell1).toBe(shell2)

    const controller1 = Shell.getModeController()
    const controller2 = Shell.getModeController()
    expect(controller1).toBe(controller2)
  })

  it("should manage working directory", () => {
    const originalCwd = Shell.getCwd()
    Shell.setCwd("/tmp")
    expect(Shell.getCwd()).toBe("/tmp")
    Shell.setCwd(originalCwd)
  })

  it("should manage execution mode", () => {
    Shell.setMode(ExecutionMode.Shell)
    expect(Shell.getMode()).toBe(ExecutionMode.Shell)
    
    const newMode = Shell.toggleMode()
    expect(newMode).toBe(ExecutionMode.Agent)
    expect(Shell.getMode()).toBe(ExecutionMode.Agent)
  })

  it("should reset shell state", () => {
    Shell.setCwd("/tmp")
    Shell.reset()
    expect(Shell.getCwd()).not.toBe("/tmp")
  })
})