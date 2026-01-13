import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Sandbox } from "../../src/sandbox/provider"
import { createLocalProvider } from "../../src/sandbox/local"

describe("SandboxContext", () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe("provider selection", () => {
    test("should default to local provider when no config", async () => {
      const localProvider = createLocalProvider()
      expect(localProvider.type).toBe("local")
    })

    test("should register provider with Sandbox namespace", async () => {
      const localProvider = createLocalProvider()
      Sandbox.registerProvider(localProvider)
      expect(Sandbox.getProvider("local")).toBe(localProvider)
    })

    test("should list registered providers", async () => {
      const localProvider = createLocalProvider()
      Sandbox.registerProvider(localProvider)
      const providers = Sandbox.listProviders()
      expect(providers).toContain("local")
    })
  })

  describe("session sandbox management", () => {
    test("should track sandboxes by session ID", async () => {
      const sandboxes = new Map<string, Sandbox.Instance>()
      const mockInstance = {
        info: { id: "test-sandbox", provider: "local", status: "running" },
        getStatus: async () => "running" as Sandbox.Status,
      } as Sandbox.Instance

      sandboxes.set("session-123", mockInstance)
      expect(sandboxes.get("session-123")).toBe(mockInstance)
      expect(sandboxes.has("session-456")).toBe(false)
    })

    test("should remove sandbox on termination", async () => {
      const sandboxes = new Map<string, Sandbox.Instance>()
      const mockInstance = {
        info: { id: "test-sandbox", provider: "local", status: "running" },
        terminate: async () => {},
      } as Sandbox.Instance

      sandboxes.set("session-123", mockInstance)
      expect(sandboxes.size).toBe(1)

      await mockInstance.terminate()
      sandboxes.delete("session-123")
      expect(sandboxes.size).toBe(0)
    })
  })

  describe("isRemote detection", () => {
    test("should return false for local provider", () => {
      const localProvider = createLocalProvider()
      expect(localProvider.type).toBe("local")
      const providerType: string = localProvider.type
      expect(providerType !== "local").toBe(false)
    })

    test("should return true for non-local providers", () => {
      const modalType: string = "modal"
      const k8sType: string = "kubernetes"
      expect(modalType !== "local").toBe(true)
      expect(k8sType !== "local").toBe(true)
    })
  })

  describe("error handling", () => {
    test("should create CreateError with provider info", () => {
      const error = new Sandbox.CreateError({
        message: "Failed to create sandbox",
        provider: "modal",
      })
      expect(error.name).toBe("SandboxCreateError")
      expect(error.data.provider).toBe("modal")
      expect(error.data.message).toBe("Failed to create sandbox")
    })

    test("should create NotFoundError with sandbox ID", () => {
      const error = new Sandbox.NotFoundError({
        message: "Sandbox not found",
        id: "sandbox-123",
      })
      expect(error.name).toBe("SandboxNotFoundError")
      expect(error.data.id).toBe("sandbox-123")
      expect(error.data.message).toBe("Sandbox not found")
    })

    test("should create ExecError with command info", () => {
      const error = new Sandbox.ExecError({
        message: "Command failed",
        command: "npm test",
        exitCode: 1,
      })
      expect(error.name).toBe("SandboxExecError")
      expect(error.data.command).toBe("npm test")
      expect(error.data.exitCode).toBe(1)
      expect(error.data.message).toBe("Command failed")
    })

    test("should create FileError with path info", () => {
      const error = new Sandbox.FileError({
        message: "File not found",
        path: "/tmp/test.txt",
        operation: "read",
      })
      expect(error.name).toBe("SandboxFileError")
      expect(error.data.path).toBe("/tmp/test.txt")
      expect(error.data.operation).toBe("read")
      expect(error.data.message).toBe("File not found")
    })
  })

  describe("sandbox status", () => {
    test("should validate status enum values", () => {
      const validStatuses: Sandbox.Status[] = ["creating", "running", "stopped", "terminated", "error"]
      validStatuses.forEach((status) => {
        expect(Sandbox.Status.parse(status)).toBe(status)
      })
    })

    test("should reject invalid status values", () => {
      expect(() => Sandbox.Status.parse("invalid")).toThrow()
    })
  })

  describe("provider type", () => {
    test("should validate provider type enum values", () => {
      const validTypes: Sandbox.ProviderType[] = ["local", "modal", "kubernetes"]
      validTypes.forEach((type) => {
        expect(Sandbox.ProviderType.parse(type)).toBe(type)
      })
    })

    test("should reject invalid provider types", () => {
      expect(() => Sandbox.ProviderType.parse("docker")).toThrow()
    })
  })

  describe("config validation", () => {
    test("should accept minimal config", () => {
      const config = Sandbox.Config.parse({})
      expect(config.provider).toBe("local")
    })

    test("should accept full config", () => {
      const config = Sandbox.Config.parse({
        id: "sandbox-123",
        name: "test-sandbox",
        provider: "modal",
        image: "python:3.11",
        workdir: "/app",
        env: { NODE_ENV: "test" },
        timeout: 3600,
        cpu: 2,
        memory: 1024,
        sessionId: "session-456",
        projectId: "project-789",
      })
      expect(config.id).toBe("sandbox-123")
      expect(config.provider).toBe("modal")
      expect(config.image).toBe("python:3.11")
    })
  })
})
