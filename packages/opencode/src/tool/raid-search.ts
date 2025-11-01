import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./raid-search.txt"
import { Log } from "../util/log"
import { loadRaidConfig, validateRaidConfig } from "../raid/raid-config"
import { RaidKnowledgeBase } from "../raid/raid-kb"

const log = Log.create({ service: "raid-search-tool" })

export const RaidSearchTool = Tool.define("raid-search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Search query using FTS syntax"),
    maxResults: z.number().describe("Maximum number of results to return").optional().default(10),
    source: z
      .enum(["project", "global", "both"])
      .describe("Filter by source")
      .optional()
      .default("both"),
    tags: z.array(z.string()).describe("Filter by tags").optional(),
    contentType: z
      .array(z.enum(["markdown", "code", "text", "other"]))
      .describe("Filter by content type")
      .optional(),
    includeContent: z
      .boolean()
      .describe("Include full content in results")
      .optional()
      .default(false),
  }),
  async execute(params, ctx) {
    const { query, maxResults, source, tags, contentType, includeContent } = params
    try {
      // Load and validate config
      const config = loadRaidConfig()
      const validation = validateRaidConfig(config)

      if (!validation.valid) {
        return {
          title: "Config Error",
          metadata: { count: 0 },
          output: `RAID configuration error:\n${validation.errors.join("\n")}`,
        }
      }

      // Initialize KB
      const kb = new RaidKnowledgeBase(config)

      // Search
      const results = kb.search(query, {
        maxResults,
        includeContent,
        sourceFilter: source,
        tagsFilter: tags,
        contentTypeFilter: contentType,
      })

      kb.close()

      if (results.length === 0) {
        return {
          title: "No Results",
          metadata: { count: 0 },
          output: `No results found for query: "${query}"`,
        }
      }

      // Format results
      const formatted = results
        .map((result, idx) => {
          const doc = result.document
          return `${idx + 1}. ${doc.title} (${doc.source})
   ID: ${doc.id}
   Score: ${result.relevanceScore.toFixed(3)}
   Tokens: ${doc.tokenCount}
   Tags: ${doc.tags.join(", ") || "none"}
   Keywords: ${doc.keywords.slice(0, 5).join(", ")}${doc.keywords.length > 5 ? "..." : ""}
   Summary: ${doc.metadata.summary}
   ${result.snippets.length > 0 ? `Preview: ${result.snippets[0]}` : ""}
   ${doc.filePath ? `File: ${doc.filePath}` : ""}
${includeContent ? `\nContent:\n${doc.content}\n` : ""}`
        })
        .join("\n\n")

      return {
        title: `Search: ${query}`,
        metadata: { count: results.length },
        output: `Found ${results.length} result(s) for "${query}":\n\n${formatted}`,
      }
    } catch (error) {
      log.error("Failed to search documents", { error })
      return {
        title: "Error",
        metadata: { count: 0 },
        output: `Error searching documents: ${error}`,
      }
    }
  },
})
