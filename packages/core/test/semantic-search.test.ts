import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { cosineSimilarity, SemanticEmbedder } from "../src/semantic/embedder"
import {
  chunkFile,
  toModelOutput,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  CHUNK_SIZE_LINES,
  CHUNK_OVERLAP_LINES,
  name,
} from "../src/tool/semantic-search"

describe("Semantic Search & Local Embeddings", () => {
  describe("cosineSimilarity", () => {
    it("returns 1.0 for identical vectors", () => {
      const vec = [0.2, 0.5, 0.8, -0.3]
      const similarity = cosineSimilarity(vec, vec)
      expect(Math.abs(similarity - 1.0)).toBeLessThan(1e-5)
    })

    it("returns 0.0 for orthogonal vectors", () => {
      const v1 = [1, 0, 0]
      const v2 = [0, 1, 0]
      const similarity = cosineSimilarity(v1, v2)
      expect(similarity).toBe(0)
    })

    it("returns -1.0 for opposite vectors", () => {
      const v1 = [1, 2, 3]
      const v2 = [-1, -2, -3]
      const similarity = cosineSimilarity(v1, v2)
      expect(Math.abs(similarity - (-1.0))).toBeLessThan(1e-5)
    })

    it("handles zero vectors or empty vectors safely", () => {
      expect(cosineSimilarity([], [])).toBe(0)
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
      expect(cosineSimilarity([1, 2], [1])).toBe(0)
    })
  })

  describe("chunkFile", () => {
    it("returns a single chunk when content is within line limit", () => {
      const content = "line 1\nline 2\nline 3"
      const chunks = chunkFile("src/test.ts", content)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]?.startLine).toBe(1)
      expect(chunks[0]?.endLine).toBe(3)
      expect(chunks[0]?.text).toBe(content)
      expect(chunks[0]?.relativePath).toBe("src/test.ts")
    })

    it("splits long content into overlapping chunks with correct boundaries", () => {
      const lines = Array.from({ length: 80 }, (_, i) => `const val_${i} = ${i};`)
      const content = lines.join("\n")
      const chunks = chunkFile("src/large.ts", content)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks[0]?.startLine).toBe(1)
      expect(chunks[0]?.endLine).toBe(CHUNK_SIZE_LINES)

      // Next chunk should overlap by CHUNK_OVERLAP_LINES
      const expectedSecondStart = CHUNK_SIZE_LINES - CHUNK_OVERLAP_LINES + 1
      expect(chunks[1]?.startLine).toBe(expectedSecondStart)

      // Last chunk covers the end
      const last = chunks[chunks.length - 1]
      expect(last?.endLine).toBe(80)
    })
  })

  describe("toModelOutput", () => {
    it("handles empty results with friendly message", () => {
      const output = toModelOutput([])
      expect(output).toBe("No semantically relevant code snippets found.")
    })

    it("formats semantic matches with similarity percentage and code blocks", () => {
      const matches = [
        {
          path: "src/semantic/embedder.ts",
          startLine: 1,
          endLine: 25,
          score: 0.884,
          snippet: "export const cosineSimilarity = ...",
        },
      ]
      const output = toModelOutput(matches)
      expect(output).toContain("Found 1 semantically relevant code snippet(s):")
      expect(output).toContain("📄 src/semantic/embedder.ts:1-25 [Similarity: 88%]")
      expect(output).toContain("export const cosineSimilarity = ...")
    })

    it("formats keyword fallback matches with explicit notice", () => {
      const matches = [
        {
          path: "src/grep.ts",
          startLine: 42,
          endLine: 42,
          score: 0.5,
          snippet: "const grep = ...",
          fallback: true,
        },
      ]
      const output = toModelOutput(matches)
      expect(output).toContain("Local Ollama embedder offline; keyword fallback used")
      expect(output).toContain("src/grep.ts:42-42")
    })
  })

  describe("Constants and Tool Registration", () => {
    it("exports expected tool parameters and limits", () => {
      expect(name).toBe("semantic_search")
      expect(DEFAULT_LIMIT).toBe(5)
      expect(MAX_LIMIT).toBe(20)
    })
  })

  describe("SemanticEmbedder Service", () => {
    it("detects local Ollama endpoint availability", async () => {
      const program = Effect.gen(function* () {
        const embedder = yield* SemanticEmbedder.Service
        return yield* embedder.isAvailable()
      }).pipe(Effect.provide(SemanticEmbedder.layer))

      const isUp = await Effect.runPromise(program)
      expect(typeof isUp).toBe("boolean")
    })

    it("computes real embedding if Ollama is up", async () => {
      const program = Effect.gen(function* () {
        const embedder = yield* SemanticEmbedder.Service
        const isUp = yield* embedder.isAvailable()
        if (!isUp) return null
        const vec = yield* embedder.embedOne("semantic code search test")
        return vec
      }).pipe(Effect.provide(SemanticEmbedder.layer))

      const vec = await Effect.runPromise(program)
      if (vec !== null) {
        expect(Array.isArray(vec)).toBe(true)
        expect(vec.length).toBe(768) // nomic-embed-text dimensions
      }
    })
  })
})
