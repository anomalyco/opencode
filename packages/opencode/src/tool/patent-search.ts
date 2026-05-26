import { Effect, Schema } from "effect"
import * as PatentSearch from "@/patent/search"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "The search query (keyword)" }),
  field: Schema.optional(Schema.String).annotate({ description: "Optional field to search in" }),
  ipc: Schema.optional(Schema.String).annotate({ description: "Optional IPC classification code" }),
  applicant: Schema.optional(Schema.String).annotate({ description: "Optional applicant name" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Maximum number of results (default: 10)" }),
})

type SearchMetadata = {
  count: number
  configured: boolean
}

export const PatentSearchTool = Tool.define(
  "patent_search",
  Effect.gen(function* () {
    const searchService = yield* PatentSearch.Service

    return {
      description: "专利检索。在专利库中检索相关专利。需配置检索后端，未配置时提示手动检索。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const available = yield* searchService.isAvailable()
          if (!available) {
            const metadata: SearchMetadata = { configured: false, count: 0 }
            return {
              title: "专利检索不可用",
              output: "专利检索后端未配置。请在 opencode.json 中配置 patent.search.backend。",
              metadata,
            }
          }

          const results = yield* searchService.search({
            keyword: params.query,
            ipc: params.ipc,
            applicant: params.applicant,
            limit: params.limit ?? 10,
          })

          if (results.length === 0) {
            const metadata: SearchMetadata = { count: 0, configured: true }
            return {
              title: `专利检索: ${params.query}`,
              output: "未找到匹配的专利",
              metadata,
            }
          }

          const output = results
            .map(
              (patent: any) =>
                `## ${patent.patentId}: ${patent.title}\n\n` +
                `**申请人**: ${patent.applicant}\n` +
                `**IPC**: ${patent.ipc}\n\n` +
                `**摘要**: ${patent.abstract.slice(0, 200)}...\n`,
            )
            .join("\n---\n\n")

          const metadata: SearchMetadata = { count: results.length, configured: true }
          return {
            title: `专利检索: ${params.query}`,
            output,
            metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)