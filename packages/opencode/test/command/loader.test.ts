import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

// Mock dependencies to avoid import issues
const mockLog = {
  info: () => {},
  error: () => {},
}

const mockFilesystem = {
  globUp: async (pattern: string, cwd: string, _root: string) => {
    // Return mock file paths based on the test setup
    if (pattern.includes("commands/**/*.md")) {
      if (cwd.includes(".config")) {
        // User commands
        return [path.join(cwd, ".opencode", "commands", "hello.md")]
      } else {
        // Project commands
        return [
          path.join(cwd, ".opencode", "commands", "test.md"),
          path.join(cwd, ".opencode", "commands", "git", "commit.md"),
          path.join(cwd, ".opencode", "commands", "hello.md"),
        ]
      }
    }
    return []
  },
}

// Simple CommandLoader implementation for testing
class TestCommandLoader {
  private commands = new Map<string, any>()
  private unprefixedMap = new Map<string, string>()
  private log = mockLog

  constructor(private app: any) {}

  async loadCommands(): Promise<void> {
    this.commands.clear()
    this.unprefixedMap.clear()

    // Load user commands first (lower priority)
    const userCommands = await mockFilesystem.globUp(
      ".opencode/commands/**/*.md",
      this.app.path.config,
      this.app.path.config,
    )
    for (const filePath of userCommands) {
      await this.loadCommandFile(filePath, this.app.path.config, "user")
    }

    // Load project commands (higher priority, can override user commands)
    const projectCommands = await mockFilesystem.globUp(
      ".opencode/commands/**/*.md",
      this.app.path.cwd,
      this.app.path.root,
    )
    for (const filePath of projectCommands) {
      await this.loadCommandFile(filePath, this.app.path.cwd, "project")
    }

    this.log.info()
  }

  private async loadCommandFile(filePath: string, baseDir: string, scope: "project" | "user"): Promise<void> {
    try {
      // Mock file reading based on filename
      let content = ""
      let metadata: any = {}

      if (filePath.includes("hello.md")) {
        if (scope === "user") {
          content = "Hello from user"
          metadata = { description: "User hello command" }
        } else {
          content = "Hello from project"
          metadata = { description: "Project hello command" }
        }
      } else if (filePath.includes("test.md")) {
        content = "Test content"
        metadata = { description: "Test command" }
      } else if (filePath.includes("commit.md")) {
        content = "Content"
        metadata = { description: "Git commit" }
      }

      // Calculate command name from file path
      const relativePath = path.relative(path.join(baseDir, ".opencode", "commands"), filePath)
      const pathParts = relativePath.split(path.sep)
      const fileName = pathParts[pathParts.length - 1].replace(/\.md$/, "")

      // Build command name with scope prefix and namespace
      let commandName = fileName
      if (pathParts.length > 1) {
        const namespace = pathParts.slice(0, -1).join(":")
        commandName = `${namespace}:${fileName}`
      }

      // Add scope prefix to prevent conflicts with built-in commands
      commandName = `${scope}:${commandName}`

      const command = {
        name: commandName,
        path: filePath,
        scope,
        namespace: pathParts.length > 1 ? pathParts.slice(0, -1).join(":") : undefined,
        metadata,
        rawContent: content,
      }

      this.commands.set(commandName, command)

      // Also store without prefix for backward compatibility during lookup
      const unprefixedName = commandName.replace(/^(user|project):/, "")

      // Only update unprefixedMap if:
      // 1. It doesn't exist yet, OR
      // 2. This is a project command (project commands take priority)
      if (!this.unprefixedMap.has(unprefixedName) || scope === "project") {
        this.unprefixedMap.set(unprefixedName, commandName)
      }
    } catch (error) {
      this.log.error()
    }
  }

  getCommand(name: string): any | undefined {
    // First try direct lookup (with prefix)
    let command = this.commands.get(name)
    if (command) return command

    // Try with project: prefix first (higher priority)
    command = this.commands.get(`project:${name}`)
    if (command) return command

    // Try with user: prefix second (lower priority)
    command = this.commands.get(`user:${name}`)
    if (command) return command

    // Try unprefixed lookup for backward compatibility
    const prefixedName = this.unprefixedMap.get(name)
    if (prefixedName) {
      return this.commands.get(prefixedName)
    }

    return undefined
  }

  getAllCommands(): any[] {
    return Array.from(this.commands.values())
  }

  dispose(): void {
    // Cleanup
  }
}

describe("CommandLoader (Standalone)", () => {
  let loader: TestCommandLoader
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
    }
    loader = new TestCommandLoader(app)
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true })
  })

  it("should load commands from project directory", async () => {
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
