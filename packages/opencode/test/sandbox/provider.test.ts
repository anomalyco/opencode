import { describe, expect, test } from "bun:test"
import { Sandbox } from "../../src/sandbox/provider"

describe("Sandbox.Provider types", () => {
  describe("Status", () => {
    test("should parse valid statuses", () => {
      expect(Sandbox.Status.parse("creating")).toBe("creating")
      expect(Sandbox.Status.parse("running")).toBe("running")
      expect(Sandbox.Status.parse("stopped")).toBe("stopped")
      expect(Sandbox.Status.parse("terminated")).toBe("terminated")
      expect(Sandbox.Status.parse("error")).toBe("error")
    })

    test("should reject invalid status", () => {
      expect(() => Sandbox.Status.parse("invalid")).toThrow()
    })
  })

  describe("ProviderType", () => {
    test("should parse valid provider types", () => {
      expect(Sandbox.ProviderType.parse("local")).toBe("local")
      expect(Sandbox.ProviderType.parse("modal")).toBe("modal")
      expect(Sandbox.ProviderType.parse("kubernetes")).toBe("kubernetes")
    })

    test("should reject invalid provider type", () => {
      expect(() => Sandbox.ProviderType.parse("docker")).toThrow()
    })
  })

  describe("Config", () => {
    test("should parse minimal config", () => {
      const config = Sandbox.Config.parse({})
      expect(config.provider).toBe("local")
    })

    test("should parse full config", () => {
      const config = Sandbox.Config.parse({
        id: "test-id",
        name: "test-sandbox",
        provider: "modal",
        image: "python:3.11",
        workdir: "/workspace",
        env: { NODE_ENV: "test" },
        cpu: 2,
        memory: 4096,
        timeout: 3600,
        gitRepo: "https://github.com/test/repo",
        gitBranch: "main",
        projectId: "proj-123",
        sessionId: "sess-456",
      })

      expect(config.id).toBe("test-id")
      expect(config.name).toBe("test-sandbox")
      expect(config.provider).toBe("modal")
      expect(config.image).toBe("python:3.11")
      expect(config.workdir).toBe("/workspace")
      expect(config.env?.NODE_ENV).toBe("test")
      expect(config.cpu).toBe(2)
      expect(config.memory).toBe(4096)
      expect(config.timeout).toBe(3600)
      expect(config.projectId).toBe("proj-123")
      expect(config.sessionId).toBe("sess-456")
    })
  })

  describe("ExecResult", () => {
    test("should parse exec result", () => {
      const result = Sandbox.ExecResult.parse({
        exitCode: 0,
        stdout: "output",
        stderr: "",
        durationMs: 100,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("output")
      expect(result.stderr).toBe("")
      expect(result.durationMs).toBe(100)
    })

    test("should allow optional durationMs", () => {
      const result = Sandbox.ExecResult.parse({
        exitCode: 1,
        stdout: "",
        stderr: "error",
      })

      expect(result.exitCode).toBe(1)
      expect(result.durationMs).toBeUndefined()
    })
  })

  describe("Info", () => {
    test("should parse sandbox info", () => {
      const info = Sandbox.Info.parse({
        id: "sandbox-123",
        name: "test-sandbox",
        status: "running",
        provider: "local",
        workdir: "/tmp/sandbox",
        createdAt: "2024-01-01T00:00:00Z",
      })

      expect(info.id).toBe("sandbox-123")
      expect(info.name).toBe("test-sandbox")
      expect(info.status).toBe("running")
      expect(info.provider).toBe("local")
      expect(info.workdir).toBe("/tmp/sandbox")
    })

    test("should parse info with optional fields", () => {
      const info = Sandbox.Info.parse({
        id: "sandbox-123",
        name: "test-sandbox",
        status: "running",
        provider: "modal",
        workdir: "/workspace",
        createdAt: "2024-01-01T00:00:00Z",
        lastActivityAt: "2024-01-01T01:00:00Z",
        projectId: "proj-123",
        sessionId: "sess-456",
        snapshotId: "snap-789",
        metadata: { branch: "main", commit: "abc123" },
      })

      expect(info.lastActivityAt).toBe("2024-01-01T01:00:00Z")
      expect(info.projectId).toBe("proj-123")
      expect(info.sessionId).toBe("sess-456")
      expect(info.snapshotId).toBe("snap-789")
      expect(info.metadata?.branch).toBe("main")
    })
  })

  describe("Snapshot", () => {
    test("should parse snapshot", () => {
      const snapshot = Sandbox.Snapshot.parse({
        id: "snap-123",
        sandboxId: "sandbox-456",
        createdAt: "2024-01-01T00:00:00Z",
      })

      expect(snapshot.id).toBe("snap-123")
      expect(snapshot.sandboxId).toBe("sandbox-456")
    })

    test("should parse snapshot with optional fields", () => {
      const snapshot = Sandbox.Snapshot.parse({
        id: "snap-123",
        sandboxId: "sandbox-456",
        name: "checkpoint-1",
        createdAt: "2024-01-01T00:00:00Z",
        sizeBytes: 1024000,
        metadata: { version: "1.0" },
      })

      expect(snapshot.name).toBe("checkpoint-1")
      expect(snapshot.sizeBytes).toBe(1024000)
      expect(snapshot.metadata?.version).toBe("1.0")
    })
  })

  describe("FileInfo", () => {
    test("should parse file info", () => {
      const fileInfo = Sandbox.FileInfo.parse({
        path: "/workspace/file.txt",
        type: "file",
      })

      expect(fileInfo.path).toBe("/workspace/file.txt")
      expect(fileInfo.type).toBe("file")
    })

    test("should parse directory info", () => {
      const dirInfo = Sandbox.FileInfo.parse({
        path: "/workspace/src",
        type: "directory",
        modifiedAt: "2024-01-01T00:00:00Z",
      })

      expect(dirInfo.type).toBe("directory")
    })

    test("should parse symlink info", () => {
      const linkInfo = Sandbox.FileInfo.parse({
        path: "/workspace/link",
        type: "symlink",
        size: 50,
        mode: "0777",
      })

      expect(linkInfo.type).toBe("symlink")
      expect(linkInfo.size).toBe(50)
      expect(linkInfo.mode).toBe("0777")
    })
  })

  describe("Error types", () => {
    test("CreateError should be constructable", () => {
      const error = new Sandbox.CreateError({
        message: "Failed to create sandbox",
        provider: "modal",
      })

      expect(error.data.message).toBe("Failed to create sandbox")
      expect(error.data.provider).toBe("modal")
    })

    test("NotFoundError should be constructable", () => {
      const error = new Sandbox.NotFoundError({
        id: "sandbox-123",
        message: "Sandbox not found",
      })

      expect(error.data.id).toBe("sandbox-123")
      expect(error.data.message).toBe("Sandbox not found")
    })

    test("ExecError should be constructable", () => {
      const error = new Sandbox.ExecError({
        message: "Command failed",
        command: "npm install",
        exitCode: 1,
      })

      expect(error.data.command).toBe("npm install")
      expect(error.data.exitCode).toBe(1)
    })

    test("FileError should be constructable", () => {
      const error = new Sandbox.FileError({
        message: "File not found",
        path: "/workspace/missing.txt",
        operation: "read",
      })

      expect(error.data.path).toBe("/workspace/missing.txt")
      expect(error.data.operation).toBe("read")
    })

    test("SnapshotError should be constructable", () => {
      const error = new Sandbox.SnapshotError({
        message: "Snapshot failed",
        sandboxId: "sandbox-123",
        snapshotId: "snap-456",
      })

      expect(error.data.sandboxId).toBe("sandbox-123")
      expect(error.data.snapshotId).toBe("snap-456")
    })

    test("ProviderError should be constructable", () => {
      const error = new Sandbox.ProviderError({
        message: "Provider error",
        provider: "kubernetes",
        cause: "Connection refused",
      })

      expect(error.data.provider).toBe("kubernetes")
      expect(error.data.cause).toBe("Connection refused")
    })

    test("TimeoutError should be constructable", () => {
      const error = new Sandbox.TimeoutError({
        message: "Operation timed out",
        timeoutMs: 30000,
      })

      expect(error.data.timeoutMs).toBe(30000)
    })
  })

  describe("Provider registry", () => {
    test("registerProvider and getProvider should work", () => {
      const mockProvider: Sandbox.Provider = {
        type: "local",
        create: async () => {
          throw new Error("Not implemented")
        },
        get: async () => undefined,
        list: async () => [],
        terminate: async () => {},
        terminateAll: async () => 0,
        restore: async () => {
          throw new Error("Not implemented")
        },
        listSnapshots: async () => [],
        deleteSnapshot: async () => {},
        healthCheck: async () => true,
      }

      Sandbox.registerProvider(mockProvider)
      const retrieved = Sandbox.getProvider("local")

      expect(retrieved).toBe(mockProvider)
    })

    test("getDefaultProvider should return local provider", () => {
      const mockProvider: Sandbox.Provider = {
        type: "local",
        create: async () => {
          throw new Error("Not implemented")
        },
        get: async () => undefined,
        list: async () => [],
        terminate: async () => {},
        terminateAll: async () => 0,
        restore: async () => {
          throw new Error("Not implemented")
        },
        listSnapshots: async () => [],
        deleteSnapshot: async () => {},
        healthCheck: async () => true,
      }

      Sandbox.registerProvider(mockProvider)
      const defaultProvider = Sandbox.getDefaultProvider()

      expect(defaultProvider).toBe(mockProvider)
    })

    test("listProviders should return registered provider types", () => {
      const providers = Sandbox.listProviders()
      expect(providers).toContain("local")
    })
  })
})
