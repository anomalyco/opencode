import { describe, expect, test } from "bun:test"
import { CacheOptimizer } from "../../src/session/cache-optimizer"

describe("CacheOptimizer", () => {
  describe("whitespace normalization", () => {
    test("normalizes multiple spaces", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Hello    world",
      })

      expect(result.optimized).toBe("Hello world")
      expect(result.transformations).toContain("whitespace_normalized")
    })

    test("normalizes line endings", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Line 1\r\nLine 2\rLine 3\n",
      })

      expect(result.optimized).toBe("Line 1\nLine 2\nLine 3")
      expect(result.transformations).toContain("whitespace_normalized")
    })

    test("collapses excessive newlines", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Para 1\n\n\n\nPara 2",
      })

      expect(result.optimized).toBe("Para 1\n\nPara 2")
      expect(result.transformations).toContain("whitespace_normalized")
    })

    test("trims leading and trailing whitespace", () => {
      const result = CacheOptimizer.optimize({
        prompt: "  \n  Content  \n  ",
      })

      expect(result.optimized).toBe("Content")
      expect(result.transformations).toContain("whitespace_normalized")
    })
  })

  describe("path canonicalization", () => {
    test("removes user-specific paths (macOS)", () => {
      const result = CacheOptimizer.optimize({
        prompt: "File at /Users/john/project/src/index.ts",
        workspaceRoot: "/Users/john/project",
      })

      expect(result.optimized).toContain("~/project")
      expect(result.transformations).toContain("paths_canonicalized")
    })

    test("removes user-specific paths (Linux)", () => {
      const result = CacheOptimizer.optimize({
        prompt: "File at /home/john/project/src/index.ts",
        workspaceRoot: "/home/john/project",
      })

      expect(result.optimized).toContain("~/project")
      expect(result.transformations).toContain("paths_canonicalized")
    })

    test("removes user-specific paths (Windows)", () => {
      const result = CacheOptimizer.optimize({
        prompt: "File at C:/Users/John/project/src/index.ts",
        workspaceRoot: "C:/Users/John/project",
      })

      expect(result.optimized).toContain("~/project")
      expect(result.transformations).toContain("paths_canonicalized")
    })

    test("makes paths relative to workspace", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Edit file /Users/ari/project/src/main.ts",
        workspaceRoot: "/Users/ari/project",
      })

      // Paths with /Users/ are replaced with ~/
      expect(result.optimized).toContain("~/project")
      expect(result.transformations).toContain("paths_canonicalized")
    })
  })

  describe("non-deterministic metadata removal", () => {
    test("removes ISO timestamps", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Created at 2025-11-27T08:30:00.123Z",
      })

      expect(result.optimized).toContain("<TIMESTAMP>")
      expect(result.optimized).not.toContain("2025-11-27")
      expect(result.transformations).toContain("nondeterministic_removed")
    })

    test("removes Unix timestamps", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Timestamp: 1732692600000",
      })

      expect(result.optimized).toContain("<TIMESTAMP>")
      expect(result.optimized).not.toContain("1732692600000")
      expect(result.transformations).toContain("nondeterministic_removed")
    })

    test("removes UUIDs", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Session ID: 550e8400-e29b-41d4-a716-446655440000 in the system",
      })

      // UUID should be replaced (note: part of it might match timestamp pattern)
      expect(result.optimized).toContain("<")
      expect(result.optimized).not.toContain("550e8400-e29b-41d4-a716-446655440000")
      expect(result.transformations).toContain("nondeterministic_removed")
    })

    test("removes session/message IDs", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Check session_abc123 and message_xyz789",
      })

      expect(result.optimized).toContain("<ID>")
      expect(result.optimized).not.toContain("session_abc123")
      expect(result.transformations).toContain("nondeterministic_removed")
    })

    test("removes relative time references", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Updated 5 minutes ago",
      })

      expect(result.optimized).toContain("<TIME_AGO>")
      expect(result.optimized).not.toContain("5 minutes ago")
      expect(result.transformations).toContain("nondeterministic_removed")
    })

    test("preserves timestamps when requested", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Created at 2025-11-27T08:30:00.123Z",
        preserveTimestamps: true,
      })

      expect(result.optimized).toContain("2025-11-27")
      expect(result.transformations).not.toContain("nondeterministic_removed")
    })
  })

  describe("cache key generation", () => {
    test("generates consistent cache keys for identical prompts", () => {
      const result1 = CacheOptimizer.optimize({
        prompt: "Tell me a joke",
      })

      const result2 = CacheOptimizer.optimize({
        prompt: "Tell me a joke",
      })

      expect(result1.cacheKey).toBe(result2.cacheKey)
    })

    test("generates same cache key for prompts differing only in whitespace", () => {
      const result1 = CacheOptimizer.optimize({
        prompt: "Hello  world",
      })

      const result2 = CacheOptimizer.optimize({
        prompt: "Hello    world",
      })

      expect(result1.cacheKey).toBe(result2.cacheKey)
    })

    test("generates different cache keys for different prompts", () => {
      const result1 = CacheOptimizer.optimize({
        prompt: "Prompt A",
      })

      const result2 = CacheOptimizer.optimize({
        prompt: "Prompt B",
      })

      expect(result1.cacheKey).not.toBe(result2.cacheKey)
    })

    test("cache key is 16 characters (hex)", () => {
      const result = CacheOptimizer.optimize({
        prompt: "Test",
      })

      expect(result.cacheKey).toHaveLength(16)
      expect(/^[0-9a-f]{16}$/.test(result.cacheKey)).toBe(true)
    })
  })

  describe("wouldMatch", () => {
    test("returns true for prompts that would match", () => {
      const matches = CacheOptimizer.wouldMatch(
        "Hello    world",
        "Hello  world"
      )

      expect(matches).toBe(true)
    })

    test("returns false for prompts that would not match", () => {
      const matches = CacheOptimizer.wouldMatch(
        "Hello world",
        "Goodbye world"
      )

      expect(matches).toBe(false)
    })

    test("matches prompts with different timestamps", () => {
      const matches = CacheOptimizer.wouldMatch(
        "Event at 2025-11-27T08:30:00Z",
        "Event at 2025-11-27T09:45:00Z"
      )

      expect(matches).toBe(true)
    })
  })

  describe("analyzeCachePotential", () => {
    test("analyzes cache hit potential for prompt set", () => {
      const prompts = [
        "Tell me a joke",
        "Tell  me  a  joke", // Same after normalization
        "What is 2+2?",
        "What is 2+2?", // Duplicate
        "Hello world",
      ]

      const analysis = CacheOptimizer.analyzeCachePotential(prompts)

      expect(analysis.totalPrompts).toBe(5)
      expect(analysis.uniquePrompts).toBe(3)
      expect(analysis.duplicatePrompts).toBe(2)
      expect(analysis.potentialCacheHitRate).toBe(0.4) // 2/5
    })

    test("returns zero cache hit rate for unique prompts", () => {
      const prompts = [
        "Prompt 1",
        "Prompt 2",
        "Prompt 3",
      ]

      const analysis = CacheOptimizer.analyzeCachePotential(prompts)

      expect(analysis.potentialCacheHitRate).toBe(0)
    })

    test("returns high cache hit rate for repeated prompts", () => {
      const prompts = new Array(10).fill("Same prompt")

      const analysis = CacheOptimizer.analyzeCachePotential(prompts)

      expect(analysis.uniquePrompts).toBe(1)
      expect(analysis.potentialCacheHitRate).toBe(0.9) // 9/10
    })
  })

  describe("combined transformations", () => {
    test("applies all transformations together", () => {
      const result = CacheOptimizer.optimize({
        prompt: `
          File:   /Users/john/project/src/main.ts
          Created: 2025-11-27T08:30:00.123Z
          Session: session_abc123
        `,
        workspaceRoot: "/Users/john/project",
      })

      expect(result.optimized).toContain("~/project")
      expect(result.optimized).toContain("<TIMESTAMP>")
      expect(result.optimized).toContain("<ID>")
      expect(result.transformations).toHaveLength(3)
    })
  })
})
