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
          resultCount: 0,
          query: params.query,
          types: {},
          error: status.error,
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
        error: undefined,
      },
    }
  },
})

function formatResults(results: Knowledge.SearchResult[], query: string): string {
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

function formatEntry(result: Knowledge.SearchResult): string {
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

function groupByType(results: Knowledge.SearchResult[]): Record<string, Knowledge.SearchResult[]> {
  return {
    pattern: results.filter((r) => r.type === "pattern"),
    knowledge: results.filter((r) => r.type === "knowledge"),
    log: results.filter((r) => r.type === "log"),
  }
}
