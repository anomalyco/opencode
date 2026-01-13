import { describe, expect, test } from "bun:test"
import * as path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { LocalSandboxProvider, createLocalProvider } from "../../src/sandbox/local"
import { Sandbox } from "../../src/sandbox/provider"

describe("LocalSandboxProvider", () => {
  test("createLocalProvider should return LocalSandboxProvider instance", () => {
    const provider = createLocalProvider()
    expect(provider).toBeInstanceOf(LocalSandboxProvider)
    expect(provider.type).toBe("local")
  })

  test("healthCheck should return true when git is available", async () => {
    const provider = createLocalProvider()
    const healthy = await provider.healthCheck()
    expect(healthy).toBe(true)
  })

  test("list should return empty array initially", async () => {
    const provider = createLocalProvider()
    const sandboxes = await provider.list()
    expect(sandboxes).toEqual([])
  })

  test("listSnapshots should return empty array for local provider", async () => {
    const provider = createLocalProvider()
    const snapshots = await provider.listSnapshots()
    expect(snapshots).toEqual([])
  })

  test("restore should throw SnapshotError for local provider", async () => {
    const provider = createLocalProvider()
    await expect(provider.restore("snap-123")).rejects.toThrow(Sandbox.SnapshotError)
  })

  test("deleteSnapshot should throw SnapshotError for local provider", async () => {
    const provider = createLocalProvider()
    await expect(provider.deleteSnapshot("snap-123")).rejects.toThrow(Sandbox.SnapshotError)
  })

  test("get should return undefined for non-existent sandbox", async () => {
    const provider = createLocalProvider()
    const sandbox = await provider.get("non-existent-id")
    expect(sandbox).toBeUndefined()
  })

  test("terminate should throw NotFoundError for non-existent sandbox", async () => {
    const provider = createLocalProvider()
    await expect(provider.terminate("non-existent-id")).rejects.toThrow(Sandbox.NotFoundError)
  })

  describe("with git repository", () => {
    test("create should create sandbox with worktree", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
          await Bun.write(path.join(dir, "test.txt"), "test content")
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const provider = createLocalProvider()
          const sandbox = await provider.create({
            name: "test-sandbox", provider: "local",
            sessionId: "test-session",
          })

          expect(sandbox.info.name).toBe("test-sandbox")
          expect(sandbox.info.provider).toBe("local")
          expect(sandbox.info.status).toBe("running")
          expect(sandbox.info.sessionId).toBe("test-session")
          expect(sandbox.info.workdir).toContain("test-sandbox")

          const status = await sandbox.getStatus()
          expect(status).toBe("running")

          await sandbox.terminate()
        },
      })
    })

    test("sandbox should support file operations", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const provider = createLocalProvider()
          const sandbox = await provider.create({
            name: "file-ops-sandbox", provider: "local",
            sessionId: "test-session",
          })

          try {
            await sandbox.writeFile("test-file.txt", "test content")
            const content = await sandbox.readFile("test-file.txt")
            expect(content).toBe("test content")

            await sandbox.writeFile("new-file.txt", "new content")
            const newContent = await sandbox.readFile("new-file.txt")
            expect(newContent).toBe("new content")

            const exists = await sandbox.exists("new-file.txt")
            expect(exists).toBe(true)

            const notExists = await sandbox.exists("non-existent.txt")
            expect(notExists).toBe(false)

            const files = await sandbox.listFiles(".")
            const fileNames = files.map((f) => f.path.split("/").pop())
            expect(fileNames).toContain("test-file.txt")
            expect(fileNames).toContain("new-file.txt")

            await sandbox.deleteFile("new-file.txt")
            const afterDelete = await sandbox.exists("new-file.txt")
            expect(afterDelete).toBe(false)
          } finally {
            await sandbox.terminate()
          }
        },
      })
    })

    test("sandbox should support binary file operations", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const provider = createLocalProvider()
          const sandbox = await provider.create({
            name: "binary-sandbox", provider: "local",
            sessionId: "test-session",
          })

          try {
            const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
            await sandbox.writeFile("test.bin", binaryData)

            const readData = await sandbox.readFileBuffer("test.bin")
            expect(readData).toEqual(binaryData)
          } finally {
            await sandbox.terminate()
          }
        },
      })
    })

    test("sandbox should support exec", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const provider = createLocalProvider()
          const sandbox = await provider.create({
            name: "exec-sandbox", provider: "local",
            sessionId: "test-session",
          })

          try {
            const result = await sandbox.exec("echo", ["hello world"])
            expect(result.exitCode).toBe(0)
            expect(result.stdout).toBe("hello world")
            expect(result.durationMs).toBeGreaterThanOrEqual(0)
          } finally {
            await sandbox.terminate()
          }
        },
      })
    })

    test("sandbox snapshot should throw SnapshotError", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const provider = createLocalProvider()
          const sandbox = await provider.create({
            name: "snapshot-sandbox", provider: "local",
            sessionId: "test-session",
          })

          try {
            await expect(sandbox.snapshot()).rejects.toThrow(Sandbox.SnapshotError)
          } finally {
            await sandbox.terminate()
          }
        },
      })
    })

    test("provider list should filter by sessionId", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const provider = createLocalProvider()

          const sandbox1 = await provider.create({
            name: "sandbox-1", provider: "local",
            sessionId: "session-a",
          })

          const sandbox2 = await provider.create({
            name: "sandbox-2", provider: "local",
            sessionId: "session-b",
          })

          try {
            const allSandboxes = await provider.list()
            expect(allSandboxes.length).toBe(2)

            const sessionASandboxes = await provider.list({ sessionId: "session-a" })
            expect(sessionASandboxes.length).toBe(1)
            expect(sessionASandboxes[0].sessionId).toBe("session-a")

            const sessionBSandboxes = await provider.list({ sessionId: "session-b" })
            expect(sessionBSandboxes.length).toBe(1)
            expect(sessionBSandboxes[0].sessionId).toBe("session-b")
          } finally {
            await sandbox1.terminate()
            await sandbox2.terminate()
          }
        },
      })
    })

    test("terminateAll should terminate filtered sandboxes", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const provider = createLocalProvider()

          await provider.create({
            name: "sandbox-1", provider: "local",
            sessionId: "session-to-terminate",
          })

          await provider.create({
            name: "sandbox-2", provider: "local",
            sessionId: "session-to-terminate",
          })

          const sandbox3 = await provider.create({
            name: "sandbox-3", provider: "local",
            sessionId: "session-to-keep",
          })

          const terminated = await provider.terminateAll({ sessionId: "session-to-terminate" })
          expect(terminated).toBe(2)

          const remaining = await provider.list()
          expect(remaining.length).toBe(1)
          expect(remaining[0].sessionId).toBe("session-to-keep")

          await sandbox3.terminate()
        },
      })
    })

    test("readFile should throw FileError for non-existent file", async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const provider = createLocalProvider()
          const sandbox = await provider.create({
            name: "error-sandbox", provider: "local",
            sessionId: "test-session",
          })

          try {
            await expect(sandbox.readFile("non-existent.txt")).rejects.toThrow(Sandbox.FileError)
          } finally {
            await sandbox.terminate()
          }
        },
      })
    })
  })
})
