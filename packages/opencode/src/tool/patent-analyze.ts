import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  action: Schema.Union([Schema.Literal("compare"), Schema.Literal("novelty"), Schema.Literal("inventiveness"), Schema.Literal("prior_art")]).annotate({
    description: "Analysis type: compare/novelty/inventiveness/prior_art",
  }),
  target: Schema.String.annotate({ description: "Target patent content or description" }),
  references: Schema
    .optional(Schema.Array(Schema.String))
    .annotate({ description: "Array of reference patent contents or descriptions" }),
  rules: Schema.optional(Schema.String).annotate({ description: "Optional analysis rules or criteria" }),
})

export const PatentAnalyzeTool = Tool.define(
  "patent_analyze",
  Effect.gen(function* () {
    return {
      description:
        "专利技术分析。支持对比分析、新颖性分析、创造性判断、现有技术分析。注：当前为结构化输出占位，实际 LLM 集成将在 Agent prompts 完成后接入。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { action, target, references, rules } = params

          let title = ""
          let analysis = ""

          if (action === "compare") {
            title = "专利对比分析"
            analysis = [
              "## 专利对比分析",
              "",
              "### 目标专利",
              target.slice(0, 500),
              "",
              "### 对比专利",
              ...(references?.map((ref: string, i: number) => `**参考 ${i + 1}**: ${ref.slice(0, 200)}...`) ?? ["未提供对比专利"]),
              "",
              "### 对比要点",
              "- [占位] 技术方案差异分析",
              "- [占位] 保护范围对比",
              "- [占位] 实施方式对比",
            ].join("\n")
          }

          if (action === "novelty") {
            title = "新颖性分析"
            analysis = [
              "## 新颖性分析",
              "",
              "### 分析对象",
              target.slice(0, 500),
              "",
              "### 对比文件",
              ...(references?.map((ref: string, i: number) => `**对比文件 ${i + 1}**: ${ref.slice(0, 200)}...`) ?? ["未提供对比文件"]),
              "",
              "### 新颖性判断",
              "- [占位] 独立权利要求对比",
              "- [占位] 技术特征差异分析",
              "- [占位] 新颖性结论",
            ].join("\n")
          }

          if (action === "inventiveness") {
            title = "创造性分析"
            analysis = [
              "## 创造性分析",
              "",
              "### 分析对象",
              target.slice(0, 500),
              "",
              "### 对比文件",
              ...(references?.map((ref: string, i: number) => `**对比文件 ${i + 1}**: ${ref.slice(0, 200)}...`) ?? ["未提供对比文件"]),
              "",
              "### 创造性判断",
              "- [占位] 突出的实质性特点分析",
              "- [占位] 显著的进步分析",
              "- [占位] 结合启示分析",
              "- [占位] 创造性结论",
            ].join("\n")
          }

          if (action === "prior_art") {
            title = "现有技术分析"
            analysis = [
              "## 现有技术分析",
              "",
              "### 目标专利",
              target.slice(0, 500),
              "",
              "### 现有技术检索结果",
              ...(references?.map((ref: string, i: number) => `**文献 ${i + 1}**: ${ref.slice(0, 200)}...`) ?? ["未提供现有技术文献"]),
              "",
              "### 现有技术分析",
              "- [占位] 相关技术领域梳理",
              "- [占位] 技术问题对比",
              "- [占位] 技术方案差异",
              "- [占位] 技术效果对比",
            ].join("\n")
          }

          if (rules) {
            analysis += `\n\n### 分析规则\n${rules}`
          }

          return {
            title,
            output: analysis,
            metadata: { action, hasReferences: (references?.length ?? 0) > 0, hasRules: !!rules },
          }
        }).pipe(Effect.orDie),
    }
  }),
)