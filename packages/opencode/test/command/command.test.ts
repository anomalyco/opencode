import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Commands } from "../../src/command/command"
import fs from "fs"
import path from "path"
import os from "os"

describe("Commands.loadFromPath", () => {
  let tempDir: string

  // Set up a temporary directory for test files
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "command-test"))
  })

  // Clean up the temporary directory after tests
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test("should return empty array for non-existent directory", () => {
    const nonExistentDir = path.join(tempDir, "non-existent")
    const result = Commands.loadFromPath("user", nonExistentDir)
    expect(result).toEqual([])
  })

  test("should load markdown files with frontmatter", () => {
    // Create a test file with frontmatter
    const testDir = path.join(tempDir, "test-dir")
    fs.mkdirSync(testDir, { recursive: true })
    
    const fileContent = `---
description: "Test command description"
allowed-tools: ["tool1", "tool2"]
---
This is a test command prompt.

$ARGUMENTS`
    
    fs.writeFileSync(path.join(testDir, "test-command.md"), fileContent)
    
    const result = Commands.loadFromPath("user", tempDir)
    
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: "user:test-dir:test-command",
      description: "Test command description",
      allowedTools: ["tool1", "tool2"],
      prompt: "This is a test command prompt.\n\n$ARGUMENTS"
    })
  })

  test("should handle files without frontmatter", () => {
    // Create a test file without frontmatter
    const fileContent = "This is a test command without frontmatter."
    fs.writeFileSync(path.join(tempDir, "no-frontmatter.md"), fileContent)
    
    const result = Commands.loadFromPath("user", tempDir)
    
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: "user:no-frontmatter",
      prompt: fileContent
    })
    expect(result[0].description).toBeUndefined()
    expect(result[0].allowedTools).toBeUndefined()
  })

  test("should handle invalid YAML in frontmatter", () => {
    // Create a test file with invalid YAML in frontmatter
    const fileContent = `---
description: "Test command description
allowed-tools: [tool1, "tool2]
---
This is a test command with invalid frontmatter.`
    
    fs.writeFileSync(path.join(tempDir, "invalid-frontmatter.md"), fileContent)
    
    const result = Commands.loadFromPath("user", tempDir)
    
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: "user:invalid-frontmatter",
      prompt: fileContent
    })
    expect(result[0].description).toBeUndefined()
    expect(result[0].allowedTools).toBeUndefined()
  })

  test("should handle nested directory structure", () => {
    // Create nested directories with markdown files
    const nestedDir = path.join(tempDir, "nested", "dir")
    fs.mkdirSync(nestedDir, { recursive: true })
    
    const fileContent = `---
description: "Nested command"
allowed-tools: ["tool3"]
---
This is a nested command.`
    
    fs.writeFileSync(path.join(nestedDir, "nested-command.md"), fileContent)
    
    const result = Commands.loadFromPath("project", tempDir)
    
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: "project:nested:dir:nested-command",
      description: "Nested command",
      allowedTools: ["tool3"],
      prompt: "This is a nested command."
    })
  })

  test("should ignore non-markdown files", () => {
    // Create markdown and non-markdown files
    fs.writeFileSync(path.join(tempDir, "markdown.md"), "# Markdown")
    fs.writeFileSync(path.join(tempDir, "text.txt"), "Text file")
    fs.writeFileSync(path.join(tempDir, "json.json"), "{}")
    
    const result = Commands.loadFromPath("user", tempDir)
    
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("user:markdown")
  })
})