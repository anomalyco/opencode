import { describe, expect, test, mock, beforeEach } from "bun:test"
import { EvalOps, EvalOpsTool } from "./evalops"

import { Tool } from "./tool"


// Mock dependencies
mock.module("../config/config", () => ({
  Config: {
    get: mock(() => Promise.resolve({
      evalops: {
        enabled: true,
        autoRun: false,
        telemetry: false,
        defaultSuite: "test-suite",
      },
    })),
  },
}))

mock.module("../session", () => ({
  Session: {
    get: mock(() => Promise.resolve({
      id: "session-123",
      parentID: null,
    })),
    messages: mock(() => Promise.resolve([
      {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "Test message" }],
      },
      {
        id: "msg-2",
        role: "assistant",
        parts: [{ type: "text", text: "Response" }],
      },
    ])),
  },
}))

mock.module("../bus", () => ({
  Bus: {
    emit: mock(() => Promise.resolve()),
    event: mock(() => ({})),
  },
}))

describe("EvalOps Tool", () => {
  beforeEach(() => {
    // Reset mocks
    mock.restore()
  })

  test("should get configuration correctly", async () => {
    const config = await EvalOps.getConfig()
    expect(config.enabled).toBe(true)
    expect(config.autoRun).toBe(false)
    expect(config.telemetry).toBe(false)
    expect(config.defaultSuite).toBe("test-suite")
  })

  test("should check if auto-run should be enabled", async () => {
    const shouldRun = await EvalOps.shouldAutoRun("session-123")
    expect(shouldRun).toBe(false) // autoRun is false in config
  })

  test("should handle auto-run when enabled", async () => {
    mock.module("../config/config", () => ({
      Config: {
        get: mock(() => Promise.resolve({
          evalops: {
            enabled: true,
            autoRun: true,
            telemetry: false,
            defaultSuite: "test-suite",
          },
        })),
      },
    }))

    const shouldRun = await EvalOps.shouldAutoRun("session-123")
    expect(shouldRun).toBe(true)
  })

  test("EvalOpsTool should be defined correctly", async () => {
    const toolDef = await EvalOpsTool.init()

    expect(toolDef.description).toContain("EvalOps evaluation")
    expect(toolDef.parameters.shape).toHaveProperty("suite")
    expect(toolDef.parameters.shape).toHaveProperty("options")
  })

  test("EvalOpsTool should handle disabled state", async () => {
    mock.module("../config/config", () => ({
      Config: {
        get: mock(() => Promise.resolve({
          evalops: {
            enabled: false,
          },
        })),
      },
    }))

    const toolDef = await EvalOpsTool.init()
    const context: Tool.Context = {
      sessionID: "session-123",
      messageID: "msg-123",
      agent: "test",
      abort: new AbortController().signal,
      metadata: () => {},
    }

    const result = await toolDef.execute(
      { suite: "test-suite" },
      context
    )

    expect(result.title).toBe("EvalOps Disabled")
    expect(result.output).toContain("not enabled")
  })

  test("should format results correctly", async () => {
    const mockResults: EvalOps.Results.Type = {
      suite: "test-suite",
      tests: [
        {
          name: "Test 1",
          passed: true,
          duration: 100,
        },
        {
          name: "Test 2",
          passed: false,
          duration: 200,
          error: "Failed assertion",
        },
      ],
      summary: {
        total: 2,
        passed: 1,
        failed: 1,
        duration: 300,
      },
      timestamp: new Date().toISOString(),
    }

    // Mock fetch for external API
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        url: '',
        redirected: false,
        type: 'basic',
        body: null,
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        json: () => Promise.resolve(mockResults),
        text: () => Promise.resolve(JSON.stringify(mockResults)),
        clone: () => ({} as Response),
        preconnect: () => Promise.resolve(),
      } as Response)
    )

    mock.module("../config/config", () => ({
      Config: {
        get: mock(() => Promise.resolve({
          evalops: {
            enabled: true,
            apiUrl: "https://evalops.api",
            apiToken: "test-token",
          },
        })),
      },
    }))

    const context: Tool.Context = {
      sessionID: "session-123",
      messageID: "msg-123",
      agent: "test",
      abort: new AbortController().signal,
      metadata: () => {},
    }

    const toolDef = await EvalOpsTool.init()
    const result = await toolDef.execute(
      { suite: "test-suite" },
      context
    )

    expect(result.title).toContain("test-suite")
    expect(result.output).toContain("1/2 passed")
    expect(result.output).toContain("✅")
    expect(result.output).toContain("❌")
    expect(result.metadata["passed"]).toBe(false)
  })

  test("should handle API errors gracefully", async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
        url: '',
        redirected: false,
        type: 'basic',
        body: null,
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
        clone: () => ({} as Response),
        preconnect: () => Promise.resolve(),
      } as Response)
    )

    mock.module("../config/config", () => ({
      Config: {
        get: mock(() => Promise.resolve({
          evalops: {
            enabled: true,
            apiUrl: "https://evalops.api",
            apiToken: "test-token",
          },
        })),
      },
    }))

    const context: Tool.Context = {
      sessionID: "session-123",
      messageID: "msg-123",
      agent: "test",
      abort: new AbortController().signal,
      metadata: () => {},
    }

    const toolDef = await EvalOpsTool.init()
    const result = await toolDef.execute(
      { suite: "test-suite" },
      context
    )

    expect(result.title).toContain("Failed")
    expect(result.output).toContain("Evaluation failed")
    expect(result.metadata["passed"]).toBe(false)
  })

  test("should emit correct events", async () => {
    const emitSpy = mock()

    mock.module("../bus", () => ({
      Bus: {
        emit: emitSpy,
        event: mock(() => ({})),
      },
    }))

    const mockResults: EvalOps.Results.Type = {
      suite: "test-suite",
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        duration: 0,
      },
      timestamp: new Date().toISOString(),
    }

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        url: '',
        redirected: false,
        type: 'basic',
        body: null,
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        json: () => Promise.resolve(mockResults),
        text: () => Promise.resolve(JSON.stringify(mockResults)),
        clone: () => ({} as Response),
        preconnect: () => Promise.resolve(),
      } as Response)
    )

    mock.module("../config/config", () => ({
      Config: {
        get: mock(() => Promise.resolve({
          evalops: {
            enabled: true,
            apiUrl: "https://evalops.api",
          },
        })),
      },
    }))

    const context: Tool.Context = {
      sessionID: "session-123",
      messageID: "msg-123",
      agent: "test",
      abort: new AbortController().signal,
      metadata: () => {},
    }

    await EvalOps.runEvaluation("test-suite", context)

    // Check that events were emitted
    expect(emitSpy).toHaveBeenCalled()
  })
})

describe("EvalOps Results", () => {
  test("should validate results schema", () => {
    const validResults = {
      suite: "test-suite",
      tests: [
        {
          name: "Test 1",
          passed: true,
          duration: 100,
        },
      ],
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        duration: 100,
      },
      timestamp: "2024-01-01T00:00:00Z",
    }

    const parsed = EvalOps.Results.schema.safeParse(validResults)
    expect(parsed.success).toBe(true)
  })

  test("should reject invalid results schema", () => {
    const invalidResults = {
      suite: "test-suite",
      tests: "not-an-array", // Invalid
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        duration: 100,
      },
      timestamp: "2024-01-01T00:00:00Z",
    }

    const parsed = EvalOps.Results.schema.safeParse(invalidResults)
    expect(parsed.success).toBe(false)
  })
})