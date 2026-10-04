import { describe, expect, it } from "bun:test"
import {
  tokenize,
  lexicalScore,
  reciprocalRankFusion,
  hybridRank,
  RRF_K_DEFAULT,
} from "../src/semantic/rrf"

describe("Hybrid Search & Reciprocal Rank Fusion (RRF)", () => {
  describe("tokenize", () => {
    it("splits whitespace and punctuation", () => {
      const tokens = tokenize("function calculateSum(a: number, b: number)")
      expect(tokens).toContain("function")
      expect(tokens).toContain("calculate")
      expect(tokens).toContain("sum")
      expect(tokens).toContain("number")
    })

    it("splits camelCase and PascalCase identifiers", () => {
      const tokens = tokenize("SessionRunnerLLM compactAfterOverflow")
      expect(tokens).toContain("session")
      expect(tokens).toContain("runner")
      expect(tokens).toContain("llm")
      expect(tokens).toContain("compact")
      expect(tokens).toContain("after")
      expect(tokens).toContain("overflow")
    })

    it("splits snake_case identifiers", () => {
      const tokens = tokenize("session_message_table baseline_seq")
      expect(tokens).toContain("session")
      expect(tokens).toContain("message")
      expect(tokens).toContain("table")
      expect(tokens).toContain("baseline")
      expect(tokens).toContain("seq")
    })
  })

  describe("lexicalScore", () => {
    it("scores higher when query tokens appear frequently", () => {
      const query = "session runner execution"
      const textHigh = "Session runner handles execution of LLM turn in session runner."
      const textLow = "This file defines some unrelated helper function."

      const scoreHigh = lexicalScore(query, textHigh)
      const scoreLow = lexicalScore(query, textLow)

      expect(scoreHigh).toBeGreaterThan(scoreLow)
      expect(scoreLow).toBe(0)
    })

    it("gives bonus for exact substring match", () => {
      const query = "compactAfterOverflow"
      const textExact = "export const compactAfterOverflow = Effect.fn(...) { return true }"
      const textSplit = "compact something and after that handle overflow"

      const scoreExact = lexicalScore(query, textExact)
      const scoreSplit = lexicalScore(query, textSplit)

      expect(scoreExact).toBeGreaterThan(scoreSplit)
    })
  })

  describe("reciprocalRankFusion", () => {
    it("combines two rankings and boosts items present in both top spots", () => {
      const itemA = { id: "chunk-A", text: "Code A" }
      const itemB = { id: "chunk-B", text: "Code B" }
      const itemC = { id: "chunk-C", text: "Code C" }

      // Dense ranking: A (rank 1), B (rank 2), C (rank 3)
      const denseList = [
        { item: itemA, score: 0.95 },
        { item: itemB, score: 0.85 },
        { item: itemC, score: 0.70 },
      ]

      // Lexical ranking: B (rank 1), A (rank 2), C (rank 3)
      const lexicalList = [
        { item: itemB, score: 10.0 },
        { item: itemA, score: 5.0 },
        { item: itemC, score: 1.0 },
      ]

      const fused = reciprocalRankFusion([denseList, lexicalList], (item) => item.id)

      expect(fused).toHaveLength(3)
      // Rank of A: 1/(60+1) + 1/(60+2) = 1/61 + 1/62 ≈ 0.01639 + 0.01613 = 0.03252
      // Rank of B: 1/(60+2) + 1/(60+1) = 1/62 + 1/61 ≈ 0.03252
      // Both A and B are above C
      expect(fused[2]!.item.id).toBe("chunk-C")
      expect(fused[0]!.rrfScore).toBeGreaterThan(fused[2]!.rrfScore)
    })

    it("elevates an item with exact lexical match even if dense rank is lower", () => {
      const itemA = { id: "chunk-A", text: "Generic session discussion" }
      const itemExact = { id: "chunk-exact", text: "exactFunctionSignatureDefinition" }

      // Dense: A is rank 1 (0.9), Exact is rank 10 (0.6)
      const denseList = [
        { item: itemA, score: 0.9 },
        ...Array.from({ length: 8 }, (_, i) => ({ item: { id: `filler-${i}`, text: "filler" }, score: 0.8 - i * 0.02 })),
        { item: itemExact, score: 0.6 },
      ]

      // Lexical: Exact is rank 1 (perfect match), A has 0 score / not ranked or low
      const lexicalList = [
        { item: itemExact, score: 15.0 },
        { item: itemA, score: 0.5 },
      ]

      const fused = reciprocalRankFusion([denseList, lexicalList], (item) => item.id)

      // Exact should be promoted to the top 2
      const topIds = fused.slice(0, 2).map((f) => f.item.id)
      expect(topIds).toContain("chunk-exact")
    })

    it("handles empty lists gracefully", () => {
      const fused = reciprocalRankFusion([], (item: any) => item.id)
      expect(fused).toEqual([])
    })
  })

  describe("hybridRank", () => {
    it("ranks candidates using dense similarity and lexical query matching", () => {
      const candidates = [
        {
          id: "chunk-1",
          text: "function authUser(token: string): boolean { return verifyToken(token); }",
          denseScore: 0.72,
        },
        {
          id: "chunk-2",
          text: "function renderUserAvatar(user: User): JSX.Element { return <Avatar />; }",
          denseScore: 0.85,
        },
        {
          id: "chunk-3",
          text: "const databaseConnectionPool = new Pool({ max: 20 });",
          denseScore: 0.30,
        },
      ]

      // Query asks for exact token verification
      const query = "verifyToken auth"
      const results = hybridRank({
        query,
        candidates,
        idFn: (c) => c.id,
        textFn: (c) => c.text,
        denseScoreFn: (c) => c.denseScore,
      })

      expect(results[0]!.item.id).toBe("chunk-1")
      expect(results[0]!.denseRank).toBeDefined()
      expect(results[0]!.lexicalRank).toBeDefined()
    })
  })
})
