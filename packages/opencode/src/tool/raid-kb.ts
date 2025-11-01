import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./raid-kb.txt"
import { Log } from "../util/log"
import { loadRaidConfig, validateRaidConfig } from "../raid/raid-config"
import { RaidKnowledgeBase } from "../raid/raid-kb"

const log = Log.create({ service: "raid-kb-tool" })

export const RaidKbTool = Tool.define("raid-kb", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["stats", "list", "get", "delete", "clear"]).describe("Action to perform"),
    documentId: z
      .string()
      .describe("Document ID (required for 'get' and 'delete' actions)")
      .optional(),
    source: z
      .enum(["project", "global"])
      .describe("Source filter for 'list' and 'clear' actions")
      .optional(),
    limit: z.number().describe("Limit for 'list' action").optional().default(20),
    offset: z.number().describe("Offset for 'list' action").optional().default(0),
  }),
  async execute(params, ctx) {
    const { action, documentId, source, limit, offset } = params
    try {
      // Load and validate config
      const config = loadRaidConfig()
      const validation = validateRaidConfig(config)

      if (!validation.valid) {
        return {
          title: "Config Error",
          metadata: {},
          output: `RAID configuration error:\n${validation.errors.join("\n")}`,
        }
      }

      // Initialize KB
      const kb = new RaidKnowledgeBase(config)

      let result: string

      switch (action) {
        case "stats": {
          const stats = kb.getStats()
          result = `Knowledge Base Statistics:

Total Documents: ${stats.totalDocuments}
- Project: ${stats.projectDocuments}
- Global: ${stats.globalDocuments}

Total Tokens: ${stats.totalTokens.toLocaleString()}
Average Tokens/Doc: ${stats.avgTokensPerDocument}

Top Keywords:
${stats.topKeywords
  .slice(0, 10)
  .map((k, i) => `${i + 1}. ${k.keyword} (${k.count})`)
  .join("\n")}

Last Updated: ${stats.lastUpdated.toLocaleString()}`
          break
        }

        case "list": {
          const docs = kb.listDocuments({ source, limit, offset })

          if (docs.length === 0) {
            result = `No documents found${source ? ` in ${source} knowledge base` : ""}`
          } else {
            result =
              `Documents${source ? ` (${source})` : ""} (${offset + 1}-${offset + docs.length}):\n\n` +
              docs
                .map(
                  (doc, idx) => `${offset + idx + 1}. ${doc.title}
   ID: ${doc.id}
   Source: ${doc.source}
   Type: ${doc.metadata.contentType}
   Tokens: ${doc.tokenCount}
   Shards: ${doc.shardIds.length}
   Tags: ${doc.tags.join(", ") || "none"}
   Created: ${doc.createdAt.toLocaleString()}
   Updated: ${doc.updatedAt.toLocaleString()}
   ${doc.filePath ? `File: ${doc.filePath}` : ""}
   Summary: ${doc.metadata.summary}`,
                )
                .join("\n\n")
          }
          break
        }

        case "get": {
          if (!documentId) {
            result = "Error: documentId is required for 'get' action"
            break
          }

          const doc = kb.getDocument(documentId)

          if (!doc) {
            result = `Document not found: ${documentId}`
          } else {
            result = `Document: ${doc.title}

ID: ${doc.id}
Source: ${doc.source}
Content Type: ${doc.metadata.contentType}
File Path: ${doc.filePath ?? "none"}

Metadata:
- Created: ${doc.createdAt.toLocaleString()}
- Updated: ${doc.updatedAt.toLocaleString()}
- Tokens: ${doc.tokenCount}
- Shards: ${doc.shardIds.length}
- Tags: ${doc.tags.join(", ") || "none"}
- Keywords: ${doc.keywords.join(", ") || "none"}

Summary:
${doc.metadata.summary}

Content:
${doc.content}`
          }
          break
        }

        case "delete": {
          if (!documentId) {
            result = "Error: documentId is required for 'delete' action"
            break
          }

          const deleted = kb.deleteDocument(documentId)
          result = deleted
            ? `Successfully deleted document: ${documentId}`
            : `Document not found: ${documentId}`
          break
        }

        case "clear": {
          const count = kb.deleteAllDocuments(source)
          result = `Deleted ${count} document(s)${source ? ` from ${source} knowledge base` : ""}`
          break
        }

        default:
          result = `Unknown action: ${action}`
      }

      kb.close()

      return {
        title: `KB: ${action}`,
        metadata: {},
        output: result,
      }
    } catch (error) {
      log.error("Failed to manage knowledge base", { error })
      return {
        title: "Error",
        metadata: {},
        output: `Error managing knowledge base: ${error}`,
      }
    }
  },
})
