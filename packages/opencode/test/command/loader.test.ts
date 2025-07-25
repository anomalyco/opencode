import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { CommandLoader } from "../../src/command/loader"
import { App } from "../../src/app/app"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

describe("CommandLoader", () => {
  let loader: CommandLoader
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-"))
    const app = {
      path: {
        cwd: testDir,
        root: testDir,
        config: path.join(testDir, ".config"),
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

    expect(commands).toHaveLength(1)
    expect(commands[0].name).toBe("test")
    expect(commands[0].scope).toBe("project")
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
    const command = loader.getCommand("git:commit")

    expect(command).toBeDefined()
    expect(command?.namespace).toBe("git")
  })
})
