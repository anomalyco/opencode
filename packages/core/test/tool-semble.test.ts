import { describe, expect, it } from "bun:test"
import { Effect, Schema } from "effect"
import { parseSembleJson, applyBudgetLimits, SembleChunk } from "../src/semble"
import { Input, toModelOutput } from "../src/tool/semble"

describe("Semble Tool & Service", () => {
  it("validates dynamic input schema bounds without artificial ceiling", () => {
    const decode = Schema.decodeUnknownOption(Input)

    const validStandard = decode({
      query: "session compaction loop",
      limit: 5,
    })
    expect(validStandard._tag).toBe("Some")

    const validLarge = decode({
      query: "session compaction",
      limit: 100, // Large limits allowed
      maxTokens: 2000,
      maxCharacters: 8000,
    })
    expect(validLarge._tag).toBe("Some")
  })

  it("applies dynamic token and character budgets across code chunks", () => {
    const chunks: SembleChunk[] = [
      {
        file: "chunk1.ts",
        startLine: 1,
        endLine: 10,
        score: 0.95,
        content: "const a = 1;".repeat(20), // ~240 chars
      },
      {
        file: "chunk2.ts",
        startLine: 11,
        endLine: 20,
        score: 0.90,
        content: "const b = 2;".repeat(20),
      },
      {
        file: "chunk3.ts",
        startLine: 21,
        endLine: 30,
        score: 0.85,
        content: "const c = 3;".repeat(20),
      },
    ]

    // Budget of ~400 characters allows first chunk plus stops before third
    const budgetedChars = applyBudgetLimits(chunks, { maxCharacters: 400 })
    expect(budgetedChars.length).toBe(1)

    // Token budget of 200 tokens (~800 chars) accommodates multiple chunks
    const budgetedTokens = applyBudgetLimits(chunks, { maxTokens: 200 })
    expect(budgetedTokens.length).toBeGreaterThanOrEqual(2)
  })

  it("parses raw Semble JSON output into structured AST chunks", async () => {
    const mockJson = JSON.stringify([
      {
        file_path: "src/session/runner.ts",
        start_line: 45,
        end_line: 78,
        score: 0.94,
        type: "function",
        content: "export function runSessionDrain() {\n  return drainInbox()\n}",
      },
      {
        file_path: "src/session/coordinator.ts",
        start_line: 120,
        end_line: 145,
        score: 0.88,
        type: "class",
        content: "export class SessionCoordinator {\n  constructor() {}\n}",
      },
    ])

    const effect = parseSembleJson(mockJson, "/workspace")
    const chunks = await Effect.runPromise(effect)

    expect(chunks.length).toBe(2)
    expect(chunks[0]?.file).toBe("src/session/runner.ts")
    expect(chunks[0]?.startLine).toBe(45)
    expect(chunks[0]?.endLine).toBe(78)
    expect(chunks[0]?.score).toBeCloseTo(0.94, 2)
    expect(chunks[0]?.type).toBe("function")
    expect(chunks[0]?.content).toContain("runSessionDrain")
  })

  it("formats AST code chunks into concise model output", () => {
    const chunks: SembleChunk[] = [
      {
        file: "src/auth/middleware.ts",
        startLine: 10,
        endLine: 25,
        score: 0.92,
        type: "function",
        content: "export function authMiddleware(req, res, next) {\n  validateToken(req)\n}",
      },
    ]

    const formatted = toModelOutput(chunks)
    expect(formatted).toContain("Found 1 relevant code chunk")
    expect(formatted).toContain("src/auth/middleware.ts:10-25 [function] (relevance: 0.92)")
    expect(formatted).toContain("export function authMiddleware")
  })

  it("handles empty search results gracefully", () => {
    const formatted = toModelOutput([])
    expect(formatted).toBe("No matching code chunks found.")
  })
})
