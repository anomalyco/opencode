import { strict as assert } from "assert"
import { spawn, ChildProcess } from "child_process"
import { describe, it, beforeEach, afterEach } from "mocha"
import { AcpProcess, AcpProcessConfig, ProcessState } from "./process"

const nodeExecPath = process.execPath
const nodeCwd = process.cwd
const nodeEnv = process.env

// Mock config for testing
function createMockConfig(): AcpProcessConfig {
  return {
    cwd: nodeCwd(),
    env: { ...nodeEnv, TEST_MODE: "1" },
    maxRestarts: 3,
    restartDelay: 100, // Fast restart for tests
    healthCheckTimeout: 500, // Fast timeout for tests
    stopTimeout: 500, // Fast stop for tests
  }
}

// Helper to create a fake opencode acp process script
function createFakeAcpScript(exitAfterMs?: number, shouldCrash: boolean = false) {
  const script = `
    let messageCount = 0;
    
    process.stdin.on('data', (data) => {
      const lines = data.toString().split('\\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            const response = {
              jsonrpc: '2.0',
              id: msg.id,
              result: { capabilities: {}, protocolVersion: 1 }
            };
            console.log(JSON.stringify(response));
            messageCount++;
          }
        } catch (e) {
          // Ignore invalid JSON
        }
      }
    });
    
    ${exitAfterMs ? `setTimeout(() => { process.exit(${shouldCrash ? 1 : 0}); }, ${exitAfterMs});` : ""}
    
    // Keep process alive
    setInterval(() => {}, 1000);
  `
  return [nodeExecPath, "-e", script]
}

