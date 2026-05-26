import { Effect, Schema } from "effect"
import { Trademark } from "@/patent/trademark"
import * as Tool from "./tool"

const SearchParams = Schema.Struct({
  action: Schema.Literal("search"),
  markName: Schema.optional(Schema.String).annotate({ description: "Trademark name to search" }),
  niceClass: Schema.optional(Schema.Number).annotate({ description: "Nice Classification number (1-45)" }),
  applicant: Schema.optional(Schema.String).annotate({ description: "Applicant name" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max results (default: 10)" }),
})

const SimilarityParams = Schema.Struct({
  action: Schema.Literal("similarity"),
  target: Schema.String.annotate({ description: "Target trademark to compare" }),
  reference: Schema.String.annotate({ description: "Reference trademark to compare against" }),
})

const DistinctivenessParams = Schema.Struct({
  action: Schema.Literal("distinctiveness"),
  markName: Schema.String.annotate({ description: "Trademark name to evaluate" }),
  goodsServices: Schema.String.annotate({ description: "Goods or services description" }),
})

export const Parameters = Schema.Union([SearchParams, SimilarityParams, DistinctivenessParams])

export const TrademarkTool = Tool.define(
  "trademark",
  Effect.gen(function* () {
    const trademarkService = yield* Trademark.Service

    return {
      description: "商标检索与分析。支持近似检索、显著性评估、混淆可能性分析。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "search") {
            const results = yield* trademarkService.search({
              markName: params.markName,
              niceClass: params.niceClass,
              applicant: params.applicant,
              limit: params.limit ?? 10,
            })

            if (results.length === 0) {
              return {
                title: "商标检索: 未找到结果",
                output: "未找到匹配的商标记录。请检查检索条件或确认商标数据库已配置。",
                metadata: { count: 0 },
              }
            }

            const output = results
              .map((r) => `## ${r.markName}\n- **申请人**: ${r.applicant}\n- **状态**: ${r.status}\n- **类别**: 第${r.niceClass}类\n- **商品/服务**: ${r.goodsServices}`)
              .join("\n\n---\n\n")

            return {
              title: `商标检索: 找到 ${results.length} 条记录`,
              output,
              metadata: { count: results.length },
            }
          }

          if (params.action === "similarity") {
            const analysis = yield* trademarkService.analyzeSimilarity(params.target, params.reference)
            const output = [
              "## 商标近似分析",
              "",
              `**目标商标**: ${params.target}`,
              `**对比商标**: ${params.reference}`,
              `**相似度**: ${(analysis.similarityScore * 100).toFixed(0)}%`,
              `**混淆风险**: ${analysis.confusionRisk}`,
              `**显著性评价**: ${analysis.distinctiveness}`,
              "",
              "### 分析理由",
              ...analysis.reasons.map((r) => `- ${r}`),
            ].join("\n")

            return {
              title: `近似分析: ${params.target} vs ${params.reference}`,
              output,
              metadata: { similarityScore: analysis.similarityScore, confusionRisk: analysis.confusionRisk },
            }
          }

          if (params.action === "distinctiveness") {
            const analysis = yield* trademarkService.analyzeDistinctiveness(params.markName, params.goodsServices)
            const output = [
              "## 商标显著性评估",
              "",
              `**商标**: ${params.markName}`,
              `**商品/服务**: ${params.goodsServices}`,
              `**显著性**: ${analysis.distinctiveness}`,
              "",
              "### 分析理由",
              ...analysis.reasons.map((r) => `- ${r}`),
            ].join("\n")

            return {
              title: `显著性评估: ${params.markName}`,
              output,
              metadata: { distinctiveness: analysis.distinctiveness },
            }
          }

          return { title: "Unknown action", output: "Invalid action", metadata: {} }
        }).pipe(Effect.orDie),
    } as any
  }),
)
