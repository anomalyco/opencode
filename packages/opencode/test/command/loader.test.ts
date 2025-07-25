import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { CommandLoader } from "../../src/command/loader"
import { App } from "../../src/app/app"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

describe("CommandLoader", () => {
  let loader: CommandLoader
  let testDir: string
  let configDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-"))
    configDir = path.join(testDir, ".config")
    await fs.mkdir(configDir, { recursive: true })

    const app = {
      path: {
        cwd: testDir,
        root: testDir,
        config: configDir,
        data: path.join(testDir, ".data"),
        state: path.join(testDir, ".state"),
      },
      hostname: "test-host",
      git: false,
      time: {},
    } as App.Info
    loader = new CommandLoader(app)
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true })
  })

  it("should load commands from project directory", async () => {
    // Create test command
    const cmdDir = path.join(testDir, ".opencode", "commands")
    await fs.mkdir(cmdDir, { recursive: true })
    await fs.writeFile(
      path.join(cmdDir, "test.md"),
      `---
description: Test command
---
Test content`,
    )

    await loader.loadCommands()
    const commands = loader.getAllCommands()

    // Find our specific test command
    const testCommand = commands.find((cmd) => cmd.name === "project:test")

    expect(testCommand).toBeDefined()
    expect(testCommand?.scope).toBe("project")
    expect(testCommand?.metadata.description).toBe("Test command")
    expect(testCommand?.rawContent).toBe("Test content")
  })

  it("should handle namespaced commands", async () => {
    const cmdDir = path.join(testDir, ".opencode", "commands", "git")
    await fs.mkdir(cmdDir, { recursive: true })
    await fs.writeFile(
      path.join(cmdDir, "commit.md"),
      `---
description: Git commit
---
Content`,
    )

    await loader.loadCommands()

    // Test that we can find it with various lookup methods
    const commandByFullName = loader.getCommand("project:git:commit")
    expect(commandByFullName).toBeDefined()
    expect(commandByFullName?.namespace).toBe("git")

    // Should also work without prefix (backward compatibility)
    const commandByShortName = loader.getCommand("git:commit")
    expect(commandByShortName).toBeDefined()
    expect(commandByShortName?.namespace).toBe("git")
  })

  it("should prioritize project commands over user commands", async () => {
    // Create user command
    const userCmdDir = path.join(configDir, ".opencode", "commands")
    await fs.mkdir(userCmdDir, { recursive: true })
    await fs.writeFile(
      path.join(userCmdDir, "hello.md"),
      `---
description: User hello command
---
Hello from user`,
    )

    // Create project command with same name
    const projectCmdDir = path.join(testDir, ".opencode", "commands")
    await fs.mkdir(projectCmdDir, { recursive: true })
    await fs.writeFile(
      path.join(projectCmdDir, "hello.md"),
      `---
description: Project hello command
---
Hello from project`,
    )

    await loader.loadCommands()

    // When looking up by unprefixed name, should get project command
    const command = loader.getCommand("hello")
    expect(command).toBeDefined()
    expect(command?.scope).toBe("project")
    expect(command?.rawContent).toBe("Hello from project")

    // Can still access user command with explicit prefix
    const userCommand = loader.getCommand("user:hello")
    expect(userCommand).toBeDefined()
    expect(userCommand?.scope).toBe("user")
    expect(userCommand?.rawContent).toBe("Hello from user")
  })
})
