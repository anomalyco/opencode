import { describe, expect, it } from "bun:test"
import {
  DEFAULT_GATE_SETTINGS,
  classifyTurn,
  probeBackend,
  querySystemOne,
  resolveGateSettings,
  type DecisionGateSettings,
} from "../../src/superfast/decision-gate"

function enabled(overrides: Partial<DecisionGateSettings> = {}): DecisionGateSettings {
  return { ...DEFAULT_GATE_SETTINGS, enabled: true, ...overrides }
}

// Run `fn` against a throwaway HTTP server that replies with a fixed status/body.
// Using a real server exercises the actual fetch + parse path instead of mocking it.
async function withServer<T>(status: number, body: unknown, fn: (endpoint: string) => Promise<T>): Promise<T> {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    },
  })
  try {
    return await fn(`http://localhost:${server.port}/v1/systemone`)
  } finally {
    void server.stop(true)
  }
}

// A port nothing listens on — used to force a connection-refused network error.
const DEAD_ENDPOINT = "http://127.0.0.1:1/v1/systemone"

describe("resolveGateSettings", () => {
  it("returns defaults when no input is given", () => {
    expect(resolveGateSettings()).toEqual(DEFAULT_GATE_SETTINGS)
  })

  it("is disabled by default", () => {
    expect(resolveGateSettings({}).enabled).toBe(false)
  })

  it("applies overrides", () => {
    const s = resolveGateSettings({
      enabled: true,
      endpoint: "http://x:9/v1/systemone",
      model: "von-9",
      timeoutMs: 50,
    })
    expect(s).toEqual({ enabled: true, endpoint: "http://x:9/v1/systemone", model: "von-9", timeoutMs: 50 })
  })

  it("falls back to the default timeout for non-positive or non-numeric values", () => {
    expect(resolveGateSettings({ timeoutMs: 0 }).timeoutMs).toBe(DEFAULT_GATE_SETTINGS.timeoutMs)
    expect(resolveGateSettings({ timeoutMs: -5 }).timeoutMs).toBe(DEFAULT_GATE_SETTINGS.timeoutMs)
  })

  it("ignores empty-string endpoint/model and keeps defaults", () => {
    const s = resolveGateSettings({ endpoint: "", model: "" })
    expect(s.endpoint).toBe(DEFAULT_GATE_SETTINGS.endpoint)
    expect(s.model).toBe(DEFAULT_GATE_SETTINGS.model)
  })
})

describe("querySystemOne", () => {
  it("returns parsed answers on success", async () => {
    await withServer(200, { answers: { needs_tool: { noul: 0.9 } } }, async (endpoint) => {
      const answers = await querySystemOne("hi", { needs_tool: { type: "noul", instructions: "need a tool?" } }, enabled({ endpoint }))
      expect(answers).toEqual({ needs_tool: { noul: 0.9 } })
    })
  })

  it("fails open (null) on a non-2xx response", async () => {
    await withServer(503, {}, async (endpoint) => {
      const answers = await querySystemOne("hi", { a: { type: "noul", instructions: "x" } }, enabled({ endpoint }))
      expect(answers).toBeNull()
    })
  })

  it("fails open (null) on a malformed response body", async () => {
    await withServer(200, { unexpected: true }, async (endpoint) => {
      const answers = await querySystemOne("hi", { a: { type: "noul", instructions: "x" } }, enabled({ endpoint }))
      expect(answers).toBeNull()
    })
  })

  it("fails open (null) on a network error", async () => {
    const answers = await querySystemOne("hi", { a: { type: "noul", instructions: "x" } }, enabled({ endpoint: DEAD_ENDPOINT }))
    expect(answers).toBeNull()
  })

  it("fails open (null) when the request exceeds the timeout", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        // Responds long after the 50ms timeout so the client aborts first.
        return new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("{}")), 500))
      },
    })
    try {
      const answers = await querySystemOne(
        "hi",
        { a: { type: "noul", instructions: "x" } },
        enabled({ endpoint: `http://localhost:${server.port}/v1/systemone`, timeoutMs: 50 }),
      )
      expect(answers).toBeNull()
    } finally {
      void server.stop(true)
    }
  })

  it("propagates the caller abort signal", async () => {
    const controller = new AbortController()
    controller.abort()
    await withServer(200, { answers: {} }, async (endpoint) => {
      await expect(
        querySystemOne("hi", { a: { type: "noul", instructions: "x" } }, enabled({ endpoint }), controller.signal),
      ).rejects.toThrow()
    })
  })
})

describe("classifyTurn", () => {
  it("returns null when disabled (no network call)", async () => {
    const decision = await classifyTurn("hi", { ...DEFAULT_GATE_SETTINGS, enabled: false })
    expect(decision).toBeNull()
  })

  it("routes needs_tool when the tool probability is decisive", async () => {
    await withServer(
      200,
      {
        answers: {
          needs_tool: { noul: 0.95 },
          answerable_from_context: { noul: 0.1 },
          intent: { choice: "code_change", confidence: 0.9 },
        },
      },
      async (endpoint) => {
        const decision = await classifyTurn("delete the tmp dir", enabled({ endpoint }))
        expect(decision?.route).toBe("needs_tool")
      },
    )
  })

  it("routes answer_from_context when strongly answerable and low tool need", async () => {
    await withServer(
      200,
      {
        answers: {
          needs_tool: { noul: 0.1 },
          answerable_from_context: { noul: 0.92 },
          intent: { choice: "code_question", confidence: 0.8 },
        },
      },
      async (endpoint) => {
        const decision = await classifyTurn("what did we just change?", enabled({ endpoint }))
        expect(decision?.route).toBe("answer_from_context")
      },
    )
  })

  it("routes plain_chat for obvious chat with no tool need", async () => {
    await withServer(
      200,
      {
        answers: {
          needs_tool: { noul: 0.05 },
          answerable_from_context: { noul: 0.4 },
          intent: { choice: "chat", confidence: 0.95 },
        },
      },
      async (endpoint) => {
        const decision = await classifyTurn("thanks!", enabled({ endpoint }))
        expect(decision?.route).toBe("plain_chat")
      },
    )
  })

  it("routes unknown when signals are not decisive", async () => {
    await withServer(
      200,
      {
        answers: {
          needs_tool: { noul: 0.5 },
          answerable_from_context: { noul: 0.5 },
          intent: { choice: "other", confidence: 0.4 },
        },
      },
      async (endpoint) => {
        const decision = await classifyTurn("hmm", enabled({ endpoint }))
        expect(decision?.route).toBe("unknown")
      },
    )
  })

  it("returns null when the backend is unavailable (fail-open)", async () => {
    const decision = await classifyTurn("hi", enabled({ endpoint: DEAD_ENDPOINT }))
    expect(decision).toBeNull()
  })
})

describe("probeBackend", () => {
  it("returns true when the endpoint answers a noul", async () => {
    await withServer(200, { answers: { ok: { noul: 0.7 } } }, async (endpoint) => {
      await expect(probeBackend(enabled({ endpoint }))).resolves.toBe(true)
    })
  })

  it("returns false when the endpoint is unreachable", async () => {
    await expect(probeBackend(enabled({ endpoint: DEAD_ENDPOINT }))).resolves.toBe(false)
  })
})
