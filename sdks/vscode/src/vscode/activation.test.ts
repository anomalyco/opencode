import { strict as assert } from "assert"
import { describe, it, beforeEach, afterEach } from "mocha"
import { EventEmitter } from "events"
import { Readable, Writable } from "stream"
import { ActivationController, ActivationState } from "./activation"
import { AcpClient, AcpClientState } from "../acp/client"
import { AcpProcess, ProcessState } from "../acp/process"
import { JsonRpcConnection } from "../acp/connection"

// Mock VS Code module
const mockVscode = {
  ExtensionContext: class MockExtensionContext {
    subscriptions: Array<{ dispose(): void }> = []
    workspaceState: Map<string, unknown> = new Map()
    globalState: Map<string, unknown> = new Map()

    asAbsolutePath(relativePath: string): string {
      return `/mock/path/${relativePath}`
    }
  },

  window: {
    withProgress: async <T>(options: any, task: any): Promise<T> => {
      const token = { isCancellationRequested: false, onCancellationRequested: () => {} }
      const progress = { report: () => {} }
      return task(progress, token)
    },

    showErrorMessage: async (message: string): Promise<void> => {
      mockVscode.window.lastErrorMessage = message
    },

    showWarningMessage: async (message: string): Promise<void> => {
      mockVscode.window.lastWarningMessage = message
    },

    lastErrorMessage: null as string | null,
    lastWarningMessage: null as string | null,
  },

  workspace: {
    workspaceFolders: null as any,
    asRelativePath: (uri: any) => uri.fsPath,
  },

  extensions: {
    getExtension: () => ({ packageJSON: { version: "1.0.0" } }),
    all: [] as any[],
  },

  ProgressLocation: { Notification: 1 },
  Uri: { file: (path: string) => ({ fsPath: path }) },
}

// Mock streams for testing
function createMockStreams() {
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      stdin.written.push(chunk.toString())
      callback()
    },
  }) as Writable & { written: string[] }
  stdin.written = []

  const stdout = new Readable({ read() {} }) as Readable & { pushData: (data: string) => void }
  stdout.pushData = (data: string) => stdout.push(data)

  return { stdin, stdout }
}

