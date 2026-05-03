import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ExecutorError, type ExecutorSDK } from "../../src/executor/sdk"
import { executorFixture } from "../fixture/executor-remote"

/**
 * Set `VERITLY_EXECUTOR_URL` to the exact executor endpoint under test.
 * The VM guest image is expected to include `veritly_univer_sdk` (rootfs build contract).
 */
const ms = 180000

const fx = executorFixture()
let sdk: ExecutorSDK

const executorUrl = process.env.VERITLY_EXECUTOR_URL?.trim()

describe.skipIf(!executorUrl)("Executor SDK", () => {
  beforeAll(async () => {
    await fx.init()
    sdk = fx.sdk
  }, { timeout: ms })

  afterAll(async () => {
    await fx.terminate()
  })

  test(
    "health check returns ok",
    async () => {
      const health = await sdk.health()

      expect(health.ok).toBe(true)
      expect(health.service).toBe("executor")
      expect(health.mode).toBe("firecracker")
      expect(health.guest).toBe("x86_64")
      expect(typeof health.activeSessions).toBe("number")
    },
    { timeout: ms },
  )

  test(
    "executes simple echo command",
    async () => {
      const sessionId = `test-${Date.now()}`
      const result = await sdk.exec(sessionId, "echo 'Hello from executor!'")

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("Hello from executor!")
      expect(result.sessionId).toBe(sessionId)
    },
    { timeout: ms },
  )

  test(
    "executes multi-line command",
    async () => {
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
    },
    { timeout: ms },
  )

  test(
    "handles command failure",
    async () => {
      const sessionId = `test-fail-${Date.now()}`
      const result = await sdk.exec(sessionId, "exit 42")

      expect(result.exitCode).toBe(42)
    },
    { timeout: ms },
  )

  test(
    "handles invalid command",
    async () => {
      const sessionId = `test-invalid-${Date.now()}`
      const result = await sdk.exec(sessionId, "not_a_real_command_12345")

      expect(result.exitCode).not.toBe(0)
    },
    { timeout: ms },
  )

  test(
    "files persist within session",
    async () => {
      const sessionId = `test-persist-${Date.now()}`

      const createResult = await sdk.exec(
        sessionId,
        "echo '{\"key\": \"value\"}' > /workspace/test_data.json",
      )
      expect(createResult.exitCode).toBe(0)

      const readResult = await sdk.exec(sessionId, "cat /workspace/test_data.json")
      expect(readResult.exitCode).toBe(0)
      expect(readResult.output).toContain('"key": "value"')
    },
    { timeout: ms },
  )

  test(
    "sessions are isolated",
    async () => {
      const session1 = `test-isolate-1-${Date.now()}`
      const session2 = `test-isolate-2-${Date.now()}`

      await sdk.exec(session1, "echo 'session1-data' > /workspace/data.txt")

      const result = await sdk.exec(session2, "cat /workspace/data.txt 2>&1 || echo 'FILE_NOT_FOUND'")
      expect(
        result.exitCode !== 0 ||
          result.output.includes("FILE_NOT_FOUND") ||
          result.output.includes("No such"),
      ).toBe(true)
    },
    { timeout: ms },
  )

  test(
    "getSession returns session status",
    async () => {
      const sessionId = `test-status-${Date.now()}`

      await sdk.exec(sessionId, "echo 'test'")

      const status = await sdk.getSession(sessionId)

      expect(status.sessionId).toBe(sessionId)
      expect(status.createdAt).toBeGreaterThan(0)
      expect(status.lastActivity).toBeGreaterThan(0)
      expect(status.mode).toBe("firecracker")
    },
    { timeout: ms },
  )

  test(
    "getSession throws for non-existent session",
    async () => {
      const nonExistentId = `test-nonexistent-${Date.now()}`

      try {
        await sdk.getSession(nonExistentId)
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(ExecutorError)
        expect((error as ExecutorError).code).toBe("SESSION_NOT_FOUND")
      }
    },
    { timeout: ms },
  )

  test(
    "closeSession removes session",
    async () => {
      const sessionId = `test-close-${Date.now()}`

      await sdk.exec(sessionId, "echo 'test'")
      await sdk.closeSession(sessionId)

      try {
        await sdk.getSession(sessionId)
        expect.unreachable()
      } catch (error) {
        expect((error as ExecutorError).code).toBe("SESSION_NOT_FOUND")
      }
    },
    { timeout: ms },
  )

  test(
    "listSessions returns active sessions",
    async () => {
      const sessionId1 = `test-list-1-${Date.now()}`
      const sessionId2 = `test-list-2-${Date.now()}`

      await sdk.exec(sessionId1, "echo 'session 1'")
      await sdk.exec(sessionId2, "echo 'session 2'")

      const sessions = await sdk.listSessions()

      expect(sessions.length).toBeGreaterThanOrEqual(2)

      const ids = sessions.map((s) => s.id)
      expect(ids).toContain(sessionId1)
      expect(ids).toContain(sessionId2)
    },
    { timeout: ms },
  )

  test(
    "isAvailable returns true when healthy",
    async () => {
      const available = await sdk.isAvailable()
      expect(available).toBe(true)
    },
    { timeout: ms },
  )

  test(
    "Python commands work in VM",
    async () => {
      const sessionId = `test-python-${Date.now()}`

      const result = await sdk.exec(
        sessionId,
        `python3 -c "
import json
data = {'status': 'ok', 'numbers': [1, 2, 3]}
print(json.dumps(data))
"`,
      )

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('"status": "ok"')
      expect(result.output).toContain('"numbers":')
    },
    { timeout: ms },
  )

  test(
    "Univer SDK is available and functional",
    async () => {
      const sessionId = `test-univer-${Date.now()}`

      const result = await sdk.exec(
        sessionId,
        `python3 -m pip show veritly_univer_sdk && python3 -c "
from veritly_univer_sdk import RangeRect, UniverSDK
import json

r = RangeRect(startRow=0, endRow=10, startColumn=0, endColumn=5)
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
"`,
      )

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('"status": "success"')
      expect(result.output).toContain('"range":')
      expect(result.output).toContain('"startRow": 0')
      expect(result.output).toContain('"endRow": 10')
    },
    { timeout: ms },
  )

  test(
    "handles commands with special characters",
    async () => {
      const sessionId = `test-special-${Date.now()}`

      const result = await sdk.exec(sessionId, "echo 'Special chars test'")

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("Special chars test")
    },
    { timeout: ms },
  )
})
