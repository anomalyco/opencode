import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./kb-ingest.txt"
import { Log } from "../util/log"
import { loadRaidConfig, validateRaidConfig } from "../raid/raid-config"
import { RaidKnowledgeBase } from "../raid/raid-kb"
import { RaidOrchestrator } from "../raid/raid-orchestrator"
import { readFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import { ulid } from "ulid"

const log = Log.create({ service: "kb-ingest-tool" })

export const KbIngestTool = Tool.define("kb-ingest", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("Path to the file or directory to ingest"),
    source: z
      .enum(["project", "global"])
      .describe("Whether this is a project-specific or global document")
      .default("project"),
    title: z.string().describe("Optional title for the document (defaults to filename)").optional(),
    tags: z.array(z.string()).describe("Optional tags for categorization").optional().default([]),
    generateSummary: z
      .boolean()
      .describe("Generate AI summary and extract keywords")
      .optional()
      .default(true),
  }),
  async execute(params, ctx) {
    const { filePath, source, title, tags, generateSummary } = params
    try {
      // Load and validate config
      const config = loadRaidConfig()
      const validation = validateRaidConfig(config)

      if (!validation.valid) {
        return {
          title: "Config Error",
          metadata: {},
          output: `KB configuration error:\n${validation.errors.join("\n")}`,
        }
      }

      // Initialize KB and orchestrator
      const kb = new RaidKnowledgeBase(config)
      const orchestrator = new RaidOrchestrator(config, kb)

      // Read file
      const content = await readFile(filePath, "utf-8")

      if (!content.trim()) {
        kb.close()
        return {
          title: "Error",
          metadata: {},
          output: `Error: File ${filePath} is empty`,
        }
      }

      // Generate document ID and title
      const docId = ulid()
      const docTitle = title ?? basename(filePath, extname(filePath))

      // Generate metadata if requested
      let summary = ""
      let keywords: string[] = []

      if (generateSummary) {
        ctx.metadata?.({
          title: "Generating AI metadata",
        })

        try {
          ;[summary, keywords] = await Promise.all([
            orchestrator.generateSummary(content),
            orchestrator.extractKeywords(content),
          ])
        } catch (error) {
          log.warn("Failed to generate AI metadata", { error })
        }
      }

      ctx.metadata?.({
        title: "Ingesting document",
      })

      // Ingest document
      const document = await kb.upsertDocument({
        id: docId,
        title: docTitle,
        content,
        filePath,
        tags: tags ?? [],
        keywords,
        source,
        metadata: {
          contentType: "text",
          extractedKeywords: keywords,
          summary,
        },
      })

      // Shard document
      ctx.metadata?.({
        title: "Creating shards",
      })

      const shardIds = await orchestrator.ingestDocument(docId, content)

      kb.close()

      return {
        title: "Document ingested",
        metadata: {},
        output: `Successfully ingested document:
- ID: ${docId}
- Title: ${docTitle}
- Source: ${source}
- Tokens: ${document.tokenCount}
- Shards: ${shardIds.length}
- Tags: ${tags?.join(", ") || "none"}
- Keywords: ${keywords.slice(0, 5).join(", ")}${keywords.length > 5 ? "..." : ""}
${summary ? `- Summary: ${summary}` : ""}`,
      }
    } catch (error) {
      log.error("Failed to ingest document", { error })
      return {
        title: "Error",
        metadata: {},
        output: `Error ingesting document: ${error}`,
      }
    }
  },
})
