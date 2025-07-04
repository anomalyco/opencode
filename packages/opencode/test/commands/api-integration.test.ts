import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { Server } from "../../src/server/server"
import { App } from "../../src/app/app"
import path from "path"
import fs from "fs/promises"
import os from "os"

describe("Custom Commands API Integration", () => {
  let server: any
  let tempDir: string
  let originalCwd: string
  const port = 3001 // Use different port to avoid conflicts

  beforeAll(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-api-test-"))
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
      path.join(globalCommandsDir, "api-test.md"),
      `---
description: An API test command
---

# API Test Command

This is an API test command.

!echo "API test executed"

Please help with the API test.
`,
    )

    await fs.writeFile(
      path.join(projectCommandsDir, "project-api.md"),
      `# Project API Command

This is a project API command with arguments: $ARGUMENTS
`,
    )

    // Mock App context
    await App.provide({ cwd: tempDir }, async () => {
      // Start the server
      server = Server.listen({ port, hostname: "localhost" })

      // Wait a bit for server to start
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
  })

  afterAll(async () => {
    if (server) {
      server.stop()
    }
    process.chdir(originalCwd)
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it("should list custom commands via API", async () => {
    const response = await fetch(`http://localhost:${port}/commands`)
    expect(response.status).toBe(200)

    const commands = await response.json()
    expect(Array.isArray(commands)).toBe(true)
    expect(commands.length).toBeGreaterThan(0)

    const commandNames = commands.map((cmd: any) => cmd.name)
    expect(commandNames).toContain("api-test")
    expect(commandNames).toContain("project-api")
  })

  it("should get a specific command via API", async () => {
    const response = await fetch(`http://localhost:${port}/commands/api-test`)
    expect(response.status).toBe(200)

    const command = await response.json()
    expect(command.name).toBe("api-test")
    expect(command.description).toBe("An API test command")
    expect(command.content).toContain("Please help with the API test")
  })

  it("should return 404 for non-existent command", async () => {
    const response = await fetch(
      `http://localhost:${port}/commands/non-existent`,
    )
    expect(response.status).toBe(404)

    const error = await response.json()
    expect(error.error).toBe("Command not found")
  })

  it("should execute a command via API", async () => {
    const response = await fetch(
      `http://localhost:${port}/commands/api-test/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    )

    expect(response.status).toBe(200)

    const result = await response.json()
    expect(result.processedContent).toContain("Please help with the API test")
    expect(result.processedContent).toContain("## Command Context")
    expect(result.bashResults).toHaveLength(1)
    expect(result.bashResults[0].command).toBe('echo "API test executed"')
    expect(result.bashResults[0].stdout).toBe("API test executed\n")
  })

  it("should execute a command with arguments via API", async () => {
    const response = await fetch(
      `http://localhost:${port}/commands/project-api/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          arguments: "test arguments",
        }),
      },
    )

    expect(response.status).toBe(200)

    const result = await response.json()
    expect(result.processedContent).toContain(
      "This is a project API command with arguments: test arguments",
    )
  })

  it("should return 404 when executing non-existent command", async () => {
    const response = await fetch(
      `http://localhost:${port}/commands/non-existent/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    )

    expect(response.status).toBe(404)

    const error = await response.json()
    expect(error.error).toContain("not found")
  })
})
