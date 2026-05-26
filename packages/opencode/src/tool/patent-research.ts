import { Effect, Schema } from "effect"
import { PatentKG } from "@/patent/kg"
import * as PatentLaw from "@/patent/law"
import * as PatentKnowledge from "@/patent/knowledge"
import * as PatentIPC from "@/patent/ipc"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  topic: Schema.String.annotate({ description: "The research topic or question" }),
  scope: Schema
    .optional(
      Schema.Union([
        Schema.Literal("法规"),
        Schema.Literal("案例"),
        Schema.Literal("实务"),
        Schema.Literal("知识库"),
        Schema.Literal("ipc"),
        Schema.Literal("全部"),
      ]),
    )
    .annotate({ description: "Research scope: 法规/案例/实务/知识库/ipc/全部" }),
  depth: Schema
    .optional(Schema.Union([Schema.Literal("概述"), Schema.Literal("详细"), Schema.Literal("深度")]))
    .annotate({ description: "Research depth: 概述/详细/深度" }),
})

export const PatentResearchTool = Tool.define(
  "patent_research",
  Effect.gen(function* () {
    const kgService = yield* PatentKG.Service
    const lawService = yield* PatentLaw.Service
    const knowledgeService = yield* PatentKnowledge.Service
    const ipcService = yield* PatentIPC.Service

    return {
      description: "研究专利法规与实务规则。并行查询法规库、案例库、知识库，LLM综合输出结构化研究报告。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const results: string[] = []
          const { topic, scope, depth } = params

          if (!scope || scope === "全部" || scope === "知识库") {
            results.push("## 知识图谱搜索")
            const kgResults = yield* kgService.fullTextSearch(topic)
            if (kgResults.length > 0) {
              results.push(
                ...kgResults.map((node) => `- ${node.name}: ${node.title ?? node.content ?? "无描述"}`).slice(0, 10),
              )
            } else {
              results.push("未找到相关知识图谱节点")
            }
            results.push("")

            results.push("## 语义搜索")
            const semanticResults = yield* knowledgeService.searchSemantic(topic, { limit: 5, threshold: 0.5 })
            if (semanticResults.length > 0) {
              results.push(...semanticResults.map((r) => `- ${r.title}: ${r.content.slice(0, 100)}...`))
            } else {
              results.push("未找到语义匹配内容")
            }
            results.push("")

            results.push("## 知识卡片搜索")
            const cardResults = yield* knowledgeService.searchCards(topic)
            if (cardResults.length > 0) {
              results.push(...cardResults.map((c) => `- ${c.title}: ${c.content.slice(0, 100)}...`))
            } else {
              results.push("未找到知识卡片")
            }
            results.push("")
          }

          if (!scope || scope === "全部" || scope === "法规") {
            results.push("## 法规搜索")
            const lawResults = yield* lawService.searchLaw(topic)
            if (lawResults.length > 0) {
              results.push(...lawResults.map((law: { id: string; name: string; level: string }) => `- ${law.name} (${law.level})`).slice(0, 10))
            } else {
              results.push("未找到相关法规")
            }
            results.push("")
          }

          if (!scope || scope === "全部" || scope === "实务") {
            results.push("## 审查指南")
            const guidelineContent = yield* knowledgeService.searchGuidelines(topic)
            if (guidelineContent) {
              results.push(guidelineContent.slice(0, 500) + "...")
            } else {
              results.push("未找到相关审查指南")
            }
            results.push("")

            results.push("## 复审无效案例")
            const invalidationContent = yield* knowledgeService.searchInvalidation(topic)
            if (invalidationContent) {
              results.push(invalidationContent.slice(0, 500) + "...")
            } else {
              results.push("未找到复审无效案例")
            }
            results.push("")
          }

          if (!scope || scope === "全部" || scope === "ipc") {
            results.push("## IPC 分类搜索")
            const ipcResults = yield* ipcService.searchByDescription(topic)
            if (ipcResults.length > 0) {
              results.push(...ipcResults.map((ipc: { code: string; description: string }) => `- ${ipc.code}: ${ipc.description}`).slice(0, 10))
            } else {
              results.push("未找到相关 IPC 分类")
            }
            results.push("")
          }

          const depthNote = depth === "深度" ? "（深度分析模式）" : depth === "详细" ? "（详细模式）" : "（概述模式）"
          const output = [`# 专利研究报告: ${topic} ${depthNote}`, ...results].join("\n\n")

          return {
            title: `专利研究: ${topic}`,
            output,
            metadata: { topic, scope, depth },
          }
        }).pipe(Effect.orDie),
    }
  }),
)