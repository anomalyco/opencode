import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { Commands } from "../../src/commands"
import { App } from "../../src/app/app"
import path from "path"
import fs from "fs/promises"
import os from "os"

describe("Custom Commands", () => {
  let tempDir: string
  let originalCwd: string

  beforeAll(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-"))
    originalCwd = process.cwd()
    process.chdir(tempDir)

    // Create test command directories
    const globalCommandsDir = path.join(
      tempDir,
      ".config",
      "opencode",
      "commands",
    )
    const projectCommandsDir = path.join(tempDir, ".opencode", "commands")

    await fs.mkdir(globalCommandsDir, { recursive: true })
    await fs.mkdir(projectCommandsDir, { recursive: true })

    // Create test commands
    await fs.writeFile(
      path.join(globalCommandsDir, "global-test.md"),
      `---
description: A global test command
---

# Global Test Command

This is a global test command.

!echo "Global command executed"

Please help with the global test.
`,
    )

    await fs.writeFile(
      path.join(projectCommandsDir, "project-test.md"),
      `---
description: A project test command
---

# Project Test Command

This is a project test command.

!echo "Project command executed"

Please help with the project test: $ARGUMENTS
`,
    )

    // Create nested command
    await fs.mkdir(path.join(projectCommandsDir, "nested"), { recursive: true })
    await fs.writeFile(
      path.join(projectCommandsDir, "nested", "command.md"),
      `# Nested Command

This is a nested command.
`,
    )

    // Mock App.info() to return our test paths
    App.info = () => ({
      user: "test",
      hostname: "test",
      git: false,
      path: {
        config: path.join(tempDir, ".config", "opencode"),
        data: path.join(tempDir, ".data"),
        root: tempDir,
        cwd: tempDir,
        state: path.join(tempDir, ".state"),
      },
      time: {
        initialized: Date.now(),
      },
    })
  })

  afterAll(async () => {
    process.chdir(originalCwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("should list all custom commands", async () => {
    const commands = await Commands.listCustomCommands()

    expect(commands).toHaveLength(3)

    const commandNames = commands.map((cmd) => cmd.name).sort()
    expect(commandNames).toEqual([
      "global-test",
      "nested:command",
      "project-test",
    ])

    // Project command should override global if same name exists
    const projectTest = commands.find((cmd) => cmd.name === "project-test")
    expect(projectTest).toBeDefined()
    expect(projectTest?.isGlobal).toBe(false)
    expect(projectTest?.description).toBe("A project test command")
  })

  it("should get a specific custom command", async () => {
    const command = await Commands.getCustomCommand("project-test")

    expect(command).toBeDefined()
    expect(command?.name).toBe("project-test")
    expect(command?.description).toBe("A project test command")
    expect(command?.content).toContain(
      "Please help with the project test: $ARGUMENTS",
    )
    expect(command?.isGlobal).toBe(false)
  })

  it("should return null for non-existent command", async () => {
    const command = await Commands.getCustomCommand("non-existent")
    expect(command).toBeNull()
  })

  it("should execute a custom command without arguments", async () => {
    const result = await Commands.executeCustomCommand("global-test")

    expect(result.processedContent).toContain(
      "Please help with the global test",
    )
    expect(result.processedContent).toContain("## Command Context")
    expect(result.bashResults).toHaveLength(1)
    expect(result.bashResults[0].command).toBe('echo "Global command executed"')
    expect(result.bashResults[0].stdout).toBe("Global command executed\n")
    expect(result.bashResults[0].exitCode).toBe(0)
  })

  it("should execute a custom command with arguments", async () => {
    const result = await Commands.executeCustomCommand(
      "project-test",
      "my test args",
    )

    expect(result.processedContent).toContain(
      "Please help with the project test: my test args",
    )
    expect(result.processedContent).toContain("## Command Context")
    expect(result.bashResults).toHaveLength(1)
    expect(result.bashResults[0].command).toBe(
      'echo "Project command executed"',
    )
    expect(result.bashResults[0].stdout).toBe("Project command executed\n")
    expect(result.bashResults[0].exitCode).toBe(0)
  })

  it("should handle nested commands", async () => {
    const command = await Commands.getCustomCommand("nested:command")

    expect(command).toBeDefined()
    expect(command?.name).toBe("nested:command")
    expect(command?.content).toContain("This is a nested command")
  })

  it("should check if custom command exists", async () => {
    const exists1 = await Commands.customCommandExists("project-test")
    const exists2 = await Commands.customCommandExists("non-existent")

    expect(exists1).toBe(true)
    expect(exists2).toBe(false)
  })

  it("should throw error for non-existent command execution", async () => {
    expect(Commands.executeCustomCommand("non-existent")).rejects.toThrow(
      "Custom command 'non-existent' not found",
    )
  })
})
