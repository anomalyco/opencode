import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ExecutorError, type ExecutorSDK } from "../../src/executor/sdk"
import { executorFixture } from "../fixture/executor-remote"

/**
 * Targets executor-dev on the cluster (default `http://127.0.0.1:7777` = tunnel).
 * Override with `VERITLY_EXECUTOR_URL`. Image must ship MicroPython + mpy-lib.
 */
const ms = 180000

const fx = executorFixture()
let sdk: ExecutorSDK

describe("Executor SDK", () => {
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
      expect(health.mode).toBe("micropython")
      expect(typeof health.activeSessions).toBe("number")
      expect(health.static.micropythonRunnable).toBe(true)
      expect(health.static.libReadable).toBe(true)
      expect(health.static.probeOutput).toContain("__readyz_ok__")
      expect(health.errors.length).toBe(0)
    },
    { timeout: ms },
  )

  test(
    "executes simple print",
    async () => {
      const sessionId = `test-${Date.now()}`
      const result = await sdk.exec(sessionId, "print('Hello from executor!')")

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("Hello from executor!")
      expect(result.sessionId).toBe(sessionId)
      expect(result.mode).toBe("micropython")
    },
    { timeout: ms },
  )

  test(
    "executes multi-line code",
    async () => {
      const sessionId = `test-multiline-${Date.now()}`
      const code = ["print('Line 1')", "print('Line 2')", "print('Line 3')"].join("\n")

      const result = await sdk.exec(sessionId, code)

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("Line 1")
      expect(result.output).toContain("Line 2")
      expect(result.output).toContain("Line 3")
    },
    { timeout: ms },
  )

  test(
    "handles raised SystemExit",
    async () => {
      const sessionId = `test-fail-${Date.now()}`
      const result = await sdk.exec(sessionId, "raise SystemExit(42)")

      expect(result.exitCode).toBe(42)
    },
    { timeout: ms },
  )

  test(
    "handles syntax error",
    async () => {
      const sessionId = `test-invalid-${Date.now()}`
      const result = await sdk.exec(sessionId, "%%%not_valid_python")

      expect(result.exitCode).not.toBe(0)
    },
    { timeout: ms },
  )

  test(
    "files persist within session",
    async () => {
      const sessionId = `test-persist-${Date.now()}`

      const w = await sdk.exec(
        sessionId,
        "f = open('test_data.json', 'w')\nf.write('{\"key\": \"value\"}')\nf.close()\n",
      )
      expect(w.exitCode).toBe(0)

      const r = await sdk.exec(sessionId, "f = open('test_data.json')\nprint(f.read())\nf.close()\n")
      expect(r.exitCode).toBe(0)
      expect(r.output).toContain('"key": "value"')
    },
    { timeout: ms },
  )

  test(
    "sessions are isolated",
    async () => {
      const session1 = `test-isolate-1-${Date.now()}`
      const session2 = `test-isolate-2-${Date.now()}`

      await sdk.exec(session1, "f = open('data.txt', 'w')\nf.write('session1-data')\nf.close()\n")

      const result = await sdk.exec(
        session2,
        "import os\nprint('exists' if os.path.isfile('data.txt') else 'missing')\n",
      )
      expect(result.output).toContain("missing")
    },
    { timeout: ms },
  )

  test(
    "getSession returns session status",
    async () => {
      const sessionId = `test-status-${Date.now()}`

      await sdk.exec(sessionId, "print('test')")

      const status = await sdk.getSession(sessionId)

      expect(status.sessionId).toBe(sessionId)
      expect(status.createdAt).toBeGreaterThan(0)
      expect(status.lastActivity).toBeGreaterThan(0)
      expect(status.mode).toBe("micropython")
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

      await sdk.exec(sessionId, "print('test')")
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

      await sdk.exec(sessionId1, "print('session 1')")
      await sdk.exec(sessionId2, "print('session 2')")

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
    "json module works",
    async () => {
      const sessionId = `test-json-${Date.now()}`

      const result = await sdk.exec(
        sessionId,
        [
          "import json",
          "data = {'status': 'ok', 'numbers': [1, 2, 3]}",
          "print(json.dumps(data))",
        ].join("\n"),
      )

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('"status": "ok"')
      expect(result.output).toContain('"numbers":')
    },
    { timeout: ms },
  )

  test(
    "bundled veritly_univer_sdk imports",
    async () => {
      const sessionId = `test-sdk-${Date.now()}`

      const result = await sdk.exec(
        sessionId,
        [
          "import json",
          "from veritly_univer_sdk import RangeRect, UniverSDK",
          "r = RangeRect(0, 10, 0, 5)",
          "u = UniverSDK()",
          "print(json.dumps({'status': 'success', 'startRow': r.startRow, 'sdk': str(type(u).__name__)}))",
        ].join("\n"),
      )

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("success")
      expect(result.output).toContain("UniverSDK")
    },
    { timeout: ms },
  )

  test(
    "handles unicode in code string",
    async () => {
      const sessionId = `test-special-${Date.now()}`

      const result = await sdk.exec(sessionId, "print('Special chars: café')")

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("café")
    },
    { timeout: ms },
  )
})
