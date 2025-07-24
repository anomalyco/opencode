import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Ripgrep } from "../../src/file/ripgrep"

// Helper function to create temporary test directory
async function createTempDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ripgrep-test-"))
  return tempDir
}

// Helper function to cleanup temporary directory
async function cleanupTempDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true })
}

describe("Ripgrep checkOpencodeignore function", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tempDir)
  })

  test("checkOpencodeignore returns path when file exists", async () => {
    // Create .opencodeignore file
    const opencodeignorePath = path.join(tempDir, ".opencodeignore")
    await fs.writeFile(opencodeignorePath, "*.tmp\n")

    const result = await Ripgrep.checkOpencodeignore(tempDir)
    expect(result).toBe(opencodeignorePath)
  })

  test("checkOpencodeignore returns null when file does not exist", async () => {
    const result = await Ripgrep.checkOpencodeignore(tempDir)
    expect(result).toBeNull()
  })

  test("files() excludes files specified in .opencodeignore", async () => {
    // Create test files
    await fs.writeFile(path.join(tempDir, "test1.txt"), "content1")
    await fs.writeFile(path.join(tempDir, "test2.txt"), "content2")

    // Create .opencodeignore that ignores test1.txt
    await fs.writeFile(path.join(tempDir, ".opencodeignore"), "test1.txt\n")

    const files = await Ripgrep.files({ cwd: tempDir })
    
    // test1.txt should be excluded, test2.txt should be included
    expect(files).not.toContain("test1.txt")
    expect(files).toContain("test2.txt")
  })
})