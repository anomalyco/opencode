import { describe, it, expect, beforeAll } from "bun:test"
import { Knowledge } from "./index"
import { KnowledgeHealth } from "./health"
import { Database } from "../storage/db"

describe("Knowledge", () => {
  beforeAll(async () => {
    await KnowledgeHealth.init()
  })

  it("writes a pattern entry", async () => {
    const id = await Knowledge.writePattern({
      agent: "test",
      title: "Test Pattern",
      description: "A test pattern",
      context: { error: "ECONNREFUSED" },
      tags: ["recovery", "network"],
      confidence: 0.95,
      firstAttemptFailed: true,
      attempts: 3,
    })

    expect(id).toBeTruthy()
    expect(id.length).toBeGreaterThan(0)
  })

  it("writes a knowledge entry", async () => {
    const id = await Knowledge.writeKnowledge({
      agent: "test",
      title: "Test Knowledge",
      description: "A test knowledge entry",
      category: "architecture",
      impact: "high",
      tags: ["architecture"],
      decisionRationale: "For better structure",
    })

    expect(id).toBeTruthy()
  })

  it("writes a log entry", async () => {
    const id = await Knowledge.writeLog({
      agent: "test",
      build: { what: "Feature X", how: "Native tool", where: "src/tool/" },
      changes: { filesAdded: 3, linesAdded: 200 },
      tags: ["feature", "release"],
    })

    expect(id).toBeTruthy()
  })

  it("searches entries", async () => {
    // Write test data first
    await Knowledge.writePattern({
      agent: "test",
      title: "Network Retry Pattern",
      description: "Handles network failures",
      context: {},
      tags: ["recovery", "network"],
      confidence: 0.9,
      firstAttemptFailed: true,
      attempts: 2,
    })

    // Search
    const results = await Knowledge.search({
      query: "network",
      limit: 5,
    })

    expect(results.length).toBeGreaterThan(0)
  })
})
