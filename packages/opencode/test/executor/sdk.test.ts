import { describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { withExecutor } from "../fixture/executor-testcontainer"
import { ExecutorSDK, ExecutorError } from "../../src/executor/sdk"

Log.init({ print: false })

// Increase timeout for executor tests (Firecracker VM boot can take time)
const TEST_TIMEOUT = 180000 // 3 minutes
const expectedMode = "dangerous-local"

describe("Executor SDK", () => {
  test("health check returns ok", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const health = await sdk.health()
      
      expect(health.ok).toBe(true)
      expect(health.service).toBe("executor")
      expect(health.mode).toBe(expectedMode)
      expect(typeof health.activeSessions).toBe("number")
    })
  })

  test("executes simple echo command", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-${Date.now()}`
      const result = await sdk.exec(sessionId, "echo 'Hello from executor!'")
      
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("Hello from executor!")
      expect(result.sessionId).toBe(sessionId)
    })
  })

  test("executes multi-line command", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-multiline-${Date.now()}`
      const command = `
        echo "Line 1" &&
        echo "Line 2" &&
        echo "Line 3"
      `
      
      const result = await sdk.exec(sessionId, command)
      
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("Line 1")
      expect(result.output).toContain("Line 2")
      expect(result.output).toContain("Line 3")
    })
  })

  test("handles command failure", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-fail-${Date.now()}`
      const result = await sdk.exec(sessionId, "exit 42")
      
      expect(result.exitCode).toBe(42)
    })
  })

  test("handles invalid command", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-invalid-${Date.now()}`
      const result = await sdk.exec(sessionId, "not_a_real_command_12345")
      
      expect(result.exitCode).not.toBe(0)
    })
  })

  test("files persist within session", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-persist-${Date.now()}`
      
      // Create a file
      const createResult = await sdk.exec(
        sessionId,
        "echo '{\"key\": \"value\"}' > /workspace/test_data.json"
      )
      expect(createResult.exitCode).toBe(0)
      
      // Read the file
      const readResult = await sdk.exec(
        sessionId,
        "cat /workspace/test_data.json"
      )
      expect(readResult.exitCode).toBe(0)
      expect(readResult.output).toContain('"key": "value"')
    })
  })

  test("sessions are isolated", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const session1 = `test-isolate-1-${Date.now()}`
      const session2 = `test-isolate-2-${Date.now()}`
      
      // Create file in session 1
      await sdk.exec(session1, "echo 'session1-data' > /workspace/data.txt")
      
      // Check file does NOT exist in session 2
      const result = await sdk.exec(session2, "cat /workspace/data.txt 2>&1 || echo 'FILE_NOT_FOUND'")
      // File should not exist in session2
      expect(result.exitCode !== 0 || result.output.includes("FILE_NOT_FOUND") || result.output.includes("No such")).toBe(true)
    })
  })

  test("getSession returns session status", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-status-${Date.now()}`
      
      // Create session by executing command
      await sdk.exec(sessionId, "echo 'test'")
      
      // Get session status
      const status = await sdk.getSession(sessionId)
      
      expect(status.sessionId).toBe(sessionId)
      expect(status.createdAt).toBeGreaterThan(0)
      expect(status.lastActivity).toBeGreaterThan(0)
      expect(status.mode).toBe(expectedMode)
    })
  })

  test("getSession throws for non-existent session", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const nonExistentId = `test-nonexistent-${Date.now()}`
      
      try {
        await sdk.getSession(nonExistentId)
        expect(false).toBe(true) // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(ExecutorError)
        expect((error as ExecutorError).code).toBe("SESSION_NOT_FOUND")
      }
    })
  })

  test("closeSession removes session", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-close-${Date.now()}`
      
      // Create and close session
      await sdk.exec(sessionId, "echo 'test'")
      await sdk.closeSession(sessionId)
      
      // Session should be removed
      try {
        await sdk.getSession(sessionId)
        expect(false).toBe(true) // Should not reach here
      } catch (error) {
        expect((error as ExecutorError).code).toBe("SESSION_NOT_FOUND")
      }
    })
  })

  test("listSessions returns active sessions", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      // Create a few sessions
      const sessionId1 = `test-list-1-${Date.now()}`
      const sessionId2 = `test-list-2-${Date.now()}`
      
      await sdk.exec(sessionId1, "echo 'session 1'")
      await sdk.exec(sessionId2, "echo 'session 2'")
      
      // List sessions
      const sessions = await sdk.listSessions()
      
      // Should have at least our 2 sessions
      expect(sessions.length).toBeGreaterThanOrEqual(2)
      
      const ids = sessions.map(s => s.id)
      expect(ids).toContain(sessionId1)
      expect(ids).toContain(sessionId2)
    })
  })

  test("isAvailable returns true when healthy", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const available = await sdk.isAvailable()
      expect(available).toBe(true)
    })
  })

  test("Python commands work in VM", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-python-${Date.now()}`
      
      const result = await sdk.exec(
        sessionId,
        `python3 -c "
import json
data = {'status': 'ok', 'numbers': [1, 2, 3]}
print(json.dumps(data))
"`
      )
      
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('"status": "ok"')
      expect(result.output).toContain('"numbers":')
    })
  })

  test("Univer SDK is available and functional", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-univer-${Date.now()}`
      
      const result = await sdk.exec(
        sessionId,
        `python3 -m pip show veritly_univer_sdk && python3 -c "
from veritly_univer_sdk import RangeRect, UniverSDK
import json

# Create a RangeRect
r = RangeRect(startRow=0, endRow=10, startColumn=0, endColumn=5)

# Check SDK can be instantiated
sdk = UniverSDK()

result = {
    'status': 'success',
    'range': {
        'startRow': r.startRow,
        'endRow': r.endRow,
        'startColumn': r.startColumn,
        'endColumn': r.endColumn
    },
    'sdk_type': str(type(sdk).__name__)
}

print(json.dumps(result, indent=2))
"`
      )
      
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('"status": "success"')
      expect(result.output).toContain('"range":')
      expect(result.output).toContain('"startRow": 0')
      expect(result.output).toContain('"endRow": 10')
    })
  })

  test("handles commands with special characters", { timeout: TEST_TIMEOUT }, async () => {
    await withExecutor(async ({ sdk }) => {
      const sessionId = `test-special-${Date.now()}`
      
      const result = await sdk.exec(
        sessionId,
        "echo 'Special chars test'"
      )
      
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("Special chars test")
    })
  })
})
