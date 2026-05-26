import { Effect, Schema } from "effect"
import { SlopDetector } from "@/patent/slop"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  action: Schema.Union([
    Schema.Literal("detect"),
    Schema.Literal("filter"),
    Schema.Literal("score"),
  ]).annotate({ description: "Action: detect/filter/score" }),
  content: Schema.String.annotate({ description: "The patent document content to check" }),
})

export const SlopTool = Tool.define(
  "slop_check",
  Effect.gen(function* () {
    const slopService = yield* SlopDetector.Service

    return {
      description: "专利文稿反套话检测与过滤。检测 AI 套话、空洞论证、无主体宣告等问题，支持自动过滤。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "detect" || params.action === "score") {
            const report = yield* slopService.detect(params.content)

            const output = [
              "## 反套话检测报告",
              "",
              `**评分**: ${report.score}/10`,
              report.passed ? "**状态**: 通过" : "**状态**: 未通过，需修订",
              `**摘要**: ${report.summary}`,
              "",
              report.issues.length > 0 ? "### 检出问题" : "未检测到套话问题。",
              ...report.issues.map((issue, i) => {
                const severity = issue.severity === "high" ? "高危" : issue.severity === "medium" ? "中危" : "低危"
                return `${i + 1}. **[${severity}]** \`${issue.matched}\` — ${issue.suggestion}`
              }),
            ].join("\n")

            return {
              title: `反套话检测: ${report.score}/10 - ${report.passed ? "通过" : "需修订"}`,
              output,
              metadata: { score: report.score, passed: report.passed, issueCount: report.issues.length },
            }
          }

          if (params.action === "filter") {
            const { text, report } = yield* slopService.filter(params.content)

            const output = [
              "## 反套话过滤结果",
              "",
              `**过滤前评分**: ${(yield* slopService.detect(params.content)).score}/10`,
              `**过滤后评分**: ${report.score}/10`,
              `**删除了 ${report.issues.length} 处套话**`,
              "",
              "### 过滤后文本",
              "---",
              text,
            ].join("\n")

            return {
              title: `反套话过滤: ${report.score}/10`,
              output,
              metadata: { score: report.score, passed: report.passed },
            }
          }

          return { title: "Unknown action", output: "Invalid action", metadata: {} }
        }).pipe(Effect.orDie),
    } as any
  }),
)
