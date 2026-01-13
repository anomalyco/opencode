import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { SandboxRuntime } from "../../src/sandbox/runtime"

function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

async function createTempDir(): Promise<string> {
  const dirpath = sanitizePath(
    path.join(os.tmpdir(), "opencode-sandbox-test-" + Math.random().toString(36).slice(2)),
  )
  await fs.mkdir(dirpath, { recursive: true })
  return sanitizePath(await fs.realpath(dirpath))
}

async function cleanupTempDir(dirpath: string): Promise<void> {
  try {
    await fs.rm(dirpath, { recursive: true, force: true })
  } catch {}
}

describe("SandboxRuntime", () => {
  describe("withSession", () => {
    test("should provide session context", () => {
      const result = SandboxRuntime.withSession("test-session-123", () => {
        return SandboxRuntime.getSessionId()
      })
      expect(result).toBe("test-session-123")
    })

    test("should return undefined outside of session context", () => {
      const sessionId = SandboxRuntime.getSessionId()
      expect(sessionId).toBeUndefined()
    })

    test("should support nested sessions with correct context", () => {
      SandboxRuntime.withSession("outer-session", () => {
        const outerId = SandboxRuntime.getSessionId()
        expect(outerId).toBe("outer-session")

        SandboxRuntime.withSession("inner-session", () => {
          const innerId = SandboxRuntime.getSessionId()
          expect(innerId).toBe("inner-session")
        })

        const afterInnerId = SandboxRuntime.getSessionId()
        expect(afterInnerId).toBe("outer-session")
      })
    })

    test("should support async functions", async () => {
      const result = await SandboxRuntime.withSession("async-session", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return SandboxRuntime.getSessionId()
      })
      expect(result).toBe("async-session")
    })
  })

  describe("file operations (local mode)", () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await createTempDir()
    })

    afterEach(async () => {
      await cleanupTempDir(tempDir)
    })

    test("readFile should read file contents", async () => {
      const testFile = path.join(tempDir, "test.txt")
      await fs.writeFile(testFile, "hello world")

      const content = await SandboxRuntime.readFile(testFile)
      expect(content).toBe("hello world")
    })

    test("readFileBuffer should read file as Uint8Array", async () => {
      const testFile = path.join(tempDir, "test.bin")
      const helloBytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
      await fs.writeFile(testFile, helloBytes)

      const content = await SandboxRuntime.readFileBuffer(testFile)
      expect(content).toBeInstanceOf(Uint8Array)
      expect(content).toEqual(helloBytes)
    })

    test("writeFile should write string content", async () => {
      const testFile = path.join(tempDir, "output.txt")
      await SandboxRuntime.writeFile(testFile, "test content")

      const content = await fs.readFile(testFile, "utf-8")
      expect(content).toBe("test content")
    })

    test("writeFile should write binary content", async () => {
      const testFile = path.join(tempDir, "output.bin")
      const data = new Uint8Array([0x01, 0x02, 0x03])
      await SandboxRuntime.writeFile(testFile, data)

      const content = await fs.readFile(testFile)
      expect(new Uint8Array(content)).toEqual(data)
    })

    test("exists should return true for existing file", async () => {
      const testFile = path.join(tempDir, "exists.txt")
      await fs.writeFile(testFile, "content")

      const exists = await SandboxRuntime.exists(testFile)
      expect(exists).toBe(true)
    })

    test("exists should return false for non-existing file", async () => {
      const testFile = path.join(tempDir, "not-exists.txt")

      const exists = await SandboxRuntime.exists(testFile)
      expect(exists).toBe(false)
    })

    test("stat should return file info", async () => {
      const testFile = path.join(tempDir, "stat.txt")
      await fs.writeFile(testFile, "content")

      const stat = await SandboxRuntime.stat(testFile)
      expect(stat).not.toBeNull()
      expect(stat?.isFile()).toBe(true)
      expect(stat?.isDirectory()).toBe(false)
      expect(stat?.size).toBe("content".length)
    })

    test("stat should return directory info", async () => {
      const testDir = path.join(tempDir, "subdir")
      await fs.mkdir(testDir)

      const stat = await SandboxRuntime.stat(testDir)
      expect(stat).not.toBeNull()
      expect(stat?.isFile()).toBe(false)
      expect(stat?.isDirectory()).toBe(true)
    })

    test("stat should return null for non-existing path", async () => {
      const testFile = path.join(tempDir, "not-exists.txt")

      const stat = await SandboxRuntime.stat(testFile)
      expect(stat).toBeNull()
    })

    test("readdir should list directory contents", async () => {
      await fs.writeFile(path.join(tempDir, "file1.txt"), "")
      await fs.writeFile(path.join(tempDir, "file2.txt"), "")
      await fs.mkdir(path.join(tempDir, "subdir"))

      const entries = await SandboxRuntime.readdir(tempDir)
      expect(entries).toContain("file1.txt")
      expect(entries).toContain("file2.txt")
      expect(entries).toContain("subdir")
    })

    test("mkdir should create directory", async () => {
      const newDir = path.join(tempDir, "newdir")
      await SandboxRuntime.mkdir(newDir)

      const stat = await fs.stat(newDir)
      expect(stat.isDirectory()).toBe(true)
    })

    test("mkdir with recursive should create nested directories", async () => {
      const nestedDir = path.join(tempDir, "a", "b", "c")
      await SandboxRuntime.mkdir(nestedDir, { recursive: true })

      const stat = await fs.stat(nestedDir)
      expect(stat.isDirectory()).toBe(true)
    })

    test("rm should delete file", async () => {
      const testFile = path.join(tempDir, "todelete.txt")
      await fs.writeFile(testFile, "content")

      await SandboxRuntime.rm(testFile)

      const exists = await SandboxRuntime.exists(testFile)
      expect(exists).toBe(false)
    })

    test("rm with recursive should delete directory", async () => {
      const testDir = path.join(tempDir, "todelete")
      await fs.mkdir(testDir)
      await fs.writeFile(path.join(testDir, "file.txt"), "content")

      await SandboxRuntime.rm(testDir, { recursive: true })

      const exists = await SandboxRuntime.exists(testDir)
      expect(exists).toBe(false)
    })
  })

  describe("exec (local mode)", () => {
    test("should execute simple command", async () => {
      const result = await SandboxRuntime.exec("echo", ["hello"])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("hello")
    })

    test("should capture stderr", async () => {
      const result = await SandboxRuntime.exec("echo error 1>&2", [])
      expect(result.stderr).toBe("error")
    })

    test("should return non-zero exit code for failed commands", async () => {
      const result = await SandboxRuntime.exec("exit 42", [])
      expect(result.exitCode).toBe(42)
    })

    test("should respect cwd option", async () => {
      const tempDir = await createTempDir()
      try {
        const result = await SandboxRuntime.exec("pwd", [], { cwd: tempDir })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe(tempDir)
      } finally {
        await cleanupTempDir(tempDir)
      }
    })

    test("should include duration", async () => {
      const result = await SandboxRuntime.exec("echo", ["test"])
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe("isRemote", () => {
    test("should return false when not in session context", () => {
      const isRemote = SandboxRuntime.isRemote()
      expect(isRemote).toBe(false)
    })
  })
})