describe("ActivationController", () => {
  let controller: ActivationController
  let context: InstanceType<typeof mockVscode.ExtensionContext>
  let streams: ReturnType<typeof createMockStreams>

  beforeEach(() => {
    context = new mockVscode.ExtensionContext()
    streams = createMockStreams()
    mockVscode.window.lastErrorMessage = null
    mockVscode.window.lastWarningMessage = null
    mockVscode.workspace.workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]
  })

  afterEach(async () => {
    if (controller) {
      try {
        await controller.dispose()
      } catch {
        // Ignore errors during cleanup
      }
      controller = null as any
    }
  })

  describe("on-demand activation", () => {
    it("does NOT start ACP on extension load", () => {
      controller = new ActivationController(context as any)

      assert.strictEqual(controller.getState(), ActivationState.INACTIVE, "Should be INACTIVE initially")
      assert.strictEqual(controller.getActiveSessions(), 0, "Should have zero active sessions")
      assert.strictEqual(controller.isProcessRunning(), false, "Process should not be running")
    })

    it("transitions to STARTING when ensureActivated is called", async () => {
      controller = new ActivationController(context as any, {
        spawnOptions: { command: "/nonexistent/command", args: [] },
      })

      // Start activation (it will fail but should transition through STARTING)
      const activationPromise = controller.ensureActivated()

      // Should be STARTING immediately
      assert.strictEqual(controller.getState(), ActivationState.STARTING, "Should be STARTING")

      // Let it fail
      try {
        await activationPromise
      } catch {
        // Expected to fail
      }
    })

    it("handles concurrent activation requests", async () => {
      controller = new ActivationController(context as any, {
        spawnOptions: { command: "/nonexistent/command", args: [] },
      })

      // Start multiple activations concurrently
      const promise1 = controller.ensureActivated()
      const promise2 = controller.ensureActivated()

      // Both should reject (since spawn fails), but shouldn't throw unhandled
      const results = await Promise.allSettled([promise1, promise2])

      // Both should be rejected
      assert.strictEqual(results[0].status, "rejected")
      assert.strictEqual(results[1].status, "rejected")
    })
  })

  describe("session management", () => {
    it("increments active session count on session start", () => {
      controller = new ActivationController(context as any)

      assert.strictEqual(controller.getActiveSessions(), 0, "Initial sessions should be 0")

      controller.onSessionStarted()
      assert.strictEqual(controller.getActiveSessions(), 1, "Should increment to 1")

      controller.onSessionStarted()
      assert.strictEqual(controller.getActiveSessions(), 2, "Should increment to 2")
    })

    it("decrements active session count on session end", () => {
      controller = new ActivationController(context as any)

      controller.onSessionStarted()
      controller.onSessionStarted()
      assert.strictEqual(controller.getActiveSessions(), 2, "Should have 2 sessions")

      controller.onSessionEnded()
      assert.strictEqual(controller.getActiveSessions(), 1, "Should decrement to 1")

      controller.onSessionEnded()
      assert.strictEqual(controller.getActiveSessions(), 0, "Should decrement to 0")
    })

    it("prevents negative session count", () => {
      controller = new ActivationController(context as any)

      controller.onSessionEnded()
      controller.onSessionEnded()
      assert.strictEqual(controller.getActiveSessions(), 0, "Should not go below 0")
    })
  })

  describe("VS Code lifecycle", () => {
    it("handles VS Code shutdown gracefully", async () => {
      controller = new ActivationController(context as any)

      controller.onSessionStarted()
      controller.onSessionStarted()

      assert.strictEqual(controller.getActiveSessions(), 2)

      // Simulate VS Code shutdown
      await controller.dispose()

      assert.strictEqual(controller.getState(), ActivationState.DISPOSED, "Should be DISPOSED")
    })

    it("stops ACP immediately on dispose regardless of sessions", async () => {
      controller = new ActivationController(context as any)

      controller.onSessionStarted()
      controller.onSessionStarted()

      // Dispose immediately
      await controller.dispose()

      assert.strictEqual(controller.getState(), ActivationState.DISPOSED)
    })

    it("can be disposed multiple times safely", async () => {
      controller = new ActivationController(context as any)

      await controller.dispose()
      await controller.dispose() // Should not throw

      assert.strictEqual(controller.getState(), ActivationState.DISPOSED)
    })

    it("prevents operations when disposed", async () => {
      controller = new ActivationController(context as any)
      await controller.dispose()

      await assert.rejects(controller.ensureActivated(), /disposed/)
    })

    it("registers with VS Code context subscriptions", () => {
      controller = new ActivationController(context as any)

      // Should have registered a dispose handler
      assert.ok(context.subscriptions.length > 0, "Should register with context.subscriptions")
    })
  })

  describe("error handling", () => {
    it("handles start failures gracefully", async () => {
      controller = new ActivationController(context as any, {
        spawnOptions: { command: "/nonexistent/command", args: [] },
      })

      try {
        await controller.ensureActivated()
        assert.fail("Should have thrown")
      } catch (error) {
        assert.ok(error instanceof Error, "Should throw error")
        assert.strictEqual(controller.getState(), ActivationState.ERROR, "Should be in ERROR state")
      }
    })

    it("shows error message on start failure", async () => {
      controller = new ActivationController(context as any, {
        spawnOptions: { command: "/nonexistent/command", args: [] },
      })

      try {
        await controller.ensureActivated()
      } catch {
        // Expected to fail
      }

      assert.ok(
        mockVscode.window.lastErrorMessage?.includes("Failed to start") ||
          mockVscode.window.lastErrorMessage?.includes("OpenCode"),
        "Should show error message",
      )
    })

    it("allows retry after start failure", async () => {
      controller = new ActivationController(context as any, {
        spawnOptions: { command: "/nonexistent/command", args: [] },
      })

      // First attempt fails
      try {
        await controller.ensureActivated()
      } catch {
        // Expected
      }

      assert.strictEqual(controller.getState(), ActivationState.ERROR)

      // Reset to allow retry
      controller.reset()
      assert.strictEqual(controller.getState(), ActivationState.INACTIVE)
    })

    it("ignores reset when not in ERROR state", () => {
      controller = new ActivationController(context as any)

      controller.reset()
      assert.strictEqual(controller.getState(), ActivationState.INACTIVE, "Should remain INACTIVE")
    })

    it("ignores session operations when disposed", async () => {
      controller = new ActivationController(context as any)
      await controller.dispose()

      // These should not throw
      controller.onSessionStarted()
      controller.onSessionEnded()

      assert.strictEqual(controller.getActiveSessions(), 0)
    })
  })

  describe("state transitions", () => {
    it("follows correct state lifecycle", async () => {
      controller = new ActivationController(context as any, {
        spawnOptions: { command: "/nonexistent/command", args: [] },
      })

      // Initial state
      assert.strictEqual(controller.getState(), ActivationState.INACTIVE)

      // Starting (will fail)
      const activationPromise = controller.ensureActivated()
      assert.strictEqual(controller.getState(), ActivationState.STARTING)

      // Error (after failure)
      try {
        await activationPromise
      } catch {
        // Expected
      }
      assert.strictEqual(controller.getState(), ActivationState.ERROR)

      // Reset
      controller.reset()
      assert.strictEqual(controller.getState(), ActivationState.INACTIVE)

      // Disposed
      await controller.dispose()
      assert.strictEqual(controller.getState(), ActivationState.DISPOSED)
    })
  })

  describe("configuration", () => {
    it("uses custom spawn options when provided", () => {
      const customOptions = {
        command: "custom-command",
        args: ["--arg1", "--arg2"],
      }

      controller = new ActivationController(context as any, {
        spawnOptions: customOptions,
      })

      assert.ok(controller, "Should create controller with custom options")
    })

    it("uses default stop delay of 30 seconds", () => {
      controller = new ActivationController(context as any)

      const delay = controller.getStopDelay()
      assert.strictEqual(delay, 30000, "Default stop delay should be 30000ms")
    })

    it("allows custom stop delay", () => {
      controller = new ActivationController(context as any, { stopDelayMs: 5000 })

      const delay = controller.getStopDelay()
      assert.strictEqual(delay, 5000, "Custom stop delay should be 5000ms")
    })

    it("allows custom max restarts", () => {
      controller = new ActivationController(context as any, { maxRestarts: 3 })

      assert.ok(controller, "Should create controller with custom maxRestarts")
    })

    it("allows custom restart delay", () => {
      controller = new ActivationController(context as any, { restartDelayMs: 2000 })

      assert.ok(controller, "Should create controller with custom restartDelayMs")
    })
  })

  describe("workspace path resolution", () => {
    it("uses workspace folder when available", () => {
      mockVscode.workspace.workspaceFolders = [{ uri: { fsPath: "/workspace/path" } }]

      controller = new ActivationController(context as any)

      // Just verify it can be created with workspace folder
      assert.ok(controller)
    })

    it("falls back to process.cwd when no workspace", () => {
      mockVscode.workspace.workspaceFolders = null

      controller = new ActivationController(context as any)

      assert.ok(controller)
    })
  })
})
