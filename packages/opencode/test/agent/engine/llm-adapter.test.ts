import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { LLMDAGGenerator, type ProviderAdapter } from "../../../src/agent/engine/llm/llm-dag-generator"
import { DAGGenerator, DAG_PROMPT_TEMPLATE } from "../../../src/agent/engine/llm/dag-generator"
import type { Capability } from "../../../src/agent/engine/planner"
import type { DAG } from "../../../src/agent/engine/dag"

function makeCap(id: string, risk: 0 | 1 | 2 | 3 = 0): Capability {
  return {
    capability_id: id,
    name: id,
    description: `${id} tool`,
    input_schema: {},
    output_schema: {},
    tags: ["test"],
    risk_level: risk,
    total_calls: 0,
    success_rate: 1.0,
    avg_duration_ms: 0,
    avg_token_cost: 0,
  }
}

function makeMockProvider(
  responseFn: (messages: Array<{ role: string; content: string }>) => string,
): ProviderAdapter {
  return {
    chat: async ({ messages }) => ({ content: responseFn(messages) }),
  }
}

const mockDAGJson = JSON.stringify({
  nodes: [
    { node_id: "n1", capability_id: "read", inputs: { path: "src/index.ts" }, dependencies: [], risk_level: 0, estimated_tokens: 100, estimated_duration_ms: 5000 },
    { node_id: "n2", capability_id: "write", inputs: { path: "src/out.ts" }, dependencies: ["n1"], risk_level: 1, estimated_tokens: 200, estimated_duration_ms: 3000 },
  ],
  edges: [["n1", "n2"]],
})

// ─── DAGGenerator (base class) ──────────────────────────────────────────────

describe("DAGGenerator", () => {
  test("buildPrompt includes goal and capabilities", () => {
    const gen = new DAGGenerator()
    const caps = [makeCap("read"), makeCap("write")]
    const prompt = gen.buildPrompt("read a file", caps)
    expect(prompt).toContain("read a file")
    expect(prompt).toContain("read")
    expect(prompt).toContain("write")
  })

  test("generateDAG falls back to heuristic when no LLM caller set", async () => {
    const gen = new DAGGenerator()
    const caps = [makeCap("read"), makeCap("write")]
    const dag = await gen.generateDAG("read and write", caps)
    expect(dag.nodes.length).toBeGreaterThan(0)
    expect(dag.nodes.every((n) => n.status === "pending")).toBe(true)
    expect(dag.metadata.goal).toBe("read and write")
  })

  test("generateFallbackDAG respects risk ordering", async () => {
    const gen = new DAGGenerator()
    const caps = [
      makeCap("bash", 2),
      makeCap("read", 0),
      makeCap("write", 1),
    ]
    const dag = await gen.generateDAG("mixed risk", caps)
    // Low-risk capabilities should come first
    const firstNode = dag.nodes[0]
    expect(firstNode.risk_level).toBe(0)
  })

  test("generateFallbackDAG caps at 5 nodes", async () => {
    const gen = new DAGGenerator()
    const caps = Array.from({ length: 10 }, (_, i) => makeCap(`tool${i}`))
    const dag = await gen.generateDAG("many tools", caps)
    expect(dag.nodes.length).toBeLessThanOrEqual(5)
  })

  test("generateDAG with LLM caller parses valid JSON response", async () => {
    const gen = new DAGGenerator()
    gen.setLLMCaller(async (_prompt) => mockDAGJson)
    const caps = [makeCap("read"), makeCap("write")]
    const dag = await gen.generateDAG("parse json", caps)
    expect(dag.nodes).toHaveLength(2)
    expect(dag.edges).toHaveLength(1)
    expect(dag.nodes[0].node_id).toBe("n1")
  })

  test("generateDAG falls back on malformed LLM response", async () => {
    const gen = new DAGGenerator()
    gen.setLLMCaller(async (_prompt) => "not valid json at all {{{")
    const caps = [makeCap("read")]
    const dag = await gen.generateDAG("bad response", caps)
    // Should fall back to heuristic
    expect(dag.nodes.length).toBeGreaterThan(0)
  })

  test("extractJSON handles code-fenced JSON", async () => {
    const gen = new DAGGenerator()
    // Access private method via prototype for testing
    const extractJSON = (gen as unknown as { extractJSON: (t: string) => string }).extractJSON
    const result = extractJSON.call(gen, '```json\n{"key": "value"}\n```')
    expect(result).toContain('"key"')
  })
})

