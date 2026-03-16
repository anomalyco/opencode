# Task 3: Knowledge Search Tool

**Files:**

- Create: `src/tool/knowledge_search.ts`
- Modify: `src/tool/registry.ts` (add import)

**Goal:** Implement native `knowledge_search` tool following OpenCode tool pattern.

---

## Step 1: Create Knowledge Search Tool

Create `src/tool/knowledge_search.ts`:

```typescript
import z from "zod"
import { Tool } from "./tool"
import { Knowledge } from "../knowledge"
import { KnowledgeHealth } from "../knowledge/health"

export const KnowledgeSearchTool = Tool.define("knowledge_search", {
  description: [
    "Search the collective knowledge base for patterns, insights, and deployment history.",
    "",
    "Returns results grouped by type (Patterns / Knowledge / Logs) with semantic matching and confidence scores.",
    "Patterns capture proven recovery actions from failures. Knowledge entries preserve architectural decisions and big changes.",
    "Logs track what was built, how, and where. All entries are semantically tagged for discovery.",
  ].join("\n"),

  parameters: z.object({
    query: z.string().describe("What to search for (e.g., 'network retry', 'database optimization', 'auth flow')"),
    type: z.enum(["pattern", "knowledge", "log", "all"]).default("all").describe("Filter by entry type"),
    limit: z.number().int().min(1).max(20).default(5).describe("Maximum results to return (1-20)"),
    min_confidence: z.number().min(0).max(1).default(0.6).describe("Minimum confidence threshold (0-1)"),
  }),

  execute: async (params, ctx) => {
    // Check system health
    if (!KnowledgeHealth.isHealthy()) {
      const status = KnowledgeHealth.getStatus()
      return {
        title: "Knowledge Search Unavailable",
        output: [
          "## Knowledge System Offline",
          "",
          `**Status:** ${status.error || "Database unavailable"}`,
          "",
          "Knowledge search is temporarily unavailable. The system will continue functioning normally.",
        ].join("\n"),
        metadata: {
          error: status.error,
          resultCount: 0,
        },
      }
    }

    // Execute search
    const results = await Knowledge.search({
      query: params.query,
      type: params.type,
      limit: params.limit,
      minConfidence: params.min_confidence,
    })

    // Format results as markdown
    const markdown = formatResults(results, params.query)

    return {
      title: `Knowledge Search: "${params.query}"`,
      output: markdown,
      metadata: {
        resultCount: results.length,
        query: params.query,
        types: groupByType(results),
      },
    }
  },
})

function formatResults(results: any[], query: string): string {
  if (results.length === 0) {
    return [
      "## Knowledge Search Results",
      "",
      `**Query:** "${query}"`,
      "",
      "No matching entries found in the knowledge base.",
    ].join("\n")
  }

  const byType = groupByType(results)

  const sections: string[] = [
    "## Knowledge Search Results",
    "",
    `**Query:** "${query}"`,
    `**Total Results:** ${results.length}`,
    "",
  ]

  // Patterns section
  if (byType.pattern && byType.pattern.length > 0) {
    sections.push("### Patterns (Recovery & Proven Solutions)")
    sections.push("")
    for (const result of byType.pattern) {
      sections.push(formatEntry(result))
    }
    sections.push("")
  }

  // Knowledge section
  if (byType.knowledge && byType.knowledge.length > 0) {
    sections.push("### Knowledge (Architectural Decisions)")
    sections.push("")
    for (const result of byType.knowledge) {
      sections.push(formatEntry(result))
    }
    sections.push("")
  }

  // Logs section
  if (byType.log && byType.log.length > 0) {
    sections.push("### Logs (Deployment & Build History)")
    sections.push("")
    for (const result of byType.log) {
      sections.push(formatEntry(result))
    }
    sections.push("")
  }

  sections.push("---")
  sections.push("**Note:** Results are ranked by semantic match and tag relevance.")
  sections.push("Use these insights to inform your decisions, but apply your own judgment to your specific context.")

  return sections.join("\n")
}

function formatEntry(result: any): string {
  const lines: string[] = []

  // Title with scores
  const scores = formatScores(result.semanticScore, result.tagRelevance, result.confidenceScore)
  lines.push(`- **${result.title}** ${scores}`)

  // Description
  lines.push(`  ${result.description}`)

  // Tags
  if (result.tags && result.tags.length > 0) {
    const tags = result.tags.map((t: string) => `\`${t}\``).join(", ")
    lines.push(`  **Tags:** ${tags}`)
  }

  // Category if present
  if (result.category) {
    lines.push(`  **Category:** ${result.category}`)
  }

  lines.push("")

  return lines.join("\n")
}

function formatScores(semantic: number, tagRelevance: number, confidence: number): string {
  const pct = (n: number) => Math.round(n * 100)
  return `[Match: ${pct(semantic)}% | Relevance: ${tagRelevance.toFixed(1)}x | Confidence: ${pct(confidence)}%]`
}

function groupByType(results: any[]): Record<string, any[]> {
  return {
    pattern: results.filter((r) => r.type === "pattern"),
    knowledge: results.filter((r) => r.type === "knowledge"),
    log: results.filter((r) => r.type === "log"),
  }
}
```

---

## Step 2: Register Tool

Modify `src/tool/registry.ts` to add import at the top:

```typescript
import { KnowledgeSearchTool } from "./knowledge_search" // ADD THIS
```

Then in the `all()` function, add to the builtin tools list. Find the section that builds the tools array and add:

```typescript
// After other builtin tools like SkillTool, ReadTool, etc.
tools.push(await KnowledgeSearchTool.init(initCtx))
```

The registry will automatically pick up the tool and include it in the available tools list.

---

## Step 3: Test Tool Output Format

Create `src/tool/knowledge_search.test.ts`:

```typescript
import { describe, it, expect } from "bun:test"
import { KnowledgeSearchTool } from "./knowledge_search"
import { Knowledge } from "../knowledge"

describe("KnowledgeSearchTool", () => {
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
        sessionID: "test",
        messageID: "test",
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
        sessionID: "test",
        messageID: "test",
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
```

Run tests:

```bash
cd packages/opencode
bun test src/tool/knowledge_search.test.ts
```

Expected: All tests pass, markdown output is clean and readable.

---

## Step 4: Verify Tool Registration

Check that the tool appears in the tool list:

```bash
cd packages/opencode
bun run --eval "
import { ToolRegistry } from './src/tool/registry'
const tools = await ToolRegistry.all()
const kst = tools.find(t => t.id === 'knowledge_search')
console.log('Found:', kst?.id)
console.log('Description:', kst?.init().then(t => t.description).catch(e => e.message))
"
```

Expected output: Tool is registered and description is visible.

---

## Step 5: Commit

```bash
git add src/tool/knowledge_search.ts
git add src/tool/registry.ts
git add src/tool/knowledge_search.test.ts
git commit -m "feat: add knowledge_search native tool"
```

---

## Acceptance Criteria

✅ Tool defined using `Tool.define()` pattern  
✅ Parameters validated with Zod  
✅ Markdown output formatted with sections (Patterns / Knowledge / Logs)  
✅ Scores displayed for each result  
✅ Tool registered in ToolRegistry  
✅ Tool appears in available tools list  
✅ Empty results handled gracefully  
✅ All tests passing  
✅ No console writes