describe("AcpProcess", () => {
  let acpProcess: AcpProcess
  let cleanup: (() => void)[] = []

  beforeEach(() => {
    cleanup = []
  })

  afterEach(async () => {
    if (acpProcess) {
      await acpProcess.stop()
      acpProcess = null as any
    }
    for (const fn of cleanup) {
      fn()
    }
  })

  describe("creation", () => {
    it("AcpProcess can be created with config", () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      assert.ok(acpProcess, "Process should be created")
      assert.strictEqual(acpProcess.getState(), ProcessState.STOPPED, "Initial state should be STOPPED")
    })

    it("requires cwd in config", () => {
      assert.throws(() => {
        new AcpProcess({ env: {} } as any)
      }, /cwd is required/)
    })
  })

  describe("spawn", () => {
    it("AcpProcess spawns opencode acp subprocess", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      // Override the spawn command for testing
      const [cmd, ...args] = createFakeAcpScript()
      await acpProcess.start({ command: cmd, args })

      assert.strictEqual(acpProcess.getState(), ProcessState.RUNNING, "State should be RUNNING after start")
      assert.ok(acpProcess.getProcess(), "Process handle should exist")
    })

    it("emits spawn event when process spawns", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      let spawned = false
      acpProcess.onSpawn(() => {
        spawned = true
      })

      const [cmd, ...args] = createFakeAcpScript()
      await acpProcess.start({ command: cmd, args })

      // Wait a bit for spawn event
      await new Promise((r) => setTimeout(r, 50))
      assert.strictEqual(spawned, true, "Spawn event should be emitted")
    })

    it("throws if already running", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      const [cmd, ...args] = createFakeAcpScript()
      await acpProcess.start({ command: cmd, args })

      await assert.rejects(acpProcess.start({ command: cmd, args }), /already running/)
    })
  })

  describe("communication", () => {
    it("AcpProcess communicates via stdio", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      const [cmd, ...args] = createFakeAcpScript()
      await acpProcess.start({ command: cmd, args })

      // Send initialize request
      const response = await acpProcess.sendRequest({
        id: 1,
        method: "initialize",
        params: { protocolVersion: 1 },
      })

      assert.ok(response, "Should receive response")
      assert.strictEqual(response.id, 1, "Response ID should match")
      assert.ok(response.result, "Response should have result")
    })

    it("handles health check via initialize", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      const [cmd, ...args] = createFakeAcpScript()
      await acpProcess.start({ command: cmd, args })

      const healthy = await acpProcess.healthCheck()
      assert.strictEqual(healthy, true, "Health check should pass")
    })

    it("health check fails when process not responding", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      // Create a script that doesn't respond
      const script = `
        process.stdin.on('data', () => {});
        setInterval(() => {}, 1000);
      `
      await acpProcess.start({ command: nodeExecPath, args: ["-e", script] })

      const healthy = await acpProcess.healthCheck()
      assert.strictEqual(healthy, false, "Health check should fail")
    })

    it("receives stderr output", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      const script = `
        console.error("stderr message");
        process.stdin.on('data', () => {});
        setInterval(() => {}, 1000);
      `

      let stderrReceived = ""
      acpProcess.onStderr((data) => {
        stderrReceived += data
      })

      await acpProcess.start({ command: process.execPath, args: ["-e", script] })
      await new Promise((r) => setTimeout(r, 100))

      assert.ok(stderrReceived.includes("stderr message"), "Should receive stderr")
    })
  })

  describe("crash handling", () => {
    it("AcpProcess handles process crash", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      let crashed = false
      acpProcess.onCrash(() => {
        crashed = true
      })

      // Script exits immediately with error
      const [cmd, ...args] = createFakeAcpScript(50, true)
      await acpProcess.start({ command: cmd, args })

      // Wait for crash
      await new Promise((r) => setTimeout(r, 150))

      assert.strictEqual(crashed, true, "Crash event should be emitted")
      assert.strictEqual(acpProcess.getState(), ProcessState.CRASHED, "State should be CRASHED")
    })

    it("AcpProcess auto-restarts on crash with exponential backoff", async () => {
      const config = createMockConfig()
      config.restartDelay = 50 // Fast for testing
      acpProcess = new AcpProcess(config)

      let restartCount = 0
      acpProcess.onRestart(() => {
        restartCount++
      })

      // Script that crashes after 50ms
      const [cmd, ...args] = createFakeAcpScript(50, true)
      await acpProcess.start({ command: cmd, args })

      // Wait for multiple restarts
      await new Promise((r) => setTimeout(r, 400))

      assert.ok(restartCount >= 2, `Should have restarted multiple times, got ${restartCount}`)
    })

    it("stops restarting after max restarts exceeded", async () => {
      const config = createMockConfig()
      config.maxRestarts = 2
      config.restartDelay = 50
      acpProcess = new AcpProcess(config)

      const errors: Error[] = []
      acpProcess.onError((err) => {
        errors.push(err)
      })

      // Script that always crashes
      const script = `
        console.error("crashing");
        process.exit(1);
      `
      await acpProcess.start({ command: nodeExecPath, args: ["-e", script] })

      // Wait for restarts to complete
      await new Promise((r) => setTimeout(r, 500))

      assert.strictEqual(acpProcess.getState(), ProcessState.FAILED, "State should be FAILED")
      const maxRestartsError = errors.find((e) => e.message.includes("restarts"))
      assert.ok(
        maxRestartsError,
        "Should emit max restarts error. Got errors: " + errors.map((e) => e.message).join(", "),
      )
    })

    it("emits error event on spawn failure", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      let errorEmitted = false
      acpProcess.onError(() => {
        errorEmitted = true
      })

      // Try to spawn a non-existent command
      await assert.rejects(acpProcess.start({ command: "/nonexistent/command", args: [] }), /spawn/)

      assert.strictEqual(errorEmitted, true, "Error event should be emitted")
    })
  })

  describe("stop", () => {
    it("AcpProcess stops cleanly", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      const [cmd, ...args] = createFakeAcpScript()
      await acpProcess.start({ command: cmd, args })

      assert.strictEqual(acpProcess.getState(), ProcessState.RUNNING)

      await acpProcess.stop()

      assert.strictEqual(acpProcess.getState(), ProcessState.STOPPED)
      assert.strictEqual(acpProcess.getProcess(), null, "Process handle should be null")
    })

    it("emits exit event when stopped", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      let exited = false
      let exitCode: number | null = null
      acpProcess.onExit((code) => {
        exited = true
        exitCode = code
      })

      const [cmd, ...args] = createFakeAcpScript()
      await acpProcess.start({ command: cmd, args })
      await acpProcess.stop()

      assert.strictEqual(exited, true, "Exit event should be emitted")
      // Exit code may be null if killed
    })

    it("can be stopped when not running", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      // Should not throw
      await acpProcess.stop()
      assert.strictEqual(acpProcess.getState(), ProcessState.STOPPED)
    })

    it("kills process if graceful shutdown fails", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      // Script that ignores SIGTERM
      const script = `
        process.on('SIGTERM', () => {});
        process.stdin.on('data', () => {});
        setInterval(() => {}, 1000);
      `
      await acpProcess.start({ command: process.execPath, args: ["-e", script] })

      // Stop should force kill after timeout
      const stopPromise = acpProcess.stop()
      await stopPromise

      assert.strictEqual(acpProcess.getState(), ProcessState.STOPPED)
    })
  })

  describe("state transitions", () => {
    it("follows correct state lifecycle", async () => {
      const config = createMockConfig()
      acpProcess = new AcpProcess(config)

      assert.strictEqual(acpProcess.getState(), ProcessState.STOPPED)

      const [cmd, ...args] = createFakeAcpScript()
      await acpProcess.start({ command: cmd, args })
      assert.strictEqual(acpProcess.getState(), ProcessState.RUNNING)

      await acpProcess.stop()
      assert.strictEqual(acpProcess.getState(), ProcessState.STOPPED)
    })

    it("tracks restart count correctly", async () => {
      const config = createMockConfig()
      config.restartDelay = 50
      acpProcess = new AcpProcess(config)

      const [cmd, ...args] = createFakeAcpScript(50, true)
      await acpProcess.start({ command: cmd, args })

      // Wait for a few crashes
      await new Promise((r) => setTimeout(r, 200))

      assert.ok(acpProcess.getRestartCount() > 0, "Restart count should be tracked")
    })
  })
})
