import { describe, it, expect, beforeAll } from "bun:test"
import { KnowledgeSearchTool } from "./knowledge_search"
import { Knowledge } from "../knowledge"
import { KnowledgeHealth } from "../knowledge/health"
import { SessionID, MessageID } from "../session/schema"

describe("KnowledgeSearchTool", () => {
  beforeAll(async () => {
    await KnowledgeHealth.init()
  })
  it("initializes with correct parameters", async () => {
    const tool = await KnowledgeSearchTool.init()

    expect(tool.description).toContain("knowledge base")
    expect(tool.parameters).toBeDefined()
  })

  it("formats markdown output correctly", async () => {
    // Write test data
    await Knowledge.writePattern({
      agent: "test",
      title: "Connection Timeout Retry",
      description: "Exponential backoff for connection timeouts",
      context: { error: "ETIMEDOUT" },
      tags: ["recovery", "network"],
      confidence: 0.9,
      firstAttemptFailed: true,
      attempts: 3,
    })

    // Search
    const tool = await KnowledgeSearchTool.init()
    const result = await tool.execute(
      {
        query: "connection timeout",
        type: "all",
        limit: 5,
        min_confidence: 0.5,
      },
      {
        sessionID: SessionID.make("test"),
        messageID: MessageID.make("test"),
        agent: "test",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: async () => {},
      },
    )

    expect(result.output).toContain("Knowledge Search Results")
    expect(result.output).toContain("Patterns")
    expect(result.output).toContain("Connection Timeout Retry")
    expect(result.metadata.resultCount).toBeGreaterThan(0)
  })

  it("handles empty results gracefully", async () => {
    const tool = await KnowledgeSearchTool.init()
    const result = await tool.execute(
      {
        query: "nonexistent_query_xyz_12345",
        type: "all",
        limit: 5,
        min_confidence: 0.5,
      },
      {
        sessionID: SessionID.make("test"),
        messageID: MessageID.make("test"),
        agent: "test",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: async () => {},
      },
    )

    expect(result.output).toContain("No matching entries")
    expect(result.metadata.resultCount).toBe(0)
  })
})