// ─── LLMDAGGenerator ────────────────────────────────────────────────────────

describe("LLMDAGGenerator", () => {
  test("uses provider when set", async () => {
    const gen = new LLMDAGGenerator()
    const provider = makeMockProvider(() => mockDAGJson)
    gen.setProvider(provider)
    const caps = [makeCap("read"), makeCap("write")]
    const dag = await gen.generateDAG("use provider", caps)
    expect(dag.nodes).toHaveLength(2)
  })

  test("falls back to heuristic when no provider", async () => {
    const gen = new LLMDAGGenerator()
    const caps = [makeCap("read"), makeCap("write")]
    const dag = await gen.generateDAG("no provider", caps)
    expect(dag.nodes.length).toBeGreaterThan(0)
  })

  test("generateReplanDAG with provider", async () => {
    const gen = new LLMDAGGenerator()
    const provider = makeMockProvider(() => mockDAGJson)
    gen.setProvider(provider)
    const caps = [makeCap("read"), makeCap("write")]
    const dag = await gen.generateReplanDAG("replan", caps, "some error", ["n1"], "n2")
    expect(dag.nodes.length).toBeGreaterThan(0)
  })

  test("generateKParallelDAGs creates k variants", async () => {
    const gen = new LLMDAGGenerator()
    const provider = makeMockProvider(() => mockDAGJson)
    gen.setProvider(provider)
    const caps = [makeCap("read"), makeCap("write")]
    const dags = await gen.generateKParallelDAGs("parallel", caps, 3)
    expect(dags).toHaveLength(3)
    for (const dag of dags) {
      expect(dag.nodes.length).toBeGreaterThan(0)
    }
  })
})

// ─── ProviderAdapter Integration ─────────────────────────────────────────────

describe("ProviderAdapter", () => {
  test("mock provider receives correct message format", async () => {
    let capturedMessages: Array<{ role: string; content: string }> = []
    const provider = makeMockProvider((messages) => {
      capturedMessages = messages
      return mockDAGJson
    })

    const gen = new LLMDAGGenerator()
    gen.setProvider(provider)
    await gen.generateDAG("test goal", [makeCap("read")])

    expect(capturedMessages.length).toBeGreaterThan(0)
    expect(capturedMessages[0].role).toBe("system")
    expect(capturedMessages[1].role).toBe("user")
    expect(capturedMessages[1].content).toContain("test goal")
  })

  test("provider error is caught and falls back", async () => {
    const provider: ProviderAdapter = {
      chat: async () => { throw new Error("API unavailable") },
    }
    const gen = new LLMDAGGenerator()
    gen.setProvider(provider)
    const caps = [makeCap("read")]
    const dag = await gen.generateDAG("error case", caps)
    // Should fall back to heuristic, not throw
    expect(dag.nodes.length).toBeGreaterThan(0)
  })

  test("auto-detect provider from env vars", () => {
    // The createAutoProviderAdapter checks env vars
    // We can't easily test real API keys, but we can verify the function exists
    const { createAutoProviderAdapter } = require("../../../src/agent/engine/llm/ai-sdk-adapter")
    expect(typeof createAutoProviderAdapter).toBe("function")
  })
})

// ─── DAG Prompt Template ─────────────────────────────────────────────────────

describe("DAG_PROMPT_TEMPLATE", () => {
  test("contains required structure", () => {
    expect(DAG_PROMPT_TEMPLATE).toContain("{{goal}}")
    expect(DAG_PROMPT_TEMPLATE).toContain("{{capabilities}}")
    expect(DAG_PROMPT_TEMPLATE).toContain("capability_id")
    expect(DAG_PROMPT_TEMPLATE).toContain("dependencies")
    expect(DAG_PROMPT_TEMPLATE).toContain("risk_level")
  })
})
