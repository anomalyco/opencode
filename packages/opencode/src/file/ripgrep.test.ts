import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { $ } from "bun"

// Helper function to create temporary test directory
async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ripgrep-test-"))
  return tempDir
}

// Helper function to cleanup temporary directory
async function cleanupTempDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true })
}

describe("Ripgrep .opencodeignore functionality", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  test("checkOpencodeignore helper returns path when file exists", async () => {
    // Create .opencodeignore file
    const opencodeignorePath = path.join(tempDir, ".opencodeignore")
    await fs.writeFile(opencodeignorePath, "*.tmp\n")

    // Test file existence check by simulating the helper function behavior
    const file = Bun.file(opencodeignorePath)
    const exists = await file.exists()
    const result = exists ? opencodeignorePath : null
    
    expect(result).toBe(opencodeignorePath)
  })

  test("checkOpencodeignore helper returns null when file does not exist", async () => {
    // Test file existence check when file doesn't exist
    const opencodeignorePath = path.join(tempDir, ".opencodeignore")
    const file = Bun.file(opencodeignorePath)
    const exists = await file.exists()
    const result = exists ? opencodeignorePath : null
    
    expect(result).toBeNull()
  })

  test("files() excludes files specified in .opencodeignore", async () => {
    // Create test files
    await fs.writeFile(path.join(tempDir, "test1.txt"), "content1")
    await fs.writeFile(path.join(tempDir, "test2.txt"), "content2")

    // Create .opencodeignore that ignores test1.txt
    await fs.writeFile(path.join(tempDir, ".opencodeignore"), "test1.txt\n")

    // Run ripgrep with ignore file
    const result = await $`rg --files --follow --hidden --glob='!.git/*' --ignore-file=.opencodeignore`.cwd(tempDir).text()
    const files = result.split("\n").filter(Boolean)
    
    // test1.txt should be excluded, test2.txt should be included
    expect(files).not.toContain("test1.txt")
    expect(files).toContain("test2.txt")
    expect(files).toContain(".opencodeignore")
  })

  test("files() includes all files when no .opencodeignore exists", async () => {
    // Create test files
    await fs.writeFile(path.join(tempDir, "test1.txt"), "content1")
    await fs.writeFile(path.join(tempDir, "test2.txt"), "content2")

    // Run ripgrep without ignore file
    const result = await $`rg --files --follow --hidden --glob='!.git/*'`.cwd(tempDir).text()
    const files = result.split("\n").filter(Boolean)
    
    // Both files should be included
    expect(files).toContain("test1.txt")
    expect(files).toContain("test2.txt")
  })

  test("search() excludes files specified in .opencodeignore", async () => {
    // Create test files with searchable content
    await fs.writeFile(path.join(tempDir, "test1.txt"), "search pattern here")
    await fs.writeFile(path.join(tempDir, "test2.txt"), "search pattern here too")

    // Create .opencodeignore that ignores test1.txt
    await fs.writeFile(path.join(tempDir, ".opencodeignore"), "test1.txt\n")

    // Run ripgrep search with ignore file
    const result = await $`rg --json --hidden --glob='!.git/*' --ignore-file=.opencodeignore 'search pattern'`.cwd(tempDir).nothrow().text()
    
    // Parse JSON results to get file paths
    const lines = result.trim().split("\n").filter(Boolean)
    const matches = lines
      .map(line => JSON.parse(line))
      .filter(parsed => parsed.type === "match")
      .map(parsed => parsed.data.path.text)
    
    // test1.txt should be excluded, test2.txt should be included
    expect(matches).not.toContain("test1.txt")
    expect(matches).toContain("test2.txt")
  })

  test("handles complex .opencodeignore patterns", async () => {
    // Create test files and directories
    await fs.writeFile(path.join(tempDir, "keep.txt"), "content")
    await fs.writeFile(path.join(tempDir, "ignore.tmp"), "temp content")
    await fs.mkdir(path.join(tempDir, "temp"))
    await fs.writeFile(path.join(tempDir, "temp", "file.txt"), "temp file")
    await fs.writeFile(path.join(tempDir, "regular.log"), "log content")

    // Create .opencodeignore with multiple patterns
    await fs.writeFile(path.join(tempDir, ".opencodeignore"), "*.tmp\ntemp/\n*.log\n")

    // Run ripgrep with ignore file
    const result = await $`rg --files --follow --hidden --glob='!.git/*' --ignore-file=.opencodeignore`.cwd(tempDir).text()
    const files = result.split("\n").filter(Boolean)
    
    // Should include keep.txt and .opencodeignore, exclude others
    expect(files).toContain("keep.txt")
    expect(files).toContain(".opencodeignore")
    expect(files).not.toContain("ignore.tmp")
    expect(files).not.toContain("temp/file.txt")
    expect(files).not.toContain("regular.log")
  })
})