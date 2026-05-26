import { Effect, Schema } from "effect"
import { PatentQuality } from "@/patent/quality"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  document_type: Schema.Union([
    Schema.Literal("specification"),
    Schema.Literal("claims"),
    Schema.Literal("oa_response"),
    Schema.Literal("full"),
  ]).annotate({ description: "Document type: specification/claims/oa_response/full" }),
  content: Schema.String.annotate({ description: "The document content to check" }),
  auto_fix: Schema.optional(Schema.Boolean).annotate({
    description: "Automatically fix issues if check fails (default: false)",
  }),
})

export const PatentCheckTool = Tool.define(
  "patent_check",
  Effect.gen(function* () {
    const qualityService = yield* PatentQuality.Service

    return {
      description: "专利文件质量检查（7维度评估）。自动评估完整性、清晰性、准确性、充分性、一致性、规范性、支持性。",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { document_type, content, auto_fix } = params

          const report = yield* qualityService.check({
            document_type,
            content,
          })

          const output = [
            `## 专利文件质量检查 (${document_type})`,
            "",
            `### 总体评分: ${report.totalScore}/10`,
            report.passed ? "**✓ 通过**" : "**✗ 未通过**",
            "",
            `### ${report.summary}`,
            "",
            "### 各维度评分",
            ...report.scores.map(
              (s) =>
                `- **${s.name}**: ${s.score.toFixed(1)}/10 (权重: ${(s.weight * 100).toFixed(0)}%)${
                  s.issues.length > 0 ? `\n  问题: ${s.issues.join("; ")}` : ""
                }`,
            ),
            "",
            "### 改进建议",
            ...(report.suggestions.length > 0
              ? report.suggestions.map((s, i) => `${i + 1}. ${s}`)
              : ["无改进建议"]),
          ].join("\n")

          if (!report.passed && auto_fix) {
            const fixed = yield* qualityService.autoFix(
              { document_type, content },
              report,
            )
            return {
              title: `质量检查: ${report.totalScore}/10 - 已自动修复`,
              output: `${output}\n\n---\n\n### 自动修复结果\n\n${fixed}`,
              metadata: {
                totalScore: report.totalScore,
                passed: report.passed,
                autoFixed: true,
              },
            }
          }

          return {
            title: `质量检查: ${report.totalScore}/10 - ${report.passed ? "通过" : "未通过"}`,
            output,
            metadata: {
              totalScore: report.totalScore,
              passed: report.passed,
              autoFixed: false,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)