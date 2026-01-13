import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { SandboxFS } from "../../src/sandbox/fs"
import { Sandbox } from "../../src/sandbox/provider"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("SandboxFS", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-fs-test-"))
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe("readFile", () => {
    test("should read file contents as string", async () => {
      const filePath = path.join(testDir, "test.txt")
      await fs.writeFile(filePath, "hello world")

      const content = await SandboxFS.readFile(filePath)
      expect(content).toBe("hello world")
    })

    test("should read UTF-8 content correctly", async () => {
      const filePath = path.join(testDir, "unicode.txt")
      await fs.writeFile(filePath, "Hello 世界 🌍")

      const content = await SandboxFS.readFile(filePath)
      expect(content).toBe("Hello 世界 🌍")
    })

    test("should throw on non-existent file", async () => {
      const filePath = path.join(testDir, "nonexistent.txt")
      await expect(SandboxFS.readFile(filePath)).rejects.toThrow()
    })
  })

  describe("readFileBuffer", () => {
    test("should read file contents as Uint8Array", async () => {
      const filePath = path.join(testDir, "binary.bin")
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff])
      await fs.writeFile(filePath, data)

      const buffer = await SandboxFS.readFileBuffer(filePath)
      expect(buffer).toBeInstanceOf(Uint8Array)
      expect(buffer.length).toBe(4)
      expect(buffer[0]).toBe(0x00)
      expect(buffer[3]).toBe(0xff)
    })
  })

  describe("writeFile", () => {
    test("should write string content to file", async () => {
      const filePath = path.join(testDir, "output.txt")
      await SandboxFS.writeFile(filePath, "test content")

      const content = await fs.readFile(filePath, "utf-8")
      expect(content).toBe("test content")
    })

    test("should write binary content to file", async () => {
      const filePath = path.join(testDir, "output.bin")
      const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      await SandboxFS.writeFile(filePath, data)

      const buffer = await fs.readFile(filePath)
      expect(new Uint8Array(buffer)).toEqual(data)
    })

    test("should create parent directories", async () => {
      const filePath = path.join(testDir, "nested", "deep", "file.txt")
      await SandboxFS.writeFile(filePath, "nested content")

      const content = await fs.readFile(filePath, "utf-8")
      expect(content).toBe("nested content")
    })

    test("should overwrite existing file", async () => {
      const filePath = path.join(testDir, "overwrite.txt")
      await fs.writeFile(filePath, "original")
      await SandboxFS.writeFile(filePath, "updated")

      const content = await fs.readFile(filePath, "utf-8")
      expect(content).toBe("updated")
    })
  })

  describe("exists", () => {
    test("should return true for existing file", async () => {
      const filePath = path.join(testDir, "exists.txt")
      await fs.writeFile(filePath, "content")

      const result = await SandboxFS.exists(filePath)
      expect(result).toBe(true)
    })

    test("should return true for existing directory", async () => {
      const dirPath = path.join(testDir, "subdir")
      await fs.mkdir(dirPath)

      const result = await SandboxFS.exists(dirPath)
      expect(result).toBe(true)
    })

    test("should return false for non-existent path", async () => {
      const filePath = path.join(testDir, "nonexistent.txt")
      const result = await SandboxFS.exists(filePath)
      expect(result).toBe(false)
    })
  })

  describe("listDir", () => {
    test("should list directory contents", async () => {
      await fs.writeFile(path.join(testDir, "file1.txt"), "content")
      await fs.writeFile(path.join(testDir, "file2.txt"), "content")
      await fs.mkdir(path.join(testDir, "subdir"))

      const entries = await SandboxFS.listDir(testDir)
      expect(entries.length).toBe(3)

      const names = entries.map((e) => path.basename(e.path))
      expect(names).toContain("file1.txt")
      expect(names).toContain("file2.txt")
      expect(names).toContain("subdir")
    })

    test("should identify file types correctly", async () => {
      await fs.writeFile(path.join(testDir, "file.txt"), "content")
      await fs.mkdir(path.join(testDir, "dir"))

      const entries = await SandboxFS.listDir(testDir)
      const fileEntry = entries.find((e) => e.path.endsWith("file.txt"))
      const dirEntry = entries.find((e) => e.path.endsWith("dir"))

      expect(fileEntry?.type).toBe("file")
      expect(dirEntry?.type).toBe("directory")
    })

    test("should return empty array for empty directory", async () => {
      const emptyDir = path.join(testDir, "empty")
      await fs.mkdir(emptyDir)

      const entries = await SandboxFS.listDir(emptyDir)
      expect(entries).toEqual([])
    })
  })

  describe("deleteFile", () => {
    test("should delete a file", async () => {
      const filePath = path.join(testDir, "delete-me.txt")
      await fs.writeFile(filePath, "content")

      await SandboxFS.deleteFile(filePath)
      const exists = await SandboxFS.exists(filePath)
      expect(exists).toBe(false)
    })

    test("should delete directory recursively", async () => {
      const dirPath = path.join(testDir, "delete-dir")
      await fs.mkdir(dirPath)
      await fs.writeFile(path.join(dirPath, "file.txt"), "content")

      await SandboxFS.deleteFile(dirPath, { recursive: true })
      const exists = await SandboxFS.exists(dirPath)
      expect(exists).toBe(false)
    })

    test("should fail to delete non-empty directory without recursive", async () => {
      const dirPath = path.join(testDir, "non-empty")
      await fs.mkdir(dirPath)
      await fs.writeFile(path.join(dirPath, "file.txt"), "content")

      await expect(SandboxFS.deleteFile(dirPath)).rejects.toThrow()
    })
  })

  describe("exec", () => {
    test("should execute command and return result", async () => {
      const result = await SandboxFS.exec("echo", ["hello"])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("hello")
    })

    test("should capture stderr on error", async () => {
      const result = await SandboxFS.exec("ls", ["nonexistent-path-12345"])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    })

    test("should respect cwd option", async () => {
      const result = await SandboxFS.exec("pwd", [], { cwd: testDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(testDir)
    })

    test("should include duration in result", async () => {
      const result = await SandboxFS.exec("echo", ["test"])
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    test("should parse result as ExecResult schema", async () => {
      const result = await SandboxFS.exec("echo", ["test"])
      expect(() => Sandbox.ExecResult.parse(result)).not.toThrow()
    })
  })
})
