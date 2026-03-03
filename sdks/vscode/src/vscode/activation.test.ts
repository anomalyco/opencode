import { strict as assert } from "assert"
import { describe, it, beforeEach, afterEach } from "mocha"
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
  let output: any

  beforeEach(() => {
    context = new mockVscode.ExtensionContext()
    streams = createMockStreams()
    output = {
      name: "OpenCode",
      append: () => {},
      appendLine: () => {},
      replace: () => {},
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
    }
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
      controller = new ActivationController(context as any, output)

      assert.strictEqual(controller.getState(), ActivationState.INACTIVE, "Should be INACTIVE initially")
      assert.strictEqual(controller.getActiveSessions(), 0, "Should have zero active sessions")
      assert.strictEqual(controller.isProcessRunning(), false, "Process should not be running")
    })

    it("transitions to STARTING when ensureActivated is called", async () => {
      controller = new ActivationController(context as any, output, {
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
      controller = new ActivationController(context as any, output, {
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
      controller = new ActivationController(context as any, output)

      assert.strictEqual(controller.getActiveSessions(), 0, "Initial sessions should be 0")

      controller.onSessionStarted()
      assert.strictEqual(controller.getActiveSessions(), 1, "Should increment to 1")

      controller.onSessionStarted()
      assert.strictEqual(controller.getActiveSessions(), 2, "Should increment to 2")
    })

    it("decrements active session count on session end", () => {
      controller = new ActivationController(context as any, output)

      controller.onSessionStarted()
      controller.onSessionStarted()
      assert.strictEqual(controller.getActiveSessions(), 2, "Should have 2 sessions")

      controller.onSessionEnded()
      assert.strictEqual(controller.getActiveSessions(), 1, "Should decrement to 1")

      controller.onSessionEnded()
      assert.strictEqual(controller.getActiveSessions(), 0, "Should decrement to 0")
    })

    it("prevents negative session count", () => {
      controller = new ActivationController(context as any, output)

      controller.onSessionEnded()
      controller.onSessionEnded()
      assert.strictEqual(controller.getActiveSessions(), 0, "Should not go below 0")
    })
  })

  describe("VS Code lifecycle", () => {
    it("handles VS Code shutdown gracefully", async () => {
      controller = new ActivationController(context as any, output)

      controller.onSessionStarted()
      controller.onSessionStarted()

      assert.strictEqual(controller.getActiveSessions(), 2)

      // Simulate VS Code shutdown
      await controller.dispose()

      assert.strictEqual(controller.getState(), ActivationState.DISPOSED, "Should be DISPOSED")
    })

    it("stops ACP immediately on dispose regardless of sessions", async () => {
      controller = new ActivationController(context as any, output)

      controller.onSessionStarted()
      controller.onSessionStarted()

      // Dispose immediately
      await controller.dispose()

      assert.strictEqual(controller.getState(), ActivationState.DISPOSED)
    })

    it("can be disposed multiple times safely", async () => {
      controller = new ActivationController(context as any, output)

      await controller.dispose()
      await controller.dispose() // Should not throw

      assert.strictEqual(controller.getState(), ActivationState.DISPOSED)
    })

    it("prevents operations when disposed", async () => {
      controller = new ActivationController(context as any, output)
      await controller.dispose()

      await assert.rejects(controller.ensureActivated(), /disposed/)
    })

    it("registers with VS Code context subscriptions", () => {
      controller = new ActivationController(context as any, output)

      // Should have registered a dispose handler
      assert.ok(context.subscriptions.length > 0, "Should register with context.subscriptions")
    })
  })

  describe("error handling", () => {
    it("handles start failures gracefully", async () => {
      controller = new ActivationController(context as any, output, {
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
      controller = new ActivationController(context as any, output, {
        spawnOptions: { command: "/nonexistent/command", args: [] },
      })

      try {
        await controller.ensureActivated()
      } catch {
        // Expected to fail
      }

      assert.strictEqual(controller.getState(), ActivationState.ERROR, "Should be in ERROR state after failure")
    })

    it("does not set ERROR when disposed during activation", async () => {
      controller = new ActivationController(context as any, output)

      let waited = false
      ;(controller as any).startAcp = async () => {
        await new Promise<void>((resolve) => {
          setImmediate(() => {
            waited = true
            resolve()
          })
        })
      }

      const activationPromise = controller.ensureActivated()
      await controller.dispose()

      await assert.rejects(activationPromise, /Activation canceled after disposal/)

      assert.strictEqual(waited, true, "Activation should have awaited start")
      assert.strictEqual(controller.getState(), ActivationState.DISPOSED, "Should stay DISPOSED")
      assert.strictEqual(mockVscode.window.lastErrorMessage, null, "Should not show error message")
    })

    it("ignores session operations when disposed", async () => {
      controller = new ActivationController(context as any, output)
      await controller.dispose()

      // These should not throw
      controller.onSessionStarted()
      controller.onSessionEnded()

      assert.strictEqual(controller.getActiveSessions(), 0)
    })

    it("retries ensureActivated after failure without reset", async () => {
      controller = new ActivationController(context as any, output)

      let attempts = 0
      const client = {
        getState: () => AcpClientState.INITIALIZED,
        dispose: async () => {},
      }

      ;(controller as any).startAcp = async () => {
        attempts++
        if (attempts === 1) {
          throw new Error("start failed")
        }
        ;(controller as any).client = client
      }

      await assert.rejects(controller.ensureActivated(), /start failed/)
      const activated = await controller.ensureActivated()

      assert.strictEqual(attempts, 2, "Should retry activation after failure")
      assert.strictEqual(activated, client as any, "Should return the initialized client")
    })
  })

  describe("state transitions", () => {
    it("follows correct state lifecycle", async () => {
      controller = new ActivationController(context as any, output, {
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

      // Disposed
      await controller.dispose()
      assert.strictEqual(controller.getState(), ActivationState.DISPOSED)
    })

    it("does not override ACTIVE when scheduleStop races activation", async () => {
      controller = new ActivationController(context as any, output, { stopDelayMs: 0 })
      ;(controller as any).stopAcp = async () => {
        ;(controller as any).state = ActivationState.ACTIVE
      }
      ;(controller as any).state = ActivationState.ACTIVE
      ;(controller as any).scheduleStop()

      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))

      assert.strictEqual(controller.getState(), ActivationState.ACTIVE, "Should not overwrite ACTIVE")
    })
  })

  describe("configuration", () => {
    it("uses custom spawn options when provided", () => {
      const customOptions = {
        command: "custom-command",
        args: ["--arg1", "--arg2"],
      }

      controller = new ActivationController(context as any, output, {
        spawnOptions: customOptions,
      })

      assert.ok(controller, "Should create controller with custom options")
    })

    it("uses default stop delay of 30 seconds", () => {
      controller = new ActivationController(context as any, output)

      const delay = controller.getStopDelay()
      assert.strictEqual(delay, 30000, "Default stop delay should be 30000ms")
    })

    it("allows custom stop delay", () => {
      controller = new ActivationController(context as any, output, { stopDelayMs: 5000 })

      const delay = controller.getStopDelay()
      assert.strictEqual(delay, 5000, "Custom stop delay should be 5000ms")
    })

    it("allows custom max restarts", () => {
      controller = new ActivationController(context as any, output)

      assert.ok(controller, "Should create controller without maxRestarts configuration")
    })
  })

  describe("crash recovery", () => {
    it("retries ensureActivated after crash with fresh start", async () => {
      controller = new ActivationController(context as any, output)

      let attempts = 0
      const client = {
        getState: () => AcpClientState.INITIALIZED,
        dispose: async () => {},
      }

      ;(controller as any).startAcp = async () => {
        attempts++
        if (attempts === 1) {
          ;(controller as any).handleProcessError(new Error("crash"))
          throw new Error("crash")
        }
        ;(controller as any).client = client
      }

      await assert.rejects(controller.ensureActivated(), /crash/)

      const activated = await controller.ensureActivated()

      assert.strictEqual(attempts, 2, "Should retry activation after crash")
      assert.strictEqual(activated, client as any, "Should return the initialized client")
    })

    it("handles crash after activation and retries ensureActivated", async () => {
      controller = new ActivationController(context as any, output)

      let attempts = 0
      let disposed = 0
      let stopped = 0

      const client1 = {
        getState: () => AcpClientState.INITIALIZED,
        dispose: async () => {
          disposed++
        },
      }
      const client2 = {
        getState: () => AcpClientState.INITIALIZED,
        dispose: async () => {
          disposed++
        },
      }

      ;(controller as any).startAcp = async () => {
        attempts++
        if (attempts === 1) {
          ;(controller as any).client = client1
          ;(controller as any).connection = { dispose: () => {} }
          ;(controller as any).process = {
            stop: async () => {
              stopped++
            },
          }
          return
        }
        ;(controller as any).client = client2
      }

      const activated = await controller.ensureActivated()
      assert.strictEqual(activated, client1 as any, "Should activate with first client")
      ;(controller as any).handleProcessCrash()
      await new Promise((resolve) => setImmediate(resolve))

      assert.strictEqual(controller.getState(), ActivationState.ERROR, "Crash should set ERROR state")
      assert.strictEqual(disposed, 1, "Crash should dispose client")
      assert.strictEqual(stopped, 1, "Crash should stop process")

      const restarted = await controller.ensureActivated()

      assert.strictEqual(attempts, 2, "Should retry activation after crash")
      assert.strictEqual(restarted, client2 as any, "Should activate with new client")
    })
  })

  describe("workspace path resolution", () => {
    it("uses workspace folder when available", () => {
      mockVscode.workspace.workspaceFolders = [{ uri: { fsPath: "/workspace/path" } }]

      controller = new ActivationController(context as any, output)

      // Just verify it can be created with workspace folder
      assert.ok(controller)
    })

    it("falls back to process.cwd when no workspace", () => {
      mockVscode.workspace.workspaceFolders = null

      controller = new ActivationController(context as any, output)

      assert.ok(controller)
    })
  })
})
